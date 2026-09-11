import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import {
  BridgeOrderStatusBody,
  BridgeOrderStatusReader,
  BridgeStatusReadOutcome,
} from './bridge-order-status';
import {
  buildOrderStatusIdempotencyKey,
  IDEALPOS_ORDER_STATUS_COMMAND_TYPE,
  IDEALPOS_ORDER_STATUS_REQUIRED_CAPABILITY,
  IDEALPOS_ORDER_STATUS_RESULT_TYPE,
  IDEALPOS_ORDER_STATUS_SCHEMA_VERSION,
} from './idealpos-order-status.constants';

const TERMINAL_STATUSES: ReadonlySet<ConnectorCommandStatus> = new Set([
  ConnectorCommandStatus.succeeded,
  ConnectorCommandStatus.failed,
  ConnectorCommandStatus.expired,
  ConnectorCommandStatus.unknown,
  ConnectorCommandStatus.cancelled,
]);

const IN_FLIGHT_STATUSES: ReadonlySet<ConnectorCommandStatus> = new Set([
  ConnectorCommandStatus.pending,
  ConnectorCommandStatus.claimed,
  ConnectorCommandStatus.accepted,
]);

/**
 * Reads IdealposBridge's `GET /api/orders/{externalOrderId}` THROUGH the
 * Venue Connector, using the existing Story 2-10 command protocol.
 *
 * WHY THIS SHAPE. `BridgeOrderStatusReader.read()` looks like a synchronous
 * request/response, but the connector protocol is deliberately asynchronous:
 * the API creates a durable command, the connector polls for it on its own
 * schedule, executes it against loopback Bridge, and reports back. A single
 * `read()` therefore CANNOT block until the connector answers — doing so
 * would couple an API request thread to a venue machine's poll interval and
 * to the health of a restaurant LAN.
 *
 * So `read()` is a state machine over durable rows rather than a live call:
 *
 *   - A sufficiently FRESH terminal probe result exists  -> interpret it.
 *   - A probe is already in flight                       -> `unavailable`
 *                                                           ("we learned
 *                                                           nothing YET").
 *   - No probe, or only a stale one                      -> enqueue one and
 *                                                           return
 *                                                           `unavailable`.
 *
 * `unavailable` is exactly the right answer in the latter two cases, and
 * `decideConfirmation` already treats it as "no evidence either way, leave
 * the record awaiting". A sweep therefore converges over successive ticks
 * instead of blocking, and NOTHING here can manufacture a confirmation: the
 * only path that returns `ok` is a real, parsed Bridge body that the
 * connector actually received.
 *
 * THE API HOLDS NO BRIDGE CREDENTIAL. This class creates database rows and
 * nothing else. It never learns Bridge's URL or bearer key — those stay in
 * connector-local configuration, which is the whole reason the readback is
 * Connector-mediated rather than a direct API->Bridge HTTP call.
 *
 * IDEMPOTENCY AND CONCURRENCY. Probes are keyed
 * `idealpos-order-status:{externalOrderId}:{attempt}` where `attempt` is the
 * count of probes already on file. Two concurrent sweeps compute the SAME
 * ordinal, so the second `createCommand` hits the
 * (organizationId, venueId, idempotencyKey) unique constraint and returns
 * the existing row instead of creating a duplicate — the same mechanism the
 * submit dispatcher relies on. Duplicate delivery of one probe to the
 * connector is likewise safe: the probe is a pure GET, and a repeated report
 * carries a stable per-command idempotency key.
 *
 * BOUNDED. An order that never advances would otherwise be probed forever.
 * Probing stops once either the attempt cap or the probe window is reached;
 * the record simply stays `submitted_awaiting_confirmation`, which is the
 * truthful state, rather than being upgraded or failed on no evidence.
 */
@Injectable()
export class ConnectorBridgeOrderStatusReader implements BridgeOrderStatusReader {
  private readonly logger = new Logger(ConnectorBridgeOrderStatusReader.name);

  /** How long a terminal probe result is considered current evidence. */
  private readonly resultFreshnessMs: number;
  /** Maximum probes ever created for one order. */
  private readonly maxProbes: number;
  /** Stop probing once the sync record has been awaiting longer than this. */
  private readonly probeWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
    config: ConfigService,
  ) {
    this.resultFreshnessMs = Number(
      config.get<string>('IDEALPOS_ORDER_STATUS_RESULT_FRESHNESS_MS') ?? 60_000,
    );
    this.maxProbes = Number(config.get<string>('IDEALPOS_ORDER_STATUS_MAX_PROBES') ?? 60);
    this.probeWindowMs = Number(
      config.get<string>('IDEALPOS_ORDER_STATUS_PROBE_WINDOW_MS') ?? 6 * 60 * 60 * 1000,
    );
  }

  /**
   * MUST NOT throw — the port contract treats a transport fault as an
   * outcome, and `IdealposConfirmationService` relies on that so one bad
   * record cannot abort a sweep. Every failure below degrades to
   * `unavailable`, which is never confirmation and never failure.
   */
  async read(externalOrderId: string): Promise<BridgeStatusReadOutcome> {
    try {
      return await this.readInner(externalOrderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `order-status probe failed for externalOrderId=${externalOrderId}: ${message}`,
      );
      return { kind: 'unavailable', reason: `probe transport error: ${message}` };
    }
  }

  private async readInner(externalOrderId: string): Promise<BridgeStatusReadOutcome> {
    const probes = await this.prisma.connectorCommand.findMany({
      where: {
        commandType: IDEALPOS_ORDER_STATUS_COMMAND_TYPE,
        sourceAggregateType: 'Order',
        sourceRecordId: externalOrderId,
      },
      select: {
        id: true,
        status: true,
        resultType: true,
        resultPayload: true,
        reportedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const inFlight = probes.find((p) => IN_FLIGHT_STATUSES.has(p.status));
    const latestTerminal = probes.find((p) => TERMINAL_STATUSES.has(p.status));

    if (latestTerminal) {
      const settledAt = latestTerminal.reportedAt ?? latestTerminal.updatedAt;
      const ageMs = Date.now() - settledAt.getTime();
      if (ageMs <= this.resultFreshnessMs) {
        return this.interpret(latestTerminal);
      }
    }

    if (inFlight) {
      return {
        kind: 'unavailable',
        reason: `order-status probe ${inFlight.id} is in flight (${inFlight.status}) — no answer yet`,
      };
    }

    return this.enqueueProbe(externalOrderId, probes.length);
  }

  /**
   * Maps one terminal probe command onto a read outcome.
   *
   * The three non-success shapes are kept distinct on purpose — see
   * IDEALPOS_ORDER_STATUS_RESULT_TYPE. None of them can become success, and
   * `notFound` in particular must never become failure.
   */
  private interpret(probe: {
    id: string;
    status: ConnectorCommandStatus;
    resultType: string | null;
    resultPayload: unknown;
  }): BridgeStatusReadOutcome {
    if (probe.status === ConnectorCommandStatus.succeeded) {
      if (probe.resultType === IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_NOT_FOUND) {
        return { kind: 'notFound' };
      }

      if (probe.resultType === IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS) {
        const body = this.extractBody(probe.resultPayload);
        if (!body) {
          return {
            kind: 'malformed',
            reason: `probe ${probe.id} reported ${probe.resultType} but carried no usable order body`,
          };
        }
        return { kind: 'ok', body };
      }

      // A `succeeded` probe with a resultType this build does not know is
      // NOT evidence. Refusing here is what stops a future connector build
      // from silently widening what counts as confirmation.
      return {
        kind: 'unavailable',
        reason: `probe ${probe.id} succeeded with unrecognised resultType '${probe.resultType ?? 'none'}' — refusing to interpret`,
      };
    }

    if (probe.status === ConnectorCommandStatus.failed) {
      if (probe.resultType === IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_STATUS_UNREADABLE) {
        return {
          kind: 'malformed',
          reason: `bridge answered but the body was not a readable order record (probe ${probe.id})`,
        };
      }
      return {
        kind: 'unavailable',
        reason: `order-status probe ${probe.id} failed (${probe.resultType ?? 'no resultType'}) — no evidence either way`,
      };
    }

    // expired / unknown / cancelled: the probe never produced an answer.
    return {
      kind: 'unavailable',
      reason: `order-status probe ${probe.id} ended '${probe.status}' without an answer`,
    };
  }

  /**
   * Pulls the Bridge order-record body out of the connector's reported
   * result payload. Deliberately strict: anything that is not a plain
   * object becomes "no usable body" (a `malformed` outcome) rather than
   * being coerced into a partially-populated record that
   * `decideConfirmation` would then reason about.
   */
  private extractBody(resultPayload: unknown): BridgeOrderStatusBody | null {
    if (!resultPayload || typeof resultPayload !== 'object' || Array.isArray(resultPayload))
      return null;
    const body = (resultPayload as Record<string, unknown>).body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as BridgeOrderStatusBody;
  }

  private async enqueueProbe(
    externalOrderId: string,
    attempt: number,
  ): Promise<BridgeStatusReadOutcome> {
    if (attempt >= this.maxProbes) {
      return {
        kind: 'unavailable',
        reason: `order-status probe cap reached (${attempt}/${this.maxProbes}) — not probing further; record stays awaiting`,
      };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: externalOrderId },
      select: {
        id: true,
        createdAt: true,
        venueId: true,
        venue: { select: { organizationId: true } },
      },
    });

    if (!order?.venue) {
      return {
        kind: 'unavailable',
        reason: `cannot resolve venue/organization for externalOrderId=${externalOrderId} — no probe created`,
      };
    }

    if (Date.now() - order.createdAt.getTime() > this.probeWindowMs) {
      return {
        kind: 'unavailable',
        reason: `order is older than the ${this.probeWindowMs}ms probe window — not probing further; record stays awaiting`,
      };
    }

    // Concurrency-safe by construction: a second sweep computing the same
    // `attempt` collides on the idempotency-key unique constraint and gets
    // the existing row back rather than creating a duplicate probe.
    const created = await this.connectorCommandService.createCommand({
      organizationId: order.venue.organizationId,
      venueId: order.venueId,
      commandType: IDEALPOS_ORDER_STATUS_COMMAND_TYPE,
      schemaVersion: IDEALPOS_ORDER_STATUS_SCHEMA_VERSION,
      requiredCapability: IDEALPOS_ORDER_STATUS_REQUIRED_CAPABILITY,
      payload: { externalOrderId },
      idempotencyKey: buildOrderStatusIdempotencyKey(externalOrderId, attempt),
      sourceAggregateType: 'Order',
      sourceRecordId: externalOrderId,
    });

    return {
      kind: 'unavailable',
      reason: `order-status probe ${created.id} enqueued (attempt ${attempt}) — no answer yet`,
    };
  }
}

/**
 * THE EVIDENCE READER, as the reconciler actually gets it.
 *
 * `NativeRoundEvidenceReader.readEvidence()` looks like a synchronous question
 * to the till. It cannot be one. The connector protocol is deliberately
 * asynchronous — the API writes a durable command, the connector polls for it
 * on its own schedule, executes it against loopback, and reports back — so a
 * `readEvidence` that blocked until the venue answered would couple a
 * reconciliation sweep to a restaurant LAN's health.
 *
 * So this is a state machine over durable rows, exactly like
 * `ConnectorBridgeOrderStatusReader`:
 *
 *   a FRESH terminal probe exists      -> interpret it
 *   a probe is in flight               -> return ignorance, look again next tick
 *   no probe, or only a stale one      -> enqueue one, return ignorance
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IGNORANCE IS THE ONLY THING THIS CAN INVENT.
 *
 * Returning `{}` means every field is `undefined`, which the predicate reads as
 * "did not look". That can never confirm a round and can never release its
 * lines — the two outcomes that touch a customer's bill. The sweep simply
 * converges over successive ticks instead of blocking.
 *
 * The one shape that must never appear here is a FABRICATED ABSENCE: a
 * `storedTokenForDevice: null` or an empty `currentTable` that came from an
 * outage rather than from a reading. Every failure path below returns `{}`, and
 * every `null`/`noOpenSale` this class produces came from a connector that
 * actually looked. That asymmetry is the whole safety argument, and it is
 * asserted by test rather than left to care.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE API HOLDS NO TILL CREDENTIAL. This class creates database rows and reads
 * them back. It never learns a connection string, a database name, or the venue
 * machine's address. Those stay in connector-local configuration, which is the
 * entire reason this is command-mediated rather than a direct SQL connection
 * from the API — a design the connector's own gates already enforce from the
 * other side by refusing to default a connection string they were not given.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandStatus } from '@prisma/client';

import { ConnectorCommandService } from '../../connector/connector-command.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildNativeEvidenceIdempotencyKey,
  NATIVE_ROUND_EVIDENCE_COMMAND_TYPE,
  NATIVE_ROUND_EVIDENCE_REQUIRED_CAPABILITY,
  NATIVE_ROUND_EVIDENCE_RESULT_TYPE,
  NATIVE_ROUND_EVIDENCE_SCHEMA_VERSION,
} from './native-round-evidence.constants';
import type { NativeRoundEvidenceReader } from './native-round-reconciliation.service';
import type {
  NativeLineObservation,
  NativeTableSnapshot,
  StrongNativeEvidence,
} from './waiterpad-native-evidence';
import type { ReconciliationEvidence } from './waiterpad-reconciliation';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

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

/** Every failure, every outage, every unrecognised shape resolves to this. */
const NOTHING_LEARNED: ReconciliationEvidence = {};

@Injectable()
export class ConnectorNativeEvidenceReader implements NativeRoundEvidenceReader {
  private readonly logger = new Logger(ConnectorNativeEvidenceReader.name);

  /** How long a terminal probe result is considered current evidence. */
  private readonly resultFreshnessMs: number;
  /** Maximum probes ever created for one ATTEMPT. */
  private readonly maxProbes: number;
  /** Stop probing once the attempt has been outstanding longer than this. */
  private readonly probeWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
    config: ConfigService,
  ) {
    this.resultFreshnessMs = Number(
      config.get<string>('NATIVE_ROUND_EVIDENCE_RESULT_FRESHNESS_MS') ?? 60_000,
    );
    this.maxProbes = Number(config.get<string>('NATIVE_ROUND_EVIDENCE_MAX_PROBES') ?? 60);
    this.probeWindowMs = Number(
      config.get<string>('NATIVE_ROUND_EVIDENCE_PROBE_WINDOW_MS') ?? 6 * 60 * 60 * 1000,
    );
  }

  /**
   * MUST NOT throw. The reconciler catches, but a throw would be counted as an
   * error for that round and would cost it the tick; degrading to ignorance
   * costs it nothing and says the same thing more precisely.
   */
  async readEvidence(record: SendInitiatedRecord): Promise<ReconciliationEvidence> {
    try {
      return await this.readInner(record);
    } catch (err) {
      this.logger.error(
        `native evidence probe failed for attempt ${record.attemptId} (round ${record.roundId}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return NOTHING_LEARNED;
    }
  }

  private async readInner(record: SendInitiatedRecord): Promise<ReconciliationEvidence> {
    const probes = await this.prisma.connectorCommand.findMany({
      where: {
        commandType: NATIVE_ROUND_EVIDENCE_COMMAND_TYPE,
        sourceAggregateType: 'NativeSendAttempt',
        sourceRecordId: record.attemptId,
      },
      select: {
        id: true,
        status: true,
        resultType: true,
        resultPayload: true,
        reportedAt: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestTerminal = probes.find((p) => TERMINAL_STATUSES.has(p.status));
    if (latestTerminal) {
      const settledAt = latestTerminal.reportedAt ?? latestTerminal.updatedAt;
      if (Date.now() - settledAt.getTime() <= this.resultFreshnessMs) {
        return this.interpret(latestTerminal);
      }
    }

    if (probes.some((p) => IN_FLIGHT_STATUSES.has(p.status))) {
      // Asked, not yet answered. Ignorance, and the truthful kind.
      return NOTHING_LEARNED;
    }

    return this.enqueueProbe(record, probes.length);
  }

  /**
   * Maps one terminal probe onto evidence.
   *
   * A probe that did not SUCCEED yields nothing — not a null token, not an
   * empty table. A failed probe is an outage, and an outage is not a fact about
   * a round.
   */
  private interpret(probe: {
    id: string;
    status: ConnectorCommandStatus;
    resultType: string | null;
    resultPayload: unknown;
  }): ReconciliationEvidence {
    if (probe.status !== ConnectorCommandStatus.succeeded) {
      return NOTHING_LEARNED;
    }

    if (probe.resultType !== NATIVE_ROUND_EVIDENCE_RESULT_TYPE.NATIVE_EVIDENCE) {
      // Includes EVIDENCE_READER_UNCONFIGURED and EVIDENCE_UNAVAILABLE, and
      // any resultType a FUTURE connector build invents. Refusing the unknown
      // is what stops a later connector from silently widening what counts as
      // confirmation without this build agreeing to it.
      return NOTHING_LEARNED;
    }

    return parseEvidencePayload(probe.resultPayload);
  }

  private async enqueueProbe(
    record: SendInitiatedRecord,
    probeCount: number,
  ): Promise<ReconciliationEvidence> {
    if (probeCount >= this.maxProbes) {
      this.logger.warn(
        `native evidence probe cap reached for attempt ${record.attemptId} ` +
          `(${probeCount}/${this.maxProbes}); the round stays where it is and a human will settle it.`,
      );
      return NOTHING_LEARNED;
    }

    if (Date.now() - record.sendInitiatedAt.getTime() > this.probeWindowMs) {
      return NOTHING_LEARNED;
    }

    // `NativeTableRound` carries a venue id but no venue RELATION, so the
    // organization is resolved in a second read rather than a join. Two reads
    // are fine here: nothing is decided from them, and a round whose venue has
    // been removed simply produces no probe.
    const round = await this.prisma.nativeTableRound.findUnique({
      where: { id: record.roundId },
      select: { venueId: true },
    });

    const venue = round
      ? await this.prisma.venue.findUnique({
          where: { id: round.venueId },
          select: { organizationId: true },
        })
      : null;

    if (!round || !venue) {
      this.logger.warn(
        `cannot resolve venue/organization for round ${record.roundId}; no evidence probe created.`,
      );
      return NOTHING_LEARNED;
    }

    // The map the pre-send baseline was actually read in, so both terms of the
    // delta come from one native table context. Absent when no baseline was
    // captured, in which case the connector uses its configured map or fails
    // closed - it never guesses a partition.
    const map =
      record.preSendBaseline?.status === 'observed' ? record.preSendBaseline.map : undefined;

    await this.connectorCommandService.createCommand({
      organizationId: venue.organizationId,
      venueId: round.venueId,
      commandType: NATIVE_ROUND_EVIDENCE_COMMAND_TYPE,
      schemaVersion: NATIVE_ROUND_EVIDENCE_SCHEMA_VERSION,
      requiredCapability: NATIVE_ROUND_EVIDENCE_REQUIRED_CAPABILITY,
      payload: {
        posTableCode: String(record.table),
        deviceId: record.deviceId,
        ...(map === undefined ? {} : { map }),
      },
      idempotencyKey: buildNativeEvidenceIdempotencyKey(record.attemptId, probeCount),
      sourceAggregateType: 'NativeSendAttempt',
      sourceRecordId: record.attemptId,
    });

    // Enqueued, not answered.
    return NOTHING_LEARNED;
  }
}

/**
 * Parse what the connector reported into evidence.
 *
 * STRICT IN ONE DIRECTION ONLY. Anything unrecognisable is dropped to
 * `undefined` rather than coerced, because every coercion available here would
 * invent a fact: an unparseable token becomes "no token", an unparseable table
 * becomes "empty table", and both of those are claims about a customer's bill
 * that nobody made.
 *
 * Exported for test. It is the only place a connector's words become evidence,
 * so it is the place worth attacking.
 */
export function parseEvidencePayload(payload: unknown): ReconciliationEvidence {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return NOTHING_LEARNED;
  const p = payload as Record<string, unknown>;

  const evidence: {
    -readonly [K in keyof StrongNativeEvidence]: StrongNativeEvidence[K];
  } = {};

  const token = parseStoredToken(p.storedTokenForDevice);
  if (token !== undefined) evidence.storedTokenForDevice = token;

  if (typeof p.processedForTableAfterSend === 'boolean') {
    evidence.processedForTableAfterSend = p.processedForTableAfterSend;
  }
  if (typeof p.kitchenFiredAfterSend === 'boolean') {
    evidence.kitchenFiredAfterSend = p.kitchenFiredAfterSend;
  }

  const current = parseSnapshot(p.currentTable);
  if (current) evidence.currentTable = current;

  // NOTE what is absent: `preSendTable` and `expectedItems` are NEVER taken
  // from a connector report. They are the round's own terms, frozen on the
  // attempt row before the socket opened, and a reader that could supply them
  // could hand over the values it is being checked against.

  return evidence;
}

/**
 * The stored token, three ways.
 *
 *   a string  the till holds this value (possibly the empty string, which is
 *             what a freshly inserted row carries and which matches nothing)
 *   null      the connector LOOKED and there is no row
 *   undefined anything else — did not look, could not look, or said something
 *             this build does not understand
 */
function parseStoredToken(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
}

/** A native table snapshot, or `undefined` if it is not one. Never a partial one. */
function parseSnapshot(value: unknown): NativeTableSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;

  const status = v.status;
  if (
    status !== 'observed' &&
    status !== 'noOpenSale' &&
    status !== 'ambiguous' &&
    status !== 'unavailable'
  ) {
    return undefined;
  }

  const snapshot: {
    -readonly [K in keyof NativeTableSnapshot]: NativeTableSnapshot[K];
  } = { status };

  if (typeof v.reason === 'string') snapshot.reason = v.reason;
  if (typeof v.tableCode === 'string') snapshot.tableCode = v.tableCode;
  if (typeof v.map === 'string') snapshot.map = v.map;
  if (typeof v.pos === 'number' && Number.isInteger(v.pos)) snapshot.pos = v.pos;

  if (status !== 'observed') return snapshot;

  // An `observed` snapshot MUST carry a readable line list. A missing or
  // malformed one is not an empty table — it is an unreadable one, and saying
  // otherwise would make every line of a real round look new.
  const lines = parseLines(v.lines);
  if (!lines) {
    return {
      status: 'unavailable',
      reason:
        'the connector reported an observed table whose line list could not be read; treating it ' +
        'as unreadable rather than as empty, because an empty table would make every line of ' +
        'this round look new',
    };
  }
  snapshot.lines = lines;
  return snapshot;
}

/** All the lines, or none of them. A partially readable sale is an unreadable sale. */
function parseLines(value: unknown): NativeLineObservation[] | null {
  if (!Array.isArray(value)) return null;
  const lines: NativeLineObservation[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { nativeCode, quantity } = entry as { nativeCode?: unknown; quantity?: unknown };
    if (typeof nativeCode !== 'string' || nativeCode.trim() === '') return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) return null;
    lines.push({ nativeCode, quantity });
  }
  return lines;
}

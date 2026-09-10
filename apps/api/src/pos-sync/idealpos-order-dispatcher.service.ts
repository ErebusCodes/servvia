import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectorCommand,
  ConnectorCommandStatus,
  POSSyncStatus,
  PosSubmissionStrategy,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { buildIdealposOrderPayload, IdealposMappingError } from './idealpos-order-payload-mapper';
import { resolveNativeProductCode } from './resolve-native-product-code';
import {
  IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
  IDEALPOS_SUBMIT_ORDER_REQUIRED_CAPABILITY,
  IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION,
  IDEALPOS_SUBMIT_ORDER_RESULT_TYPE,
} from './idealpos-order-dispatch.constants';
import {
  DINE_IN_ROUTE_CONFIG_KEY,
  DineInPosRoute,
  IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
  IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY,
  IDEALPOS_NATIVE_TABLE_ROUND_SCHEMA_VERSION,
  resolveDineInRoute,
  routeOfCommandType,
} from './dine-in-route';

export interface IdealposDispatchSweepResult {
  eligible: number;
  dispatched: number;
  ineligible: number;
  errored: number;
}

export interface IdealposReconcileSweepResult {
  eligible: number;
  confirmed: number;
  failed: number;
  // DL-092: a transient failure that returned the record to `not_synced`
  // with a scheduled `nextRetryAt` — distinct from `stillPending` (a
  // command that is not yet resolved at all, or genuinely ambiguous) so
  // the two can be told apart in logs/tests/observability.
  retryScheduled: number;
  // DL-093: a stale `unknown` command for which this sweep created a new
  // recovery ConnectorCommand attempt (same externalOrderId, same stored
  // payload, attempt-qualified idempotency key). Distinct from
  // `retryScheduled` — that path returns the record to `not_synced` for a
  // later sweepDispatch to re-pick-up; this path dispatches the recovery
  // attempt directly, since `unknown` never carries a proven negative
  // outcome to schedule a delay around.
  recovered: number;
  stillPending: number;
  errored: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * The round id the API submits for an order's initial (and, today, only)
 * native round. The multi-round model is written but unwired, so every order
 * currently has exactly one round; this constant is the single place that
 * changes when it is wired.
 */
const ROUND_ONE_ID = 'round-1';

/**
 * Durably delivers eligible Verdura orders to IdealposBridge via the
 * existing generic Venue Connector command protocol
 * (ConnectorCommandService — poll/accept/report/sweep, story 2-10,
 * unchanged by this file). Mirrors PosSyncDispatcherService's (story 9-3)
 * claim/staleness pattern, but the durable intent it dispatches from is
 * the same `POSSyncRecord` row story 9-3 already creates atomically inside
 * OrdersService.persistOrder's transaction — no change to order creation
 * was needed to make this durable; that guarantee already existed.
 *
 * Two independent, isolated sweeps:
 *  - sweepDispatch(): POSSyncRecord (not_synced, and eligible on
 *    nextRetryAt) -> either a ConnectorCommand (eligible) or a terminal
 *    `failed` (ineligible, deterministic mapping failure — never retried
 *    automatically, per the eligibility boundary: an order that cannot be
 *    translated without guessing must never reach Bridge submission).
 *  - sweepReconcile(): ConnectorCommand terminal state -> truthful
 *    POSSyncRecord state. `succeeded` becomes
 *    `submitted_awaiting_confirmation` (bridge accepted the HTTP
 *    submission — never `synced`, which this mechanism cannot honestly
 *    claim; see that status's own doc comment).
 *
 *    DL-092: a terminal `failed`/`expired` ConnectorCommand is no longer
 *    uniformly terminal here. `bridge_rejected` (a real, negative response
 *    from Bridge) and this dispatcher's own `connector_payload_invalid`
 *    (a deterministic function of this order's data — retrying would
 *    reproduce the identical failure) stay terminal `failed`, exactly as
 *    before. Everything else that reaches `failed` (chiefly
 *    `bridge_unreachable_or_failed`) or `expired` (the command was never
 *    even claimed/accepted — zero side effects, so retrying is always
 *    safe) returns the record to `not_synced` with a computed
 *    `nextRetryAt` (bounded exponential backoff, ceiling shared with
 *    `attemptCount`/`maxDispatchAttempts` — no second attempt-count
 *    concept), or to a terminal `failed` with `retryExhaustedAt` set once
 *    that ceiling is reached. `cancelled` (an administrator explicitly
 *    cancelled it) stays terminal `failed`, never resurrected
 *    automatically.
 *
 *    DL-093: `unknown` (accepted but never terminally reported) is left as
 *    `queued_for_connector` — genuinely uncertain, not upgraded to either
 *    terminal state — for a configurable grace period
 *    (`IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS`, default 10 minutes) after it
 *    became unknown. Story 2-10's own generic protocol is unchanged: it
 *    never reopens or auto-retries an `unknown` command, and this service
 *    never asks it to. Once stale, THIS dispatcher — which alone knows
 *    IdealposBridge deduplicates on `externalOrderId=order.id` — creates a
 *    NEW recovery ConnectorCommand carrying the ORIGINAL unknown command's
 *    own stored payload byte-for-byte (never rebuilt from current
 *    Table.posTableCode/MenuItem.posProductCode, which could have changed
 *    since the ambiguous attempt), bounded by the same
 *    `maxDispatchAttempts` ceiling as every other retry path here. See
 *    `processUnknownCandidate` for the full mechanism.
 *
 * This service never contacts IdealposBridge, a venue connector, or a
 * restaurant LAN directly — it only creates/reads durable database rows.
 * The actual HTTP call to the bridge is the responsibility of the real
 * connector-side handler for `idealpos.submit_order.v1`
 * (apps/venue-connector's IdealposOrderSubmissionService, story 15-5).
 */
@Injectable()
export class IdealposOrderDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdealposOrderDispatcherService.name);
  private dispatchTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;

  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxDispatchAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly unknownRecoveryGraceMs: number;

  /**
   * The RAW configured dine-in route value, kept unparsed on purpose.
   * `resolveDineInRoute` owns interpretation — including rejecting an
   * unrecognized value — so there is exactly one place where a string becomes
   * a route, and it is a pure function that can be tested without a module.
   */
  private readonly dineInRouteConfiguredValue: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
    private readonly ordersGateway: OrdersGateway,
    config: ConfigService,
  ) {
    this.sweepIntervalMs = config.get<number>('IDEALPOS_DISPATCH_SWEEP_INTERVAL_MS', 5000);
    this.batchSize = config.get<number>('IDEALPOS_DISPATCH_BATCH_SIZE', 50);
    this.maxDispatchAttempts = config.get<number>('IDEALPOS_DISPATCH_MAX_ATTEMPTS', 5);
    // DL-092: no prior convention existed for this specific delay — chosen
    // conservatively (30s doubling to a 10-minute ceiling, matching
    // PosSyncDispatcherService's own 10-minute safety-net scale) rather
    // than picked arbitrarily. With the default maxDispatchAttempts of 5,
    // a transiently-failing order exhausts automatic retry in ~7.5 minutes
    // (30s + 60s + 120s + 240s) after its first attempt.
    this.retryBaseDelayMs = config.get<number>('IDEALPOS_RETRY_BASE_DELAY_MS', 30_000);
    this.retryMaxDelayMs = config.get<number>('IDEALPOS_RETRY_MAX_DELAY_MS', 10 * 60_000);
    // DL-093: how long a stale `unknown` idealpos.submit_order.v1 command
    // (accepted, no terminal report — ConnectorCommandService's own
    // TERMINAL_REPORT_WINDOW_MS, 5 minutes, already elapsed once to reach
    // `unknown` at all) waits before this dispatcher creates a recovery
    // attempt. Deliberately a SECOND, additional wait on top of that first
    // 5-minute window — not overlapping it — so a connector that briefly
    // lost network mid-report has a real chance to reconnect and land its
    // true outcome (audited even if rejected, see
    // CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN) before automatic
    // recovery acts. Default (10 minutes = 2x TERMINAL_REPORT_WINDOW_MS)
    // is not invented in isolation — it matches this same constructor's
    // own retryMaxDelayMs "10-minute safety-net scale" one line above.
    this.unknownRecoveryGraceMs = config.get<number>(
      'IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS',
      10 * 60_000,
    );
    // Unset in production, and unset is the documented default meaning WEBIT.
    // Read once at construction so a mid-flight configuration change cannot
    // reroute orders inside a single process lifetime either — belt and braces
    // alongside the per-order stickiness rule.
    this.dineInRouteConfiguredValue = config.get<string>(DINE_IN_ROUTE_CONFIG_KEY, '');
  }

  /**
   * Pushes the order's current posSyncStatus (and full posSyncRecord detail
   * — attemptCount, nextRetryAt, errorMessage) to the same
   * venue:{id}:orders/kds rooms OrdersService.broadcastOrder/updateStatus
   * already use, over the existing OrdersGateway — no second WS mechanism.
   * Called after every winning (count > 0) POSSyncRecord status
   * compare-and-swap below, so staff watching the Order Tablet see each
   * real transition (queued -> delivered -> synced/failed/retrying) as it
   * happens, not just the order's initial creation. Best-effort: a
   * broadcast failure must never fail or roll back the sweep tick that
   * triggered it — the next tick's own CAS-gated re-read of Order (via
   * REST) is still truthful even if one push is missed.
   */
  private async broadcastPosSyncUpdate(orderId: string, venueId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, table: true, posSyncRecord: true },
      });
      if (order) this.ordersGateway.sendOrderUpdate(venueId, order);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to broadcast posSyncStatus update for orderId=${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Bounded exponential backoff: attemptsSoFar=1 (the just-failed attempt
   * was the first) waits retryBaseDelayMs, attemptsSoFar=2 waits 2x, etc.,
   * capped at retryMaxDelayMs. Pure and deterministic — no wall-clock
   * dependency beyond the caller-supplied `now`, so it is testable without
   * sleeping (see idealpos-order-dispatcher.service.spec.ts).
   */
  private computeNextRetryAt(attemptsSoFar: number, now: Date): Date {
    const delayMs = Math.min(
      this.retryBaseDelayMs * 2 ** Math.max(0, attemptsSoFar - 1),
      this.retryMaxDelayMs,
    );
    return new Date(now.getTime() + delayMs);
  }

  onModuleInit(): void {
    // Same rationale as PosSyncDispatcherService: a periodic timer running
    // during the automated test suite could mutate other test files'
    // fixture rows in the shared local dev database. Tests call
    // sweepDispatch()/sweepReconcile() directly.
    if (process.env.NODE_ENV === 'test') return;
    this.dispatchTimer = setInterval(() => {
      this.sweepDispatch().catch((err: unknown) => {
        this.logger.error(
          `Dispatch sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, this.sweepIntervalMs);
    this.dispatchTimer.unref?.();

    this.reconcileTimer = setInterval(() => {
      this.sweepReconcile().catch((err: unknown) => {
        this.logger.error(
          `Reconcile sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, this.sweepIntervalMs);
    this.reconcileTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  /**
   * One bounded sweep tick. Safe to call concurrently from multiple
   * instances/invocations — every correctness guarantee comes from (a) the
   * per-row compare-and-swap `updateMany` below and (b) ConnectorCommand's
   * own idempotent creation on (venueId, idempotencyKey), never from
   * anything read in this method's own candidate SELECT.
   */
  async sweepDispatch(): Promise<IdealposDispatchSweepResult> {
    const now = new Date();
    const candidates = await this.prisma.pOSSyncRecord.findMany({
      where: {
        status: POSSyncStatus.not_synced,
        // ROUTE EXCLUSIVITY. A native-owned order is not this pipeline's work
        // and can never become it. `status` alone already excludes it - a
        // native record is created at `owned_by_native`, never `not_synced` -
        // so this clause is the second, independent layer, and it holds even
        // if some future code path moved such a row back to `not_synced`.
        // See pos-submission-strategy.ts.
        strategy: PosSubmissionStrategy.webit,
        attemptCount: { lt: this.maxDispatchAttempts },
        // DL-092: a record that has never been attempted has
        // nextRetryAt=null, same as one whose backoff window already
        // elapsed — both are immediately eligible. One that transiently
        // failed and is still backing off is excluded until then.
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      // connectorSubmitCommandId is selected because it is where this order's
      // ROUTE durably lives: the command's type is the record of which
      // transport this order was committed to. A retried record keeps it (the
      // transient-retry path returns the row to not_synced WITHOUT clearing
      // it), which is exactly what makes the route survive restarts and
      // configuration changes.
      select: {
        id: true,
        orderId: true,
        venueId: true,
        attemptCount: true,
        connectorSubmitCommandId: true,
        // Re-checked per row inside dispatchOne. A filter in a candidate query
        // is advisory discovery; the guard that matters runs against the row
        // this worker actually holds, immediately before it can create a
        // ConnectorCommand.
        strategy: true,
      },
    });

    const result: IdealposDispatchSweepResult = {
      eligible: candidates.length,
      dispatched: 0,
      ineligible: 0,
      errored: 0,
    };

    for (const candidate of candidates) {
      // Each candidate is fully isolated: an unexpected error processing
      // one row must never abort the rest of the batch.
      try {
        await this.processDispatchCandidate(candidate, result);
      } catch (err: unknown) {
        result.errored++;
        this.logger.error(
          `Unexpected error dispatching posSyncRecordId=${candidate.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return result;
  }

  private async processDispatchCandidate(
    candidate: {
      id: string;
      orderId: string;
      venueId: string;
      attemptCount: number;
      connectorSubmitCommandId?: string | null;
      strategy?: PosSubmissionStrategy;
    },
    result: IdealposDispatchSweepResult,
  ): Promise<void> {
    const { id, orderId, venueId, attemptCount } = candidate;

    // ── ROUTE EXCLUSIVITY, RE-CHECKED AGAINST THE ROW THIS WORKER HOLDS. ──
    //
    // The candidate query already filters `strategy: webit`. This is not that
    // check repeated for comfort - it is the one that runs at the last moment
    // before a ConnectorCommand could be created, on the row as it actually
    // is. A candidate query is advisory: its result was read at some earlier
    // instant, and this method is reachable from a caller that assembled a
    // candidate some other way.
    //
    // It returns rather than marking the row `failed`. A native-owned order is
    // not a failed Webit dispatch, it is somebody else's order entirely, and
    // writing a failure onto it would put a false error in front of staff
    // whose round is on its way to the till perfectly normally.
    if (candidate.strategy != null && candidate.strategy !== PosSubmissionStrategy.webit) {
      this.logger.warn(
        `Skipping POSSyncRecord ${id} (order ${orderId}): it is owned by the ` +
          `'${candidate.strategy}' strategy, not the Webit connector pipeline. ` +
          'Dispatching it here would put a second copy of this order into IdealPOS.',
      );
      result.ineligible++;
      return;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, table: true, venue: true },
    });
    if (!order) {
      // Structurally shouldn't happen (POSSyncRecord.orderId is a real FK),
      // but a candidate that can never be translated must not loop forever.
      await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.not_synced },
        data: {
          status: POSSyncStatus.failed,
          failedAt: new Date(),
          errorMessage: 'Referenced order no longer exists',
        },
      });
      result.ineligible++;
      await this.broadcastPosSyncUpdate(orderId, venueId);
      return;
    }

    const menuItemIds = [...new Set(order.items.map((item) => item.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: {
        id: true,
        posProductCode: true,
        posIdentity: { select: { nativeCode: true, lifecycleStatus: true } },
      },
    });
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    let payload;
    try {
      // Dual-read precedence for the Menu Management migration window —
      // see resolve-native-product-code.ts's own doc comment for the full
      // rationale (linked PosProductIdentity wins when active, fails
      // closed when linked-but-not-active, only falls back to the legacy
      // MenuItem.posProductCode column when nothing is linked at all).
      // Resolved once, per item, before ever calling the pure payload
      // mapper — a resolution failure here is deterministic and
      // non-retryable, exactly like the mapper's own unmapped_item case.
      const resolvedItems = order.items.map((item) => {
        const menuItem = menuItemById.get(item.menuItemId);
        const resolution = resolveNativeProductCode({
          posProductCode: menuItem?.posProductCode ?? null,
          posIdentity: menuItem?.posIdentity ?? null,
        });
        if (!resolution.ok) {
          throw new IdealposMappingError(
            'unmapped_item',
            `"${item.menuItemTitle}" has no usable POS mapping (${resolution.reason}) — cannot submit without guessing.`,
            { menuItemId: item.menuItemId, reason: resolution.reason },
          );
        }
        return { item, nativeCode: resolution.nativeCode };
      });

      payload = buildIdealposOrderPayload({
        externalOrderId: order.id,
        serviceMode: order.serviceMode,
        tableCode: order.table?.posTableCode ?? null,
        notes: order.notes,
        items: resolvedItems.map(({ item, nativeCode }) => ({
          menuItemId: item.menuItemId,
          menuItemTitle: item.menuItemTitle,
          quantity: item.quantity,
          selectedModifiers: item.selectedModifiers,
          posProductCode: nativeCode,
          // Persisted per-line seat (nullable) carried through to the native
          // round. null stays null — the native server decides the seat.
          seat: item.seat ?? null,
        })),
      });
    } catch (err: unknown) {
      if (err instanceof IdealposMappingError) {
        // Deterministic, non-retryable: this order cannot be translated
        // without guessing. Terminal `failed`, never a ConnectorCommand.
        const message = `${err.reason}: ${err.message}`.slice(0, MAX_ERROR_MESSAGE_LENGTH);
        const updated = await this.prisma.pOSSyncRecord.updateMany({
          where: { id, status: POSSyncStatus.not_synced },
          data: {
            status: POSSyncStatus.failed,
            failedAt: new Date(),
            errorMessage: message,
            attemptCount: { increment: 1 },
          },
        });
        if (updated.count > 0) {
          result.ineligible++;
          this.logger.warn(
            `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} ineligible for IdealPOS submission: ${message}`,
          );
          await this.broadcastPosSyncUpdate(orderId, venueId);
        }
        return;
      }
      throw err;
    }

    // DL-092: the FIRST attempt (attemptCount===0) keeps the exact
    // idempotencyKey this dispatcher has always used — byte-identical
    // behavior/backward compatibility for the common case. A retried
    // attempt (attemptCount>0, i.e. a prior transient failure scheduled
    // this one) uses an attempt-qualified key instead: createCommand's
    // create-or-return-existing-on-conflict behavior means reusing the
    // SAME key here would just hand back the same dead, terminal `failed`
    // command forever, never a fresh claimable one. externalOrderId inside
    // the payload — the only identity Bridge/IdealPOS ever sees — is
    // always `order.id`, completely unaffected by which transport-level
    // command key delivered it; several ConnectorCommand rows may exist
    // for one order, but only ever one logical IdealPOS order identity.
    const idempotencyKey =
      attemptCount === 0
        ? `idealpos-submit-order:${order.id}`
        : `idealpos-submit-order:${order.id}:retry:${attemptCount}`;

    // ── THE DINE-IN ROUTING SEAM ──
    // This is the narrowest point at which the route can be chosen: exactly
    // one ConnectorCommand is created per record here, under the
    // `status: not_synced` compare-and-swap below. Choosing above this point
    // would leave two creation sites; choosing below it would be after the
    // command already exists.
    //
    // The decision consults DURABLE STATE FIRST (this record's existing
    // command type) and configuration only for an order that has never been
    // dispatched. That ordering is the whole safety property: an order already
    // committed to a route cannot be moved to the other one by a restart or a
    // flag flip, and therefore cannot end up with a docket on both transports.
    const routing = resolveDineInRoute({
      configuredValue: this.dineInRouteConfiguredValue,
      existingCommandType: await this.commandTypeOf(candidate.connectorSubmitCommandId),
    });

    if (routing.decision === 'refuse') {
      // Not a route, and specifically NOT a fallback to the other route.
      // Nothing is dispatched; the record stays retryable so fixing the
      // configuration is enough to recover it.
      await this.holdUndispatched(
        id,
        orderId,
        venueId,
        `dine-in route not resolved: ${routing.reason}`,
      );
      result.ineligible++;
      return;
    }

    if (routing.route === DineInPosRoute.NATIVE_IDEALPOS_TABLE) {
      // Second, independent gate. Even a venue whose configuration selected
      // NATIVE gets nothing until its connector actually reports the native
      // capability — and no connector build does today.
      //
      // This check is deliberately PRE-BOUNDARY: it happens before any command
      // exists, so refusing here cannot have left anything half-done on a
      // table. There is no equivalent check after the boundary, and there must
      // never be one: past the send boundary the only safe action is the
      // connector's own read-only reconciliation, never a fallback.
      const nativeReady = await this.venueReportsNativeCapability(venueId);
      if (!nativeReady) {
        await this.holdUndispatched(
          id,
          orderId,
          venueId,
          `dine-in route ${DineInPosRoute.NATIVE_IDEALPOS_TABLE} selected but this venue's connector does not report ` +
            `capability '${IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY}' — not dispatched. This order will NOT ` +
            'be sent via Webit instead: the two routes are mutually exclusive and falling back is how one order ' +
            'becomes two dockets.',
        );
        result.ineligible++;
        return;
      }
    }

    const command =
      routing.route === DineInPosRoute.NATIVE_IDEALPOS_TABLE
        ? await this.connectorCommandService.createCommand({
            organizationId: order.venue.organizationId,
            venueId,
            commandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
            schemaVersion: IDEALPOS_NATIVE_TABLE_ROUND_SCHEMA_VERSION,
            payload: this.buildNativeRoundPayload(order.id, payload),
            idempotencyKey,
            requiredCapability: IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY,
            sourceAggregateType: 'Order',
            sourceRecordId: order.id,
            correlationId: order.id,
          })
        : await this.connectorCommandService.createCommand({
            organizationId: order.venue.organizationId,
            venueId,
            commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
            schemaVersion: IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION,
            payload: payload,
            idempotencyKey,
            requiredCapability: IDEALPOS_SUBMIT_ORDER_REQUIRED_CAPABILITY,
            sourceAggregateType: 'Order',
            sourceRecordId: order.id,
            correlationId: order.id,
          });

    const dispatched = await this.prisma.pOSSyncRecord.updateMany({
      where: { id, status: POSSyncStatus.not_synced },
      data: {
        status: POSSyncStatus.queued_for_connector,
        connectorSubmitCommandId: command.id,
        requestPayload: payload as unknown as Prisma.InputJsonValue,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        nextRetryAt: null,
      },
    });
    if (dispatched.count > 0) {
      result.dispatched++;
      this.logger.log(
        `dispatched posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} connectorCommandId=${command.id}`,
      );
      await this.broadcastPosSyncUpdate(orderId, venueId);
    }
    // count === 0: another instance already moved this row out of
    // not_synced between our SELECT and this write. The ConnectorCommand
    // we just created-or-fetched is still correct and idempotently safe
    // (same idempotencyKey) — no cleanup needed, no duplicate risk.
  }

  /**
   * The command type currently associated with this record, or null when it
   * has never been dispatched. This is the durable route lookup — the reason
   * a route survives restarts without any new column: the command type was
   * written once and cannot change.
   */
  private async commandTypeOf(
    connectorSubmitCommandId: string | null | undefined,
  ): Promise<string | null> {
    if (!connectorSubmitCommandId) return null;
    const command = await this.prisma.connectorCommand.findUnique({
      where: { id: connectorSubmitCommandId },
      select: { commandType: true },
    });
    return command?.commandType ?? null;
  }

  /**
   * Whether this venue's connector actually reports the native table-round
   * capability. Server-controlled and evidence-based: the connector says what
   * it can do in its heartbeat, and the server believes only that.
   *
   * No connector build reports this capability today, so this returns false
   * everywhere — which is precisely why the native route stays inert even if
   * somebody sets the flag.
   */
  private async venueReportsNativeCapability(venueId: string): Promise<boolean> {
    const installation = await this.prisma.connectorInstallation.findFirst({
      where: { venueId },
      select: { reportedCapabilities: true },
      orderBy: { updatedAt: 'desc' },
    });
    const reported = installation?.reportedCapabilities;
    if (reported == null) return false;
    if (Array.isArray(reported)) {
      return reported.some((c) => c === IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY);
    }
    if (typeof reported === 'object') {
      const value = (reported as Record<string, unknown>)[
        IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY
      ];
      return value === true || value === 'true';
    }
    return false;
  }

  /**
   * Leaves the record UNDISPATCHED and retryable, having created no command of
   * either route.
   *
   * This is the only shape a pre-boundary routing refusal may take. It is not
   * `failed` (nothing was deterministically wrong with the ORDER — the
   * configuration or the connector's capability was not ready) and it is not a
   * dispatch down the other route. Fixing the cause makes the record eligible
   * again on the next sweep with no operator data-repair.
   */
  private async holdUndispatched(
    id: string,
    orderId: string,
    venueId: string,
    reason: string,
  ): Promise<void> {
    const nextRetryAt = this.computeNextRetryAt(0, new Date());
    const updated = await this.prisma.pOSSyncRecord.updateMany({
      where: { id, status: POSSyncStatus.not_synced },
      data: {
        nextRetryAt,
        errorMessage: reason.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      },
    });
    if (updated.count > 0) {
      this.logger.warn(
        `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} not dispatched: ${reason}`,
      );
      await this.broadcastPosSyncUpdate(orderId, venueId);
    }
  }

  /**
   * The native table-round payload.
   *
   * It reuses the SAME `externalOrderId` the Webit payload carries — the
   * order's own id — so the identity IdealPOS-side work is keyed on does not
   * change across the cutover. Together with `roundId` this is exactly the
   * `(ExternalOrderId, RoundId)` pair TerminalRoundService uses as its durable
   * idempotency key, so an order dispatched natively is idempotent end to end
   * without a translation step that could drift.
   *
   * `roundId` is fixed at ROUND_ONE_ID because the API models exactly one
   * round per order today: the multi-round domain core
   * (orders/rounds/order-round.model.ts) is written but deliberately unwired,
   * pending the native append mechanism. When it is wired, this is the single
   * place that changes.
   *
   * No price is carried, in either direction — the native contract has nowhere
   * to put one, and IdealPOS remains the pricing authority.
   */
  private buildNativeRoundPayload(
    externalOrderId: string,
    webitPayload: {
      table: string;
      items: { productCode: string; quantity: number }[];
      notes?: string | null;
    },
  ): Record<string, unknown> {
    return {
      externalOrderId,
      roundId: ROUND_ONE_ID,
      roundKind: 'FirstRound',
      orderReference: externalOrderId,
      tableCode: webitPayload.table,
      items: webitPayload.items.map((i) => ({ nativeCode: i.productCode, quantity: i.quantity })),
    };
  }

  /**
   * One bounded sweep tick reconciling ConnectorCommand terminal state
   * back into truthful POSSyncRecord state. Safe to call concurrently —
   * every write here is a per-row compare-and-swap gated on
   * `status: queued_for_connector`.
   */
  async sweepReconcile(): Promise<IdealposReconcileSweepResult> {
    const candidates = await this.prisma.pOSSyncRecord.findMany({
      where: {
        status: POSSyncStatus.queued_for_connector,
        connectorSubmitCommandId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      select: {
        id: true,
        connectorSubmitCommandId: true,
        orderId: true,
        venueId: true,
        attemptCount: true,
      },
    });

    const result: IdealposReconcileSweepResult = {
      eligible: candidates.length,
      confirmed: 0,
      failed: 0,
      recovered: 0,
      retryScheduled: 0,
      stillPending: 0,
      errored: 0,
    };

    for (const candidate of candidates) {
      try {
        await this.processReconcileCandidate(candidate, result);
      } catch (err: unknown) {
        result.errored++;
        this.logger.error(
          `Unexpected error reconciling posSyncRecordId=${candidate.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return result;
  }

  /**
   * DL-092: true only for a ConnectorCommand failure this dispatcher knows
   * is deterministic — a real, negative Bridge response (`bridge_rejected`)
   * or a malformed command payload of this dispatcher's own making
   * (`connector_payload_invalid`, from apps/venue-connector's
   * IdealposOrderSubmissionService — a pure function of this same order's
   * data, so retrying reproduces the identical failure). Any other
   * resultType on a `failed` command — chiefly `bridge_unreachable_or_failed`,
   * but also, deliberately, any resultType this dispatcher does not yet
   * recognize — is treated as retryable-transient: retries are bounded by
   * maxDispatchAttempts regardless, so defaulting an unrecognized value to
   * retryable costs at most a few wasted attempts, never an infinite loop,
   * and is safer than defaulting to terminal for a failure mode this
   * dispatcher cannot yet classify.
   */
  private isDeterministicFailure(resultType: string | null): boolean {
    return (
      resultType === IDEALPOS_SUBMIT_ORDER_RESULT_TYPE.BRIDGE_REJECTED ||
      resultType === 'connector_payload_invalid'
    );
  }

  private async processReconcileCandidate(
    candidate: {
      id: string;
      connectorSubmitCommandId: string | null;
      orderId: string;
      venueId: string;
      attemptCount: number;
    },
    result: IdealposReconcileSweepResult,
  ): Promise<void> {
    const { id, connectorSubmitCommandId, attemptCount } = candidate;
    if (!connectorSubmitCommandId) return; // satisfies the type; excluded by the query already

    const command = await this.prisma.connectorCommand.findUnique({
      where: { id: connectorSubmitCommandId },
    });
    if (!command) {
      result.stillPending++;
      return;
    }

    if (command.status === ConnectorCommandStatus.succeeded) {
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.queued_for_connector },
        data: {
          status: POSSyncStatus.submitted_awaiting_confirmation,
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.confirmed++;
        await this.broadcastPosSyncUpdate(candidate.orderId, candidate.venueId);
      }
      return;
    }

    if (command.status === ConnectorCommandStatus.cancelled) {
      // An administrator explicitly cancelled it — never auto-retried,
      // regardless of anything else about the command.
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.queued_for_connector },
        data: {
          status: POSSyncStatus.failed,
          failedAt: new Date(),
          errorMessage: 'Connector command was administratively cancelled',
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.failed++;
        await this.broadcastPosSyncUpdate(candidate.orderId, candidate.venueId);
      }
      return;
    }

    if (
      command.status === ConnectorCommandStatus.failed &&
      this.isDeterministicFailure(command.resultType)
    ) {
      const message = (
        command.failureReason ??
        `Connector command ended in status "${command.status}" without a terminal report`
      ).slice(0, MAX_ERROR_MESSAGE_LENGTH);
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.queued_for_connector },
        data: {
          status: POSSyncStatus.failed,
          failedAt: new Date(),
          errorMessage: message,
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.failed++;
        await this.broadcastPosSyncUpdate(candidate.orderId, candidate.venueId);
      }
      return;
    }

    if (
      (command.status === ConnectorCommandStatus.failed &&
        !this.isDeterministicFailure(command.resultType)) ||
      command.status === ConnectorCommandStatus.expired
    ) {
      // Retryable-transient: bridge_unreachable_or_failed (or an
      // unrecognized resultType), or the command expired before ever
      // being claimed/accepted — zero side effects either way, so
      // retrying is always safe. attemptCount already reflects the
      // just-failed attempt (incremented by processDispatchCandidate when
      // it was dispatched), so it doubles as "attempts so far" here.
      const reason = (
        command.failureReason ??
        `Connector command ended in status "${command.status}" without a terminal report`
      ).slice(0, MAX_ERROR_MESSAGE_LENGTH);

      if (attemptCount >= this.maxDispatchAttempts) {
        const updated = await this.prisma.pOSSyncRecord.updateMany({
          where: { id, status: POSSyncStatus.queued_for_connector },
          data: {
            status: POSSyncStatus.failed,
            failedAt: new Date(),
            retryExhaustedAt: new Date(),
            errorMessage:
              `Transient delivery failure after ${attemptCount} attempt(s); automatic retry exhausted. ` +
              `Last error: ${reason}. Requires manual review — this order was never definitively ` +
              `rejected by IdealPOS.`.slice(0, MAX_ERROR_MESSAGE_LENGTH),
            responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
          },
        });
        if (updated.count > 0) {
          result.failed++;
          this.logger.error(
            `posSyncRecordId=${id} venueId=${candidate.venueId} orderId=${candidate.orderId} exhausted transient-retry budget (${attemptCount} attempts) — requires manual review`,
          );
          await this.broadcastPosSyncUpdate(candidate.orderId, candidate.venueId);
        }
        return;
      }

      const nextRetryAt = this.computeNextRetryAt(attemptCount, new Date());
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.queued_for_connector },
        data: {
          status: POSSyncStatus.not_synced,
          nextRetryAt,
          errorMessage:
            `Transient delivery failure (attempt ${attemptCount}/${this.maxDispatchAttempts}): ${reason}. ` +
            `Next retry at ${nextRetryAt.toISOString()}.`.slice(0, MAX_ERROR_MESSAGE_LENGTH),
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.retryScheduled++;
        this.logger.warn(
          `posSyncRecordId=${id} venueId=${candidate.venueId} orderId=${candidate.orderId} transient delivery failure, retry scheduled at ${nextRetryAt.toISOString()} (attempt ${attemptCount}/${this.maxDispatchAttempts})`,
        );
        await this.broadcastPosSyncUpdate(candidate.orderId, candidate.venueId);
      }
      return;
    }

    if (command.status === ConnectorCommandStatus.unknown) {
      // DL-093: genuinely uncertain (accepted but never terminally
      // reported — ConnectorCommandService's own sweep already marks this,
      // and that generic protocol layer never auto-retries it — see that
      // status's own doc comment). This dispatcher is the one place that
      // MAY safely act, because it alone knows IdealposBridge deduplicates
      // on externalOrderId=order.id. See processUnknownCandidate for the
      // bounded, payload-immutable recovery this performs after a grace
      // period — never immediately, and never for any other command type.
      await this.processUnknownCandidate(candidate, command, result);
      return;
    }

    // pending / claimed / accepted: genuinely not yet resolved. Leave
    // POSSyncRecord at queued_for_connector rather than guessing either
    // terminal outcome, or scheduling a retry that could race a delayed
    // real acceptance still in flight at Bridge.
    result.stillPending++;
  }

  /**
   * DL-093: recovers a stale `unknown` idealpos.submit_order.v1 command.
   * Never reopens or mutates `command` (the original, now-terminal-in-
   * substance row stays exactly as the sweep left it, permanently
   * queryable via sourceAggregateType:'Order', sourceRecordId:orderId for
   * audit) — only ever creates a NEW ConnectorCommand row, exactly the
   * same mechanism DL-092 already uses for a transient `failed`/`expired`
   * retry (attempt-qualified idempotencyKey, same externalOrderId, bounded
   * by the same maxDispatchAttempts ceiling).
   *
   * Payload: reused byte-for-byte from `command.payload` — the ORIGINAL
   * unknown command's own stored Bridge request — never rebuilt from
   * current Table.posTableCode/MenuItem.posProductCode. buildIdealposOrderPayload
   * is deterministic and already produced a valid payload for this exact
   * order once (that is why a ConnectorCommand exists at all); re-deriving
   * it here would risk sending the SAME externalOrderId with a materially
   * different native table/product code if staff corrected a mapping
   * after the ambiguous attempt — the one drift this recovery path must
   * never introduce silently. Order item content/notes are immutable
   * post-creation, so nothing about the logical order itself can have
   * changed; only the mapping tables could have, and this path never
   * re-reads them.
   */
  private async processUnknownCandidate(
    candidate: { id: string; orderId: string; venueId: string; attemptCount: number },
    command: ConnectorCommand,
    result: IdealposReconcileSweepResult,
  ): Promise<void> {
    const staleSince = command.updatedAt.getTime() + this.unknownRecoveryGraceMs;
    if (staleSince > Date.now()) {
      // Not yet past the grace period — a delayed connector completion or
      // late report (audited even though rejected) still has time to land
      // before automatic recovery acts.
      result.stillPending++;
      return;
    }

    const { id, orderId, venueId, attemptCount } = candidate;

    if (attemptCount >= this.maxDispatchAttempts) {
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: {
          id,
          status: POSSyncStatus.queued_for_connector,
          connectorSubmitCommandId: command.id,
        },
        data: {
          status: POSSyncStatus.failed,
          failedAt: new Date(),
          retryExhaustedAt: new Date(),
          errorMessage: (
            `Automatic recovery exhausted after ${attemptCount} attempt(s); the last connector command ` +
            `(${command.id}) ended in status "unknown" — IdealposBridge never confirmed or denied this ` +
            `submission. The native outcome is UNPROVEN, not a confirmed rejection. Requires manual ` +
            `reconciliation against IdealPOS before any further action.`
          ).slice(0, MAX_ERROR_MESSAGE_LENGTH),
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.failed++;
        this.logger.error(
          `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} exhausted unknown-recovery budget (${attemptCount} attempts) — native IdealPOS outcome remains UNPROVEN, requires manual review`,
        );
        await this.broadcastPosSyncUpdate(orderId, venueId);
      }
      return;
    }

    // ── No cross-route recovery, ever. ──
    // This path used to hardcode the Webit command type. That was a latent
    // post-boundary fallback: a NATIVE command that ended `unknown` would have
    // been "recovered" by creating a WEBIT command — the order re-sent down the
    // other transport while a native round may already have crossed the send
    // boundary and put a docket on the table. Exactly one order, two dockets.
    //
    // A native command in `unknown` is not recoverable by the server at all.
    // The connector owns that reconciliation (read-only, against native state,
    // never a resend), so the only correct server action is to stop and say so.
    if (routeOfCommandType(command.commandType) === DineInPosRoute.NATIVE_IDEALPOS_TABLE) {
      const updated = await this.prisma.pOSSyncRecord.updateMany({
        where: {
          id,
          status: POSSyncStatus.queued_for_connector,
          connectorSubmitCommandId: command.id,
        },
        data: {
          status: POSSyncStatus.failed,
          failedAt: new Date(),
          retryExhaustedAt: new Date(),
          errorMessage: (
            `Native table-round command ${command.id} ended in status "unknown". The native outcome is UNPROVEN: ` +
            'the round may already have crossed the send boundary. This order will NOT be re-sent, and will NOT ' +
            'be dispatched via Webit — reconcile against native IdealPOS state before any further action.'
          ).slice(0, MAX_ERROR_MESSAGE_LENGTH),
          responsePayload: (command.resultPayload as Prisma.InputJsonValue | null) ?? undefined,
        },
      });
      if (updated.count > 0) {
        result.failed++;
        this.logger.error(
          `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} native round command ${command.id} is ` +
            'unknown — requires native reconciliation, never a resend and never a Webit fallback',
        );
        await this.broadcastPosSyncUpdate(orderId, venueId);
      }
      return;
    }

    // Attempt-qualified key, identical convention to DL-092's transient-
    // retry path — collision-safe: two racing sweep ticks read the same
    // candidate.attemptCount and compute the identical key, so
    // createCommand's existing P2002-safe idempotent creation returns the
    // SAME row to both, never two.
    const idempotencyKey = `idealpos-submit-order:${orderId}:retry:${attemptCount}`;

    const recoveryCommand = await this.connectorCommandService.createCommand({
      organizationId: command.organizationId,
      venueId,
      commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
      schemaVersion: IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION,
      payload: command.payload,
      idempotencyKey,
      requiredCapability: IDEALPOS_SUBMIT_ORDER_REQUIRED_CAPABILITY,
      sourceAggregateType: 'Order',
      sourceRecordId: orderId,
      correlationId: orderId,
    });

    // CAS on the OLD command id: whichever racing tick's write lands first
    // wins; the loser's updateMany matches zero rows and no-ops safely —
    // the recovery command it fetched-or-created is identical (same key),
    // never orphaned or duplicated.
    const updated = await this.prisma.pOSSyncRecord.updateMany({
      where: {
        id,
        status: POSSyncStatus.queued_for_connector,
        connectorSubmitCommandId: command.id,
      },
      data: {
        connectorSubmitCommandId: recoveryCommand.id,
        requestPayload: command.payload as Prisma.InputJsonValue,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    if (updated.count > 0) {
      result.recovered++;
      this.logger.warn(
        `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} recovering stale unknown connector command (was ${command.id}, now ${recoveryCommand.id}) after ${this.unknownRecoveryGraceMs}ms grace, same externalOrderId=${orderId}`,
      );
      await this.broadcastPosSyncUpdate(orderId, venueId);
    }
  }
}

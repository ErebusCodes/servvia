import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommand, ConnectorCommandStatus, POSSyncStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { buildIdealposOrderPayload, IdealposMappingError } from './idealpos-order-payload-mapper';
import {
  IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
  IDEALPOS_SUBMIT_ORDER_REQUIRED_CAPABILITY,
  IDEALPOS_SUBMIT_ORDER_SCHEMA_VERSION,
  IDEALPOS_SUBMIT_ORDER_RESULT_TYPE,
} from './idealpos-order-dispatch.constants';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
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
        attemptCount: { lt: this.maxDispatchAttempts },
        // DL-092: a record that has never been attempted has
        // nextRetryAt=null, same as one whose backoff window already
        // elapsed — both are immediately eligible. One that transiently
        // failed and is still backing off is excluded until then.
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      select: { id: true, orderId: true, venueId: true, attemptCount: true },
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
    candidate: { id: string; orderId: string; venueId: string; attemptCount: number },
    result: IdealposDispatchSweepResult,
  ): Promise<void> {
    const { id, orderId, venueId, attemptCount } = candidate;

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
      return;
    }

    const menuItemIds = [...new Set(order.items.map((item) => item.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: { id: true, posProductCode: true },
    });
    const posProductCodeByMenuItemId = new Map(menuItems.map((m) => [m.id, m.posProductCode]));

    let payload;
    try {
      payload = buildIdealposOrderPayload({
        externalOrderId: order.id,
        serviceMode: order.serviceMode,
        tableCode: order.table?.posTableCode ?? null,
        notes: order.notes,
        items: order.items.map((item) => ({
          menuItemId: item.menuItemId,
          menuItemTitle: item.menuItemTitle,
          quantity: item.quantity,
          selectedModifiers: item.selectedModifiers,
          posProductCode: posProductCodeByMenuItemId.get(item.menuItemId) ?? null,
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

    const command = await this.connectorCommandService.createCommand({
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
    }
    // count === 0: another instance already moved this row out of
    // not_synced between our SELECT and this write. The ConnectorCommand
    // we just created-or-fetched is still correct and idempotently safe
    // (same idempotencyKey) — no cleanup needed, no duplicate risk.
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
      if (updated.count > 0) result.confirmed++;
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
      if (updated.count > 0) result.failed++;
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
      if (updated.count > 0) result.failed++;
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
    }
  }
}

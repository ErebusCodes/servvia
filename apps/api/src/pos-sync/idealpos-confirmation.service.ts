import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSSyncStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BRIDGE_ORDER_STATUS_READER,
  BridgeOrderStatusReader,
  BridgeStatusReadOutcome,
  decideConfirmation,
} from './bridge-order-status';

export interface ConfirmationSweepResult {
  examined: number;
  /**
   * Advanced to `synced`.
   *
   * STRUCTURALLY ALWAYS 0 since the fail-closed change (2026-09-04):
   * `decideConfirmation` has no path to `synced`, so nothing can increment
   * this. The counter is retained deliberately — if it is ever non-zero, a
   * confirmation path was reintroduced and the fail-closed property has been
   * broken. Treat a non-zero value as an alarm, not as good news.
   */
  confirmed: number;
  /** Advanced to `failed` — the Bridge reported a real rejection. */
  failed: number;
  /** Left untouched: still in flight, unknown, unreachable, or refused. */
  unchanged: number;
  /** Lost a guarded update to a concurrent writer, or the row moved on. */
  raced: number;
  /** The reader is not configured — the sweep is inert. */
  disabled: boolean;
}

/**
 * Advances `submitted_awaiting_confirmation` POSSyncRecords using the ONLY
 * downstream evidence that exists: IdealposBridge's own
 * `GET /api/orders/{externalOrderId}`.
 *
 * WHY THIS EXISTS. Before it, nothing ever moved a record out of
 * `submitted_awaiting_confirmation`. All three orders that have ever existed
 * in production sat in that state from 2026-09-01 onward, and `synced` was
 * documented in the schema as "unreachable today". A ConnectorCommand
 * reporting `succeeded` means only that the Bridge returned 2xx to the
 * submission — it is not evidence of anything IdealPOS did, and this service
 * never treats it as such. Every transition below comes from a fresh read of
 * the Bridge, never from the dispatch outcome.
 *
 * WHAT `synced` MEANS HERE, precisely: NOTHING REACHES IT.
 *
 * This paragraph previously said `assigned_to_table` + `tableMatchesRequest`
 * + a matching observed `posServerPendingSaleCode` reached `synced`. That was
 * true until 2026-09-04 and is now FALSE. The fail-closed change removed that
 * path because it was correlation-grade, not causal: POSServer has no column
 * tying a table sale to a web order, so the evidence proved "a table sale
 * exists on the requested table", never "this order is on it".
 *
 * `decideConfirmation` now has NO path to `synced` at all. This service can
 * therefore only ever move a record to `failed` (an explicit Bridge
 * rejection) or leave it `submitted_awaiting_confirmation`. That is the
 * intended, documented behaviour — see
 * `docs/integrations/idealpos-confirmation-truth-table.md`. Reinstating a
 * `synced` path requires a causal native identity, which does not exist
 * locally today.
 *
 * CONSEQUENCE FOR THIS SWEEP: the awaiting set no longer drains on success,
 * only on explicit rejection. See `sweepConfirm`'s rotation comment — a
 * FIFO-frozen candidate window would starve newer records once the awaiting
 * set exceeds one batch.
 *
 * SAFETY PROPERTIES:
 *  - Every write is a guarded `updateMany` filtered on the record still being
 *    `submitted_awaiting_confirmation`, so a terminal state can never regress
 *    and two concurrent sweeps cannot both apply a transition.
 *  - Repeated polling is idempotent: a record that already advanced is no
 *    longer selected, and a re-read of the same `assigned_to_table` body
 *    produces the same decision with `updated.count === 0` the second time.
 *  - An unreachable or malformed Bridge, or a 404, NEVER becomes success and
 *    never becomes failure — it leaves the record exactly as it was.
 *  - The reader must not throw; a transport fault is an outcome. This service
 *    still guards with try/catch so one bad record cannot abort a sweep.
 *  - Disabled by default. With no reader wired, the sweep reports
 *    `disabled: true` and touches nothing, so shipping it is inert until the
 *    Bridge status transport is deliberately configured.
 */
@Injectable()
export class IdealposConfirmationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdealposConfirmationService.name);
  private readonly batchSize = 50;
  /**
   * Rotating offset into the awaiting set — see `sweepConfirm`.
   *
   * In-memory only, deliberately: it is a fairness hint, not state anything
   * depends on for correctness. A restart resets it to 0, which is safe (the
   * sweep simply begins from the start of the set again) and is why no schema
   * column was added for it.
   */
  private sweepCursor = 0;
  private confirmTimer: NodeJS.Timeout | null = null;
  private readonly sweepIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    // Reader stays the SECOND parameter: the existing unit suite constructs
    // this service positionally as `new IdealposConfirmationService(prisma,
    // reader)`, and those tests are the evidence for every confirmation
    // rule. Config is appended last so that contract is untouched.
    @Optional()
    @Inject(BRIDGE_ORDER_STATUS_READER)
    private readonly reader?: BridgeOrderStatusReader,
    @Optional() config?: ConfigService,
  ) {
    this.sweepIntervalMs = Number(
      config?.get<string>('IDEALPOS_CONFIRM_SWEEP_INTERVAL_MS') ?? 15_000,
    );
  }

  onModuleInit(): void {
    // Same rationale as IdealposOrderDispatcherService: a periodic timer
    // running during the automated suite could mutate other test files'
    // fixture rows in the shared local dev database. Tests call
    // sweepConfirm() directly.
    if (process.env.NODE_ENV === 'test') return;
    // With no reader bound the sweep is inert by construction, so there is
    // nothing to schedule and no timer is created at all.
    if (!this.reader) {
      this.logger.log('confirmation sweep not scheduled: no BridgeOrderStatusReader is bound');
      return;
    }
    this.confirmTimer = setInterval(() => {
      this.sweepConfirm().catch((err: unknown) => {
        this.logger.error(
          `Confirmation sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, this.sweepIntervalMs);
    this.confirmTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.confirmTimer) clearInterval(this.confirmTimer);
  }

  async sweepConfirm(): Promise<ConfirmationSweepResult> {
    const result: ConfirmationSweepResult = {
      examined: 0,
      confirmed: 0,
      failed: 0,
      unchanged: 0,
      raced: 0,
      disabled: false,
    };

    if (!this.reader) {
      result.disabled = true;
      return result;
    }

    // ROTATION — real defect closed here (fail-closed regression audit,
    // 2026-09-05).
    //
    // This query used to be `orderBy: { updatedAt: 'asc' }, take: batchSize`
    // with no offset. That was safe while `synced` was reachable, because a
    // confirmed record left the awaiting set and freed its slot. Since the
    // fail-closed change (2026-09-04) nothing reaches `synced`, so records
    // leave this set ONLY on an explicit Bridge rejection.
    //
    // A record that stays awaiting is never written to — `processCandidate`
    // returns before `updateMany` when the decision is "no change" — so its
    // `updatedAt` is frozen. Frozen `updatedAt` + `orderBy updatedAt asc` +
    // `take 50` means the same 50 oldest records are re-examined on every
    // tick, forever, and once 50 permanently-awaiting records accumulate,
    // NEWER records are never examined at all. An explicit Bridge rejection
    // arriving for order 51 would never be seen.
    //
    // Fixed by paging through the set with a rotating offset over a stable
    // ordering, so every awaiting record is examined within
    // ceil(total / batchSize) ticks regardless of how many are stuck. `id` is
    // used rather than `updatedAt` because the offset is only meaningful over
    // an ordering that does not shift as rows are examined.
    const awaitingCount = await this.prisma.pOSSyncRecord.count({
      where: { status: POSSyncStatus.submitted_awaiting_confirmation },
    });
    if (awaitingCount === 0) {
      this.sweepCursor = 0;
      return result;
    }
    const skip = awaitingCount <= this.batchSize ? 0 : this.sweepCursor % awaitingCount;
    this.sweepCursor = awaitingCount <= this.batchSize ? 0 : skip + this.batchSize;

    const candidates = await this.prisma.pOSSyncRecord.findMany({
      where: { status: POSSyncStatus.submitted_awaiting_confirmation },
      select: { id: true, orderId: true, venueId: true, posTableId: true },
      take: this.batchSize,
      skip,
      orderBy: { id: 'asc' },
    });

    for (const candidate of candidates) {
      result.examined++;
      try {
        await this.processCandidate(candidate, result);
      } catch (err) {
        // One record's failure must not abort the sweep, and must not be
        // mistaken for a downstream verdict.
        result.unchanged++;
        this.logger.error(
          `confirmation sweep error for posSyncRecordId=${candidate.id} orderId=${candidate.orderId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }

  private async processCandidate(
    candidate: { id: string; orderId: string; venueId: string; posTableId: string | null },
    result: ConfirmationSweepResult,
  ): Promise<void> {
    // externalOrderId is the Verdura order id — the same value the dispatcher
    // submitted and the same key IdealposBridge deduplicates on.
    const externalOrderId = candidate.orderId;

    const outcome: BridgeStatusReadOutcome = await this.reader!.read(externalOrderId);
    const requestedTable = await this.resolveRequestedTable(candidate.orderId);
    const decision = decideConfirmation(outcome, requestedTable);

    // Identifiers only — never a body that could carry a credential.
    this.logger.log(
      `confirmation: posSyncRecordId=${candidate.id} orderId=${candidate.orderId} ` +
        `outcome=${outcome.kind} bridgeStatus=${outcome.kind === 'ok' ? (outcome.body.status ?? 'none') : 'n/a'} ` +
        `decision=${decision.nextStatus ?? 'no-change'} tableCorroborated=${decision.tableCorroborated} ` +
        `reason="${decision.reason}"`,
    );

    if (decision.nextStatus === null) {
      result.unchanged++;
      return;
    }

    const data: Prisma.POSSyncRecordUpdateManyMutationInput = {
      status: decision.nextStatus,
      errorMessage: decision.nextStatus === POSSyncStatus.failed ? decision.reason : null,
    };

    if (decision.nextStatus === POSSyncStatus.synced) {
      data.syncedAt = new Date();
      // The OBSERVED table code, not the requested one. Recording the request
      // here would make the record self-confirming and worthless as evidence.
      if (decision.observedTableCode) data.posTableId = decision.observedTableCode;
    }

    if (decision.nextStatus === POSSyncStatus.failed) {
      data.failedAt = new Date();
    }

    if (outcome.kind === 'ok') {
      data.responsePayload = outcome.body as unknown as Prisma.InputJsonValue;
    }

    // Guarded: only applies while the row is still awaiting confirmation.
    // This is what makes the sweep safe under concurrency, restart and replay.
    const updated = await this.prisma.pOSSyncRecord.updateMany({
      where: { id: candidate.id, status: POSSyncStatus.submitted_awaiting_confirmation },
      data,
    });

    if (updated.count === 0) {
      result.raced++;
      return;
    }

    if (decision.nextStatus === POSSyncStatus.synced) result.confirmed++;
    else result.failed++;
  }

  /**
   * The native table code Verdura asked for.
   *
   * `posTableCode` ONLY — deliberately never falling back to `tableNumber`.
   * The schema is explicit that the two must not be conflated: "never
   * derived/guessed from tableNumber; the bridge's own docs flag
   * Caption-vs-Code as unconfirmed against a live instance, so Verdura must
   * not assume tableNumber happens to match." Falling back would manufacture a
   * comparison value and could confirm an order against the wrong table.
   *
   * Returns null for a takeaway order or an unmapped table, which
   * `decideConfirmation` treats as "cannot corroborate" — it refuses rather
   * than confirming.
   */
  private async resolveRequestedTable(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { table: { select: { posTableCode: true } } },
    });
    return order?.table?.posTableCode ?? null;
  }
}

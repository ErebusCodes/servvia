import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { POSAdapterType, POSSyncStatus } from '@prisma/client';

export interface PosSyncDispatchSweepResult {
  eligible: number;
  claimed: number;
  published: number;
  publishFailed: number;
  exhausted: number;
}

/**
 * Story 9-3: makes the already-truthful, already-reviewed PosSyncProcessor
 * (story 9-1, unchanged by this file) actually reachable, by periodically
 * claiming committed `POSSyncRecord` rows and enqueueing them to the
 * existing cloud-internal `pos-sync` BullMQ queue.
 *
 * This service NEVER contacts Idealpos, a venue connector, a restaurant
 * LAN, or a printer. It makes no network call outside the cloud API's own
 * already-provisioned Redis connection (the same one every other queue in
 * this process already uses). It never writes `POSSyncRecord.status` or
 * `Order.posSyncStatus` — those remain exclusively PosSyncProcessor's
 * responsibility (story 9-1), unchanged.
 *
 * IMPORTANT runtime fact discovered while implementing this story: a
 * NestJS `@Processor('pos-sync')` (PosSyncProcessor) auto-starts consuming
 * its queue the moment the module initializes, independent of whether
 * anything has ever enqueued to it. This means every existing integration
 * test file that boots `AppModule` already has a live PosSyncProcessor
 * worker running in the background today, harmlessly idle only because
 * nothing calls `.add()`. The moment this dispatcher's sweep timer runs
 * automatically, it would become able to pick up ANY `not_synced`
 * POSSyncRecord row anywhere in the (shared, populated) local dev
 * database — including rows created by other, unrelated test files
 * currently running in the same `--runInBand` Jest process — and resolve
 * them via the real worker before those tests finish asserting against
 * them. To eliminate this cross-test contamination risk entirely (not just
 * reduce it), the periodic timer never starts when `NODE_ENV === 'test'`.
 * Every test in this story instead calls `sweep()` directly, exactly as
 * the existing `pos-sync.integration-spec.ts` already calls
 * `PosSyncProcessor.process()` directly for the same reason.
 *
 * DL-091 (2026-08-22): the periodic timer also never starts unless
 * `POS_SYNC_DISPATCH_ENABLED=true` is explicitly set, independent of the
 * `NODE_ENV === 'test'` check above. IdealposOrderDispatcherService (story
 * 15-4/15-5) claims candidates from the exact same `POSSyncRecord.status =
 * not_synced` precondition with no discriminating field between the two
 * services' queries — DL-069's "this dispatcher is safe to enable" did not
 * and could not anticipate that second, later dispatcher. Whichever
 * service's compare-and-swap commits first wins the row; if this one wins,
 * `PosSyncProcessor` flips it to the terminal `unsupported` status, which
 * IdealposOrderDispatcherService's own candidate query permanently excludes
 * — the order silently never reaches IdealPOS, with no automatic recovery.
 * `sweep()` itself is unchanged and still safe to call directly (every test
 * in this file does exactly that); only the unattended, automatic timer is
 * now opt-in.
 */
@Injectable()
export class PosSyncDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosSyncDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly dispatchEnabled: boolean;
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly claimLeaseMs: number;
  private readonly safetyNetMs: number;
  private readonly maxDispatchAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.POS_SYNC) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.dispatchEnabled = config.get<boolean>('POS_SYNC_DISPATCH_ENABLED', false);
    this.sweepIntervalMs = config.get<number>('POS_SYNC_DISPATCH_SWEEP_INTERVAL_MS', 5000);
    this.batchSize = config.get<number>('POS_SYNC_DISPATCH_BATCH_SIZE', 50);
    this.claimLeaseMs = config.get<number>('POS_SYNC_DISPATCH_CLAIM_LEASE_MS', 30_000);
    this.safetyNetMs = config.get<number>('POS_SYNC_DISPATCH_SAFETY_NET_MS', 10 * 60_000);
    this.maxDispatchAttempts = config.get<number>('POS_SYNC_DISPATCH_MAX_ATTEMPTS', 20);

    // Independent review (2026-08-16): Joi's per-key bounds on these two
    // values can't express the cross-field relationship that actually
    // matters. If the claim lease were ever configured >= the safety-net
    // threshold, a still-legitimately-in-flight claim could become
    // eligible via the safety-net branch before its own lease even
    // expires — harmless in practice (PosSyncProcessor's terminal-state
    // CAS and the deterministic jobId both absorb the resulting redundant
    // re-claim), but it's a silent misconfiguration nothing else catches.
    // Fail fast at startup instead.
    if (this.claimLeaseMs >= this.safetyNetMs) {
      throw new Error(
        `PosSyncDispatcherService misconfigured: POS_SYNC_DISPATCH_CLAIM_LEASE_MS (${this.claimLeaseMs}) must be strictly less than POS_SYNC_DISPATCH_SAFETY_NET_MS (${this.safetyNetMs}).`,
      );
    }
  }

  onModuleInit(): void {
    // See class doc comment: the timer must never run during the automated
    // test suite, or it can silently mutate other test files' fixture rows
    // in the shared local dev database. Tests call sweep() directly.
    if (process.env.NODE_ENV === 'test') return;
    // DL-091: opt-in only — see class doc comment for the race with
    // IdealposOrderDispatcherService this guards against.
    if (!this.dispatchEnabled) {
      this.logger.log(
        'PosSyncDispatcherService automatic timer disabled (POS_SYNC_DISPATCH_ENABLED is not true); see DL-091.',
      );
      return;
    }
    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) => {
        this.logger.error(
          `Sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One bounded sweep tick. Safe to call concurrently from multiple
   * dispatcher instances/invocations — every correctness guarantee comes
   * from the per-row database compare-and-swap in `claim()`, never from
   * anything read in this method's own SELECT (which is advisory
   * candidate-discovery only, per AC1).
   */
  async sweep(): Promise<PosSyncDispatchSweepResult> {
    const now = new Date();
    const safetyNetCutoff = new Date(now.getTime() - this.safetyNetMs);

    // Bounded, deterministically-ordered (oldest first) candidate
    // discovery. Two eligibility classes, combined:
    //  (a) never claimed, or claim lease expired, not yet dispatched;
    //  (b) dispatched a long time ago but still not_synced — the AC17
    //      infra-failure safety net (the original enqueue may have
    //      succeeded but the worker never resolved it, e.g. a transient DB
    //      error inside PosSyncProcessor's own $transaction).
    // Rows that have exhausted their dispatch-attempt budget are excluded
    // — see the per-row exhaustion check below, which is what actually
    // sets dispatchExhaustedAt.
    const candidates = await this.prisma.pOSSyncRecord.findMany({
      where: {
        status: POSSyncStatus.not_synced,
        dispatchExhaustedAt: null,
        // Defense-in-depth, independent of the POS_SYNC_DISPATCH_ENABLED
        // gate above: 'api'-adapter rows are IdealposOrderDispatcherService's
        // exclusive territory (its own connectorSubmitCommandId/
        // nextRetryAt/retryExhaustedAt claim columns) — excluded here too so
        // this legacy dispatcher can never race it for the same row even if
        // POS_SYNC_DISPATCH_ENABLED is later turned on for a genuinely
        // different adapter type.
        adapterType: { not: POSAdapterType.api },
        OR: [
          {
            dispatchedAt: null,
            OR: [{ dispatchClaimId: null }, { dispatchClaimExpiresAt: { lt: now } }],
          },
          { dispatchedAt: { lt: safetyNetCutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      select: { id: true, venueId: true, orderId: true, dispatchAttemptCount: true },
    });

    const result: PosSyncDispatchSweepResult = {
      eligible: candidates.length,
      claimed: 0,
      published: 0,
      publishFailed: 0,
      exhausted: 0,
    };

    for (const candidate of candidates) {
      // Each candidate is fully isolated: an unexpected error processing
      // one row must never abort the rest of the batch (a "poison" row
      // must not be able to monopolize a sweep by crashing it early).
      try {
        await this.processCandidate(candidate, now, safetyNetCutoff, result);
      } catch (err: unknown) {
        this.logger.error(
          `Unexpected error processing posSyncRecordId=${candidate.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return result;
  }

  private async processCandidate(
    candidate: { id: string; venueId: string; orderId: string; dispatchAttemptCount: number },
    now: Date,
    safetyNetCutoff: Date,
    result: PosSyncDispatchSweepResult,
  ): Promise<void> {
    const { id, venueId, orderId, dispatchAttemptCount } = candidate;

    if (dispatchAttemptCount >= this.maxDispatchAttempts) {
      const exhausted = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, status: POSSyncStatus.not_synced, dispatchExhaustedAt: null },
        data: {
          dispatchExhaustedAt: now,
          lastDispatchError:
            'Dispatch attempt budget exhausted; requires manual/operational review. Not an Idealpos or business-logic failure — the underlying POS-sync classification remains undetermined by this mechanism.',
        },
      });
      if (exhausted.count > 0) {
        result.exhausted++;
        this.logger.error(
          `posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} exhausted dispatch attempt budget (${dispatchAttemptCount} attempts) — requires manual review`,
        );
      }
      return;
    }

    const claimId = randomUUID();
    const claimExpiresAt = new Date(now.getTime() + this.claimLeaseMs);
    const claim = await this.prisma.pOSSyncRecord.updateMany({
      where: {
        id,
        status: POSSyncStatus.not_synced,
        dispatchExhaustedAt: null,
        OR: [
          {
            dispatchedAt: null,
            OR: [{ dispatchClaimId: null }, { dispatchClaimExpiresAt: { lt: now } }],
          },
          { dispatchedAt: { lt: safetyNetCutoff } },
        ],
      },
      data: {
        dispatchClaimId: claimId,
        dispatchClaimedAt: now,
        dispatchClaimExpiresAt: claimExpiresAt,
        dispatchAttemptCount: { increment: 1 },
        // A fresh claim always resets the confirmed-published marker: we
        // are about to attempt (or re-attempt) publication, so "confirmed
        // published" cannot still be true from a prior, unresolved round.
        dispatchedAt: null,
      },
    });
    if (claim.count === 0) {
      // Lost the race to another sweeper/instance, or the row moved out of
      // eligibility between the SELECT and this write (e.g. the processor
      // resolved it in the interim). Either way, safe no-op.
      return;
    }
    result.claimed++;

    try {
      await this.queue.add(
        'sync-order',
        { posSyncRecordId: id },
        // Deterministic jobId derived from the record's own immutable id —
        // never from mutable payload text, timestamps, or attempt number.
        // While the resulting job is still active/waiting in Redis, a
        // duplicate add() with the same jobId is a BullMQ-level no-op. Once
        // the job has completed and been removed (per BullMQ's cleanup
        // settings), a duplicate add() DOES create a new job — this is
        // expected and safe: PosSyncProcessor's own terminal-state
        // compare-and-swap guard (story 9-1, unchanged) is the actual,
        // unconditional duplicate-processing safety net, not this jobId.
        { jobId: `pos-sync-${id}` },
      );
      const confirmed = await this.prisma.pOSSyncRecord.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: { dispatchedAt: new Date() },
      });
      if (confirmed.count > 0) {
        result.published++;
        this.logger.log(
          `dispatched posSyncRecordId=${id} venueId=${venueId} orderId=${orderId} claimId=${claimId}`,
        );
      } else {
        // Our own claim was superseded (lease expired and another
        // sweeper re-claimed) between the enqueue and this write. The
        // enqueue itself is harmless — see the jobId note above — and the
        // new claim owner will confirm its own dispatch.
        this.logger.warn(
          `posSyncRecordId=${id} claim ${claimId} was superseded before dispatch could be confirmed; enqueue already happened and is safe (see jobId note)`,
        );
      }
    } catch (err: unknown) {
      result.publishFailed++;
      const message = err instanceof Error ? err.message : 'Unknown enqueue error.';
      // Sanitized: never persist a raw stack trace, Redis connection
      // string, or credential — only a bounded, generic message.
      const sanitized = message.length > 300 ? `${message.slice(0, 300)}...` : message;
      await this.prisma.pOSSyncRecord.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: { lastDispatchError: `Enqueue failed: ${sanitized}` },
      });
      this.logger.warn(
        `enqueue failed for posSyncRecordId=${id} venueId=${venueId} claimId=${claimId}: ${sanitized}`,
      );
      // dispatchedAt stays null; dispatchClaimExpiresAt still governs when
      // this becomes re-eligible (AC4b) — no further action needed here.
    }
  }
}

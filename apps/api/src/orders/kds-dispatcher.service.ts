import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { KdsDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersGateway } from './orders.gateway';

export interface KdsDispatchSweepResult {
  eligible: number;
  claimed: number;
  pushed: number;
  pushFailed: number;
  markedCancelled: number;
  exhausted: number;
}

/**
 * Durable backstop for KDS order delivery. `OrdersService.broadcastOrder`
 * already emits an immediate, post-commit WebSocket push to an
 * already-connected Kitchen Display — that fast path is untouched by this
 * service. What it lacked: if the API process crashes or restarts between
 * the order-creation transaction's commit and that post-commit emit, the
 * order was never durably retried — nothing recorded that a KDS delivery was
 * even owed. `KdsDeliveryRecord` (created inside the same transaction as the
 * order, see orders.service.ts persistOrder) is that durable record; this
 * service periodically sweeps `queued` rows and pushes them over the same
 * `OrdersGateway.sendOrderUpdate` call `broadcastOrder` already uses.
 *
 * Deliberately simpler than PrinterDispatcherService/
 * IdealposOrderReconciliationService: there is no external connector to hand
 * off to and no terminal acknowledgement to reconcile — a WebSocket emit
 * either happens or throws in-process. `pushed` is therefore this leg's own
 * honest terminal state (see KdsDeliveryStatus's schema comment); there is no
 * `sweepReconcile()` because there is nothing external to reconcile against.
 */
@Injectable()
export class KdsDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KdsDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly claimLeaseMs: number;
  private readonly safetyNetMs: number;
  private readonly maxPushAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersGateway: OrdersGateway,
    config: ConfigService,
  ) {
    this.sweepIntervalMs = config.get<number>('KDS_DISPATCH_SWEEP_INTERVAL_MS', 5000);
    this.batchSize = config.get<number>('KDS_DISPATCH_BATCH_SIZE', 50);
    this.claimLeaseMs = config.get<number>('KDS_DISPATCH_CLAIM_LEASE_MS', 30_000);
    this.safetyNetMs = config.get<number>('KDS_DISPATCH_SAFETY_NET_MS', 10 * 60_000);
    this.maxPushAttempts = config.get<number>('KDS_DISPATCH_MAX_ATTEMPTS', 5);

    // Same startup guard as PrinterDispatcherService/PosSyncDispatcherService:
    // a misconfigured claim lease >= the safety-net window would let the
    // safety-net branch fire on a still-legitimately-in-flight claim before
    // its own lease even expires.
    if (this.claimLeaseMs >= this.safetyNetMs) {
      throw new Error(
        `KdsDispatcherService misconfigured: KDS_DISPATCH_CLAIM_LEASE_MS (${this.claimLeaseMs}) must be strictly less than KDS_DISPATCH_SAFETY_NET_MS (${this.safetyNetMs}).`,
      );
    }
  }

  onModuleInit(): void {
    // Same precedent as PrinterDispatcherService/PosSyncDispatcherService:
    // the timer must never run during the automated test suite, or it can
    // silently mutate other test files' fixture rows in the shared local dev
    // database. Tests call sweepDispatch() directly.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sweepDispatch().catch((err: unknown) => this.logSweepError(err));
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private logSweepError(err: unknown): void {
    this.logger.error(
      `dispatch sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : undefined,
    );
  }

  /**
   * One bounded dispatch-sweep tick. Every correctness guarantee comes from
   * the per-row database compare-and-swap in the claim step below, never
   * from anything read in this method's own candidate SELECT (advisory
   * candidate-discovery only — mirrors PrinterDispatcherService/
   * PosSyncDispatcherService).
   */
  /**
   * Eligibility, shared verbatim between the candidate SELECT and the claim
   * UPDATE's CAS guard. Two cases, unlike PrinterJob (where dispatch success
   * moves status away from `queued` entirely): a `queued` row never pushed
   * yet (with no live claim), or a `pushed` row whose `pushedAt` is stale —
   * since there is no ack channel, `pushed` is never provable "received," so
   * a stale-enough `pushed` row is periodically re-claimed and re-pushed as a
   * defensive redundancy against a silently-dropped emit, not just as a
   * crash-window backstop.
   */
  private eligibilityWhere(now: Date, safetyNetCutoff: Date) {
    const unclaimed = { OR: [{ dispatchClaimId: null }, { dispatchClaimExpiresAt: { lt: now } }] };
    return {
      dispatchExhaustedAt: null,
      OR: [
        { status: KdsDeliveryStatus.queued, ...unclaimed },
        { status: KdsDeliveryStatus.pushed, pushedAt: { lt: safetyNetCutoff }, ...unclaimed },
      ],
    };
  }

  async sweepDispatch(): Promise<KdsDispatchSweepResult> {
    const now = new Date();
    const safetyNetCutoff = new Date(now.getTime() - this.safetyNetMs);

    const candidates = await this.prisma.kdsDeliveryRecord.findMany({
      where: this.eligibilityWhere(now, safetyNetCutoff),
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      include: { order: { include: { items: true } } },
    });

    const result: KdsDispatchSweepResult = {
      eligible: candidates.length,
      claimed: 0,
      pushed: 0,
      pushFailed: 0,
      markedCancelled: 0,
      exhausted: 0,
    };

    for (const candidate of candidates) {
      try {
        await this.processDispatchCandidate(candidate, now, safetyNetCutoff, result);
      } catch (err: unknown) {
        this.logger.error(
          `Unexpected error dispatching kdsDeliveryRecordId=${candidate.id}: ${
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
      venueId: string;
      orderId: string;
      pushAttemptCount: number;
      order: { id: string; status: string } | null;
    },
    now: Date,
    safetyNetCutoff: Date,
    result: KdsDispatchSweepResult,
  ): Promise<void> {
    const { id, venueId, pushAttemptCount } = candidate;

    const liveStatuses = [KdsDeliveryStatus.queued, KdsDeliveryStatus.pushed];

    // Truthful ceiling before ever attempting a claim: an order cancelled
    // after its KDS delivery intent was queued (or after an earlier push,
    // for a row now up for periodic re-push) must never be pushed again.
    if (candidate.order && candidate.order.status === 'cancelled') {
      const cancelled = await this.prisma.kdsDeliveryRecord.updateMany({
        where: { id, status: { in: liveStatuses } },
        data: { status: KdsDeliveryStatus.cancelled },
      });
      if (cancelled.count > 0) result.markedCancelled++;
      return;
    }

    if (pushAttemptCount >= this.maxPushAttempts) {
      const exhausted = await this.prisma.kdsDeliveryRecord.updateMany({
        where: { id, status: { in: liveStatuses }, dispatchExhaustedAt: null },
        data: {
          status: KdsDeliveryStatus.exhausted,
          dispatchExhaustedAt: now,
          lastDispatchError: `Push attempt budget exhausted (${pushAttemptCount} attempts) — requires manual KDS refresh/verification by staff.`,
        },
      });
      if (exhausted.count > 0) {
        result.exhausted++;
        this.logger.error(
          `kdsDeliveryRecordId=${id} venueId=${venueId} exhausted push attempt budget (${pushAttemptCount} attempts) — requires manual staff verification`,
        );
      }
      return;
    }

    const claimId = randomUUID();
    const claimExpiresAt = new Date(now.getTime() + this.claimLeaseMs);
    const claim = await this.prisma.kdsDeliveryRecord.updateMany({
      where: { id, ...this.eligibilityWhere(now, safetyNetCutoff) },
      data: {
        dispatchClaimId: claimId,
        dispatchClaimedAt: now,
        dispatchClaimExpiresAt: claimExpiresAt,
      },
    });
    if (claim.count === 0) return; // lost the race to another sweeper — safe no-op
    result.claimed++;

    try {
      const orderWithItems = await this.prisma.order.findUnique({
        where: { id: candidate.orderId },
        include: { items: true },
      });
      this.ordersGateway.sendOrderUpdate(venueId, orderWithItems);

      const confirmed = await this.prisma.kdsDeliveryRecord.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: {
          status: KdsDeliveryStatus.pushed,
          pushedAt: new Date(),
          pushAttemptCount: { increment: 1 },
          lastDispatchError: null,
        },
      });
      if (confirmed.count > 0) {
        result.pushed++;
        this.logger.log(
          `pushed kdsDeliveryRecordId=${id} venueId=${venueId} orderId=${candidate.orderId} attempt=${pushAttemptCount}`,
        );
      } else {
        // Our own claim was superseded (lease expired and another sweeper
        // re-claimed) between the emit and this confirmation. The emit
        // itself already happened — a harmless extra/duplicate WebSocket
        // push to an already-connected client, never a duplicate order or
        // duplicate durable side effect.
        this.logger.warn(
          `kdsDeliveryRecordId=${id} claim ${claimId} was superseded before push could be confirmed`,
        );
      }
    } catch (err: unknown) {
      result.pushFailed++;
      await this.prisma.kdsDeliveryRecord.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: {
          lastDispatchError: 'Push attempt failed due to an internal error.',
        },
      });
      this.logger.warn(
        `push failed for kdsDeliveryRecordId=${id} venueId=${venueId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

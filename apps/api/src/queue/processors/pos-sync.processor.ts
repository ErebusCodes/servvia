import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { POSSyncStatus, POSAdapterType } from '@prisma/client';

/**
 * Story 9-1: no real Idealpos adapter exists in this codebase yet — every
 * option (ApiAdapter, SqlAdapter, OdbcAdapter, CsvAdapter, LocalAgentAdapter)
 * remains BLOCKED on decision record DL-064 (see docs/decisions-log.md).
 * This processor therefore has exactly two truthful, non-fabricated
 * outcomes: `posAdapterType: 'none'` (NullAdapter, by design) resolves to
 * `not_applicable`; any other configured adapter type resolves to
 * `unsupported`, because no adapter implementation exists to attempt a real
 * submission. Neither outcome ever contacts Idealpos, so `synced` and
 * `failed` — which require a real attempted-and-resolved submission — are
 * structurally unreachable from this processor until a real adapter lands
 * (E9-S3..S7). This replaces the removed code path that simulated a delay
 * and synthesized a plausible-looking `IDEAL-*` transaction ID, presenting
 * it as a confirmed Idealpos response it never was.
 */
@Processor('pos-sync')
export class PosSyncProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ posSyncRecordId: string }>): Promise<void> {
    const { posSyncRecordId } = job.data;
    if (!posSyncRecordId) return;

    const record = await this.prisma.pOSSyncRecord.findUnique({
      where: { id: posSyncRecordId },
    });
    if (!record) return;

    // Terminal states: nothing further to do. A duplicate or replayed queue
    // delivery of an already-resolved record must be a safe no-op — never
    // re-derive or overwrite a result another invocation already recorded.
    const terminal: POSSyncStatus[] = [
      POSSyncStatus.synced,
      POSSyncStatus.failed,
      POSSyncStatus.not_applicable,
      POSSyncStatus.unsupported,
    ];
    if (terminal.includes(record.status)) return;

    const targetStatus =
      record.adapterType === POSAdapterType.none
        ? POSSyncStatus.not_applicable
        : POSSyncStatus.unsupported;

    const errorMessage =
      targetStatus === POSSyncStatus.unsupported
        ? `No Idealpos adapter implementation exists yet for adapter type "${record.adapterType}" (blocked on decision record DL-064). This order was never submitted to Idealpos.`
        : null;

    // The outcome is a deterministic function of the record's own immutable
    // `adapterType` — no external system is contacted, so there is no
    // genuine duplicate-submission risk from processing the same record
    // twice. This compare-and-swap still matters: it is the database-level
    // guarantee that only a record still genuinely `not_synced` is ever
    // touched, so a duplicate/concurrent delivery of the same job resolves
    // to at most one write, and a resolved record can never be silently
    // reverted or overwritten by a stale, late-arriving duplicate.
    //
    // Neither `not_applicable` nor `unsupported` represents a real attempt
    // to reach Idealpos, so `attemptCount`/`lastAttemptAt` — which exist to
    // track real submission attempts for a future real adapter — are
    // deliberately left untouched here; incrementing them would falsely
    // imply an attempt occurred. `status`, `errorMessage` and the record's
    // own `updatedAt` are the truthful evidence trail for this story's
    // scope.
    //
    // Both writes — the record itself and its Order.posSyncStatus mirror —
    // are issued inside one database transaction, not as two independent
    // round-trips. A worker that crashed between two separate `await`s here
    // (found in independent review) would leave the record terminal while
    // its order permanently still read `not_synced`: reprocessing is a
    // guaranteed no-op once the record is terminal (the `terminal.includes`
    // check above), so nothing would ever revisit the order to correct it.
    // Batching removes that window: either both rows move together, or
    // neither does. Order.status (the kitchen/service workflow state) is
    // never touched here — POS-sync state must remain independent of
    // order/KDS/payment/printer state (target-operating-model.md §7).
    await this.prisma.$transaction([
      this.prisma.pOSSyncRecord.updateMany({
        where: { id: posSyncRecordId, status: POSSyncStatus.not_synced },
        data: { status: targetStatus, errorMessage },
      }),
      this.prisma.order.updateMany({
        where: { id: record.orderId, posSyncStatus: POSSyncStatus.not_synced },
        data: { posSyncStatus: targetStatus },
      }),
    ]);
  }
}

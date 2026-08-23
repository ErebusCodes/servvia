import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ConnectorCommandStatus, PrintJobStatus } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { renderKotContent } from './kot-renderer';
import {
  KOT_RESULT_TYPE,
  PRINT_KOT_COMMAND_TYPE,
  PRINT_KOT_SCHEMA_VERSION,
  PRINT_KOT_REQUIRED_CAPABILITY,
} from './printer-connector-command.constants';

export interface PrinterDispatchSweepResult {
  eligible: number;
  claimed: number;
  dispatched: number;
  dispatchFailed: number;
  markedManual: number;
  markedCancelled: number;
  exhausted: number;
}

export interface PrinterReconcileSweepResult {
  examined: number;
  delivered: number;
  retried: number;
  manual: number;
  failed: number;
  uncertain: number;
  cancelled: number;
}

/**
 * E8-S1 (expanded): the missing production producer. Root cause (see the
 * story file and this session's own investigation): `PrintJobsProcessor`
 * (story 8-1) is a real, tested BullMQ worker, but nothing has ever called
 * `.add()` on the `print-jobs` queue — and per DL-069, feeding it as-is
 * would be wrong anyway, since its TCP branch opens a direct cloud-to-LAN
 * socket. This service is a completely separate, DL-069-compliant producer:
 * it turns a durably-committed `queued` `PrinterJob` into a durable
 * `ConnectorCommand` row (`printer.print_kot.v1`) that an on-premise Venue
 * Connector installation pulls via the already-reviewed poll/accept/report
 * protocol (stories 2-9/2-10). It never opens a socket, never contacts a
 * printer, and never contacts a venue LAN — its only I/O is the cloud API's
 * own Postgres connection, the same one every other write in this process
 * already uses.
 *
 * Architecturally this is the transactional-outbox pattern
 * `PosSyncDispatcherService` (story 9-3) established, adapted for a
 * connector-pull consumer instead of an in-process BullMQ worker: the
 * `ConnectorCommand` row itself IS the durable queue here, so there is no
 * second internal queue to feed.
 *
 * `PrintJobsProcessor` and the `print-jobs` BullMQ queue are left
 * completely untouched by this file and remain permanently unfed by any
 * code path this story adds — see
 * `printer-dispatcher.service.spec.ts`'s regression test asserting this
 * file's own source contains no `net.Socket`/`createConnection`/BullMQ
 * queue reference.
 */
@Injectable()
export class PrinterDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrinterDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly claimLeaseMs: number;
  private readonly safetyNetMs: number;
  private readonly maxDispatchAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorCommandService: ConnectorCommandService,
    config: ConfigService,
  ) {
    this.sweepIntervalMs = config.get<number>('PRINTER_DISPATCH_SWEEP_INTERVAL_MS', 5000);
    this.batchSize = config.get<number>('PRINTER_DISPATCH_BATCH_SIZE', 50);
    this.claimLeaseMs = config.get<number>('PRINTER_DISPATCH_CLAIM_LEASE_MS', 30_000);
    this.safetyNetMs = config.get<number>('PRINTER_DISPATCH_SAFETY_NET_MS', 10 * 60_000);
    this.maxDispatchAttempts = config.get<number>('PRINTER_DISPATCH_MAX_ATTEMPTS', 5);

    // Mirrors PosSyncDispatcherService's own independent-review fix: a
    // misconfigured claim lease >= the safety-net window would let the
    // safety-net branch fire on a still-legitimately-in-flight claim before
    // its own lease even expires. Harmless in practice (the idempotent
    // command-creation path absorbs the resulting redundant re-claim), but
    // a silent misconfiguration worth failing fast on at startup.
    if (this.claimLeaseMs >= this.safetyNetMs) {
      throw new Error(
        `PrinterDispatcherService misconfigured: PRINTER_DISPATCH_CLAIM_LEASE_MS (${this.claimLeaseMs}) must be strictly less than PRINTER_DISPATCH_SAFETY_NET_MS (${this.safetyNetMs}).`,
      );
    }
  }

  onModuleInit(): void {
    // See PosSyncDispatcherService's identical precedent: the timer must
    // never run during the automated test suite, or it can silently mutate
    // other test files' fixture rows in the shared local dev database.
    // Tests call sweepDispatch()/sweepReconcile() directly.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sweepDispatch().catch((err: unknown) => this.logSweepError('dispatch', err));
      this.sweepReconcile().catch((err: unknown) => this.logSweepError('reconcile', err));
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private logSweepError(kind: string, err: unknown): void {
    this.logger.error(
      `${kind} sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : undefined,
    );
  }

  /**
   * One bounded dispatch-sweep tick. Every correctness guarantee comes from
   * the per-row database compare-and-swap in the claim step below, never
   * from anything read in this method's own candidate SELECT (advisory
   * candidate-discovery only — mirrors PosSyncDispatcherService's AC1).
   */
  async sweepDispatch(): Promise<PrinterDispatchSweepResult> {
    const now = new Date();
    const safetyNetCutoff = new Date(now.getTime() - this.safetyNetMs);

    const candidates = await this.prisma.printerJob.findMany({
      where: {
        status: PrintJobStatus.queued,
        dispatchExhaustedAt: null,
        OR: [
          {
            dispatchedAt: null,
            OR: [{ dispatchClaimId: null }, { dispatchClaimExpiresAt: { lt: now } }],
          },
          { dispatchedAt: { lt: safetyNetCutoff } },
        ],
      },
      orderBy: { queuedAt: 'asc' },
      take: this.batchSize,
      include: { printer: true, order: true, venue: { select: { organizationId: true } } },
    });

    const result: PrinterDispatchSweepResult = {
      eligible: candidates.length,
      claimed: 0,
      dispatched: 0,
      dispatchFailed: 0,
      markedManual: 0,
      markedCancelled: 0,
      exhausted: 0,
    };

    for (const candidate of candidates) {
      try {
        await this.processDispatchCandidate(candidate, now, safetyNetCutoff, result);
      } catch (err: unknown) {
        this.logger.error(
          `Unexpected error dispatching printerJobId=${candidate.id}: ${
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
      orderId: string | null;
      dispatchAttemptCount: number;
      printer: { id: string; isActive: boolean; name: string; type: string; charPerLine: number };
      order: {
        id: string;
        status: string;
        tableNumber: string | null;
        notes: string | null;
        serviceMode: 'dine_in' | 'takeaway';
        takeawayReference: string | null;
      } | null;
      venue: { organizationId: string };
    },
    now: Date,
    safetyNetCutoff: Date,
    result: PrinterDispatchSweepResult,
  ): Promise<void> {
    const { id, venueId, dispatchAttemptCount } = candidate;

    // Truthful ceiling before ever attempting a claim: a job whose order was
    // cancelled after being queued must never be dispatched — respects
    // order cancellation, matches the required state "cancelled/superseded".
    if (candidate.order && candidate.order.status === 'cancelled') {
      const cancelled = await this.prisma.printerJob.updateMany({
        where: { id, status: PrintJobStatus.queued },
        data: { status: PrintJobStatus.cancelled },
      });
      if (cancelled.count > 0) result.markedCancelled++;
      return;
    }

    // Station mapping removed after job creation: the printer this job
    // targets is no longer active. Never silently drop it — surface as
    // operator work (AC: "disabled or missing preparation-station routing
    // becomes visible operator work, not silent loss").
    if (!candidate.printer.isActive) {
      const manual = await this.prisma.printerJob.updateMany({
        where: { id, status: PrintJobStatus.queued },
        data: {
          status: PrintJobStatus.manual,
          errorMessage: 'Target printer is no longer active; ticket requires manual handling.',
        },
      });
      if (manual.count > 0) result.markedManual++;
      return;
    }

    if (dispatchAttemptCount >= this.maxDispatchAttempts) {
      const exhausted = await this.prisma.printerJob.updateMany({
        where: { id, status: PrintJobStatus.queued, dispatchExhaustedAt: null },
        data: {
          status: PrintJobStatus.manual,
          dispatchExhaustedAt: now,
          lastDispatchError: `Dispatch attempt budget exhausted (${dispatchAttemptCount} attempts) — requires manual reprint/review.`,
        },
      });
      if (exhausted.count > 0) {
        result.exhausted++;
        this.logger.error(
          `printerJobId=${id} venueId=${venueId} exhausted dispatch attempt budget (${dispatchAttemptCount} attempts) — requires manual review`,
        );
      }
      return;
    }

    const claimId = randomUUID();
    const claimExpiresAt = new Date(now.getTime() + this.claimLeaseMs);
    const claim = await this.prisma.printerJob.updateMany({
      where: {
        id,
        status: PrintJobStatus.queued,
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
        // Deliberately NOT incrementing dispatchAttemptCount here — see the
        // idempotencyKey note below. A claim reclaiming an interrupted
        // attempt (crash between command-creation and confirmation) must
        // resolve to the SAME attempt number, not mint a new one, or the
        // idempotent command-creation guarantee below would be defeated.
        dispatchedAt: null,
      },
    });
    if (claim.count === 0) return; // lost the race to another sweeper — safe no-op
    result.claimed++;

    try {
      const jobForRender = await this.prisma.printerJob.findUniqueOrThrow({
        where: { id },
        include: {
          order: { include: { items: true } },
          printer: true,
        },
      });
      const organizationId = candidate.venue.organizationId;

      const rendered = renderKotContent({
        printerJobId: id,
        orderId: jobForRender.orderId,
        tableNumber: jobForRender.order?.tableNumber ?? null,
        serviceMode: jobForRender.order?.serviceMode ?? 'dine_in',
        takeawayReference: jobForRender.order?.takeawayReference ?? null,
        printerName: jobForRender.printer.name,
        station: jobForRender.printer.type,
        orderNotes: jobForRender.order?.notes ?? null,
        charPerLine: jobForRender.printer.charPerLine,
        items: (jobForRender.order?.items ?? []).map((item) => ({
          menuItemTitle: item.menuItemTitle,
          quantity: item.quantity,
          notes: item.notes,
          selectedModifiers: (Array.isArray(item.selectedModifiers)
            ? (item.selectedModifiers as Array<{
                modifierGroupName?: string | null;
                optionName?: string;
              }>)
            : []
          ).map((m) => ({
            modifierGroupName: m.modifierGroupName ?? null,
            optionName: m.optionName ?? '',
          })),
        })),
      });

      // Idempotency key is a pure function of (printerJobId, attempt number
      // read at claim time, unchanged above). A reclaim of an interrupted
      // attempt recomputes the identical key, so createCommand()'s own
      // P2002-idempotent-return path resolves to the SAME command row
      // rather than creating a duplicate — this is the actual database-
      // enforced uniqueness guarantee (ConnectorCommand's existing
      // @@unique([organizationId, venueId, idempotencyKey])), not an
      // application-level check.
      const idempotencyKey = `printer_job:${id}:attempt:${dispatchAttemptCount}`;
      const command = await this.connectorCommandService.createCommand({
        organizationId,
        venueId,
        commandType: PRINT_KOT_COMMAND_TYPE,
        schemaVersion: PRINT_KOT_SCHEMA_VERSION,
        requiredCapability: PRINT_KOT_REQUIRED_CAPABILITY,
        sourceAggregateType: 'PrinterJob',
        sourceRecordId: id,
        idempotencyKey,
        correlationId: jobForRender.orderId ?? undefined,
        payload: {
          printerJobId: id,
          printAttemptId: idempotencyKey,
          printerId: jobForRender.printerId,
          printerName: jobForRender.printer.name,
          station: jobForRender.printer.type,
          documentType: 'kot',
          renderVersion: rendered.renderVersion,
          renderedContent: rendered.content,
          contentChecksum: rendered.checksum,
          copyCount: 1,
        },
      });

      const confirmed = await this.prisma.printerJob.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: {
          status: PrintJobStatus.connector_dispatched,
          connectorCommandId: command.id,
          dispatchedAt: new Date(),
          dispatchAttemptCount: { increment: 1 },
          lastDispatchError: null,
        },
      });
      if (confirmed.count > 0) {
        result.dispatched++;
        this.logger.log(
          `dispatched printerJobId=${id} venueId=${venueId} commandId=${command.id} attempt=${dispatchAttemptCount}`,
        );
      } else {
        // Our own claim was superseded (lease expired and another sweeper
        // re-claimed) between command creation and this confirmation. The
        // command creation itself is safe — see the idempotencyKey note
        // above — the new claim owner will confirm its own dispatch (or
        // resolve to the same command via the same idempotent key).
        this.logger.warn(
          `printerJobId=${id} claim ${claimId} was superseded before dispatch could be confirmed; command creation is safe (see idempotencyKey note)`,
        );
      }
    } catch (err: unknown) {
      result.dispatchFailed++;
      const sanitized = PrinterDispatcherService.classifyDispatchError(err);
      await this.prisma.printerJob.updateMany({
        where: { id, dispatchClaimId: claimId },
        data: { lastDispatchError: `Command creation failed: ${sanitized}` },
      });
      // The raw error (not the sanitized classification) is fine in the
      // process's own log output — this is server-side, not persisted to a
      // field the admin API returns — mirroring print-jobs.processor.ts's
      // classifyPrinterError() convention of the same split.
      this.logger.warn(
        `command creation failed for printerJobId=${id} venueId=${venueId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Independent review finding: this field was previously populated with
   * `err.message` (only length-truncated, not actually redacted) despite
   * its own schema comment promising "sanitized ... never a raw stack/
   * secret." A Prisma/database-layer error can carry connection details
   * (host, pool state); this is returned verbatim through the admin
   * `listForPrinter`/`listForOrder` endpoints, so it must never carry raw
   * driver text. Mirrors print-jobs.processor.ts's `classifyPrinterError()`
   * split: fixed, sanitized strings only, by error class.
   */
  private static classifyDispatchError(err: unknown): string {
    if (err instanceof BadRequestException) {
      // App-authored, already user-safe (e.g. "Command payload exceeds the
      // maximum allowed size") — no internal details possible here.
      return err.message;
    }
    if (err instanceof PrismaClientKnownRequestError) {
      return `Database error (${err.code}).`;
    }
    return 'Command creation failed due to an internal error.';
  }

  /**
   * Reconciliation sweep: maps a linked ConnectorCommand's terminal or
   * quasi-terminal state back onto the truthful PrinterJob status, guarded
   * by a CAS on `status = connector_dispatched` (mirrors story 8-1's
   * `resolveFrom` — a late/duplicate reconciliation pass can never clobber
   * a status a previous pass, or a manual reprint, already moved past).
   */
  async sweepReconcile(): Promise<PrinterReconcileSweepResult> {
    const rows = await this.prisma.printerJob.findMany({
      where: {
        status: PrintJobStatus.connector_dispatched,
        connectorCommandId: { not: null },
      },
      take: this.batchSize,
      include: { connectorCommand: true },
    });

    const result: PrinterReconcileSweepResult = {
      examined: rows.length,
      delivered: 0,
      retried: 0,
      manual: 0,
      failed: 0,
      uncertain: 0,
      cancelled: 0,
    };

    for (const row of rows) {
      try {
        await this.reconcileOne(row, result);
      } catch (err: unknown) {
        this.logger.error(
          `Unexpected error reconciling printerJobId=${row.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    return result;
  }

  private async reconcileOne(
    row: {
      id: string;
      connectorCommandId: string | null;
      dispatchAttemptCount: number;
      connectorCommand: {
        id: string;
        status: ConnectorCommandStatus;
        resultType: string | null;
        failureReason: string | null;
      } | null;
    },
    result: PrinterReconcileSweepResult,
  ): Promise<void> {
    const command = row.connectorCommand;
    if (!command) return;

    const guardedUpdate = (data: Record<string, unknown>) =>
      this.prisma.printerJob.updateMany({
        where: {
          id: row.id,
          status: PrintJobStatus.connector_dispatched,
          connectorCommandId: command.id,
        },
        data,
      });

    switch (command.status) {
      case ConnectorCommandStatus.succeeded: {
        // Independent review finding: a truthful ConnectorCommandStatus of
        // `succeeded` alone is not sufficient evidence of `delivered` — this
        // story's own state-machine table promises `delivered` is set only
        // from `succeeded` + `resultType: executed_acknowledged`, but the
        // status alone was previously trusted without checking resultType.
        // A connector (buggy or malicious) could report `succeeded` with
        // any other resultType. Rather than blindly trust `succeeded` OR
        // silently leave the job stuck forever, an unexpected pairing fails
        // safe to `uncertain` — never auto-retried, requires an explicit,
        // audited manual reprint, exactly like a genuinely ambiguous result.
        if (command.resultType !== KOT_RESULT_TYPE.EXECUTED_ACKNOWLEDGED) {
          const r = await guardedUpdate({
            status: PrintJobStatus.uncertain,
            errorMessage: `Connector reported succeeded with an unexpected resultType "${String(
              command.resultType,
            )}" — cannot be trusted as delivered. Resolve via manual reprint.`,
          });
          if (r.count > 0) result.uncertain++;
          return;
        }
        const r = await guardedUpdate({
          status: PrintJobStatus.delivered,
          deliveredAt: new Date(),
          errorMessage: null,
        });
        if (r.count > 0) result.delivered++;
        return;
      }

      case ConnectorCommandStatus.cancelled: {
        const r = await guardedUpdate({ status: PrintJobStatus.cancelled });
        if (r.count > 0) result.cancelled++;
        return;
      }

      case ConnectorCommandStatus.unknown: {
        // Accepted but no terminal report arrived — the crash-after-print-
        // before-ack window. Never auto-retried: could duplicate a ticket.
        const r = await guardedUpdate({
          status: PrintJobStatus.uncertain,
          errorMessage:
            'Connector accepted this print command but never reported a result. Resolve via manual reprint.',
        });
        if (r.count > 0) result.uncertain++;
        return;
      }

      case ConnectorCommandStatus.expired: {
        // Nothing was ever confirmed accepted by a connector — confirmed
        // NOT executed, safe to auto-retry within the attempt budget.
        await this.retryOrExhaust(
          row,
          guardedUpdate,
          'Command expired before any connector accepted it.',
          result,
        );
        return;
      }

      case ConnectorCommandStatus.failed: {
        await this.reconcileFailed(row, command, guardedUpdate, result);
        return;
      }

      // pending / claimed / accepted: still genuinely in flight. Nothing to
      // reconcile yet.
      default:
        return;
    }
  }

  private async reconcileFailed(
    row: { id: string; dispatchAttemptCount: number },
    command: { resultType: string | null; failureReason: string | null },
    guardedUpdate: (data: Record<string, unknown>) => Promise<{ count: number }>,
    result: PrinterReconcileSweepResult,
  ): Promise<void> {
    const reason = command.failureReason ? `: ${command.failureReason}` : '';

    switch (command.resultType) {
      case KOT_RESULT_TYPE.RETRYABLE_LOCAL_FAILURE: {
        await this.retryOrExhaust(
          row,
          guardedUpdate,
          `Connector reported a retryable local failure${reason}`,
          result,
        );
        return;
      }

      case KOT_RESULT_TYPE.UNSUPPORTED:
      case KOT_RESULT_TYPE.UNSUPPORTED_VERSION: {
        const r = await guardedUpdate({
          status: PrintJobStatus.manual,
          errorMessage: `Connector cannot execute this print command${reason}. Requires manual handling or configuration fix.`,
        });
        if (r.count > 0) result.manual++;
        return;
      }

      case KOT_RESULT_TYPE.UNCERTAIN_LOCAL_RESULT: {
        const r = await guardedUpdate({
          status: PrintJobStatus.uncertain,
          errorMessage: `Connector could not confirm the outcome${reason}. Resolve via manual reprint.`,
        });
        if (r.count > 0) result.uncertain++;
        return;
      }

      case KOT_RESULT_TYPE.CANCELLED: {
        const r = await guardedUpdate({ status: PrintJobStatus.cancelled });
        if (r.count > 0) result.cancelled++;
        return;
      }

      case KOT_RESULT_TYPE.CHECKSUM_MISMATCH:
      case KOT_RESULT_TYPE.MALFORMED_PAYLOAD: {
        // A rendering/config defect, not a transient fault — retrying
        // without a code fix would just reproduce the same corrupt payload.
        const r = await guardedUpdate({
          status: PrintJobStatus.failed,
          failedAt: new Date(),
          errorMessage: `Non-retryable dispatch defect${reason}`,
        });
        if (r.count > 0) result.failed++;
        return;
      }

      default: {
        // Unrecognized resultType: fail closed to the safest non-committal
        // state rather than guess whether auto-retry is safe.
        const r = await guardedUpdate({
          status: PrintJobStatus.manual,
          errorMessage: `Connector reported failure with an unrecognized resultType "${String(
            command.resultType,
          )}"${reason}. Requires manual review.`,
        });
        if (r.count > 0) result.manual++;
      }
    }
  }

  private async retryOrExhaust(
    row: { id: string; dispatchAttemptCount: number },
    guardedUpdate: (data: Record<string, unknown>) => Promise<{ count: number }>,
    reason: string,
    result: PrinterReconcileSweepResult,
  ): Promise<void> {
    if (row.dispatchAttemptCount >= this.maxDispatchAttempts) {
      const r = await guardedUpdate({
        status: PrintJobStatus.failed,
        failedAt: new Date(),
        dispatchExhaustedAt: new Date(),
        errorMessage: `${reason} Dispatch attempt budget exhausted (${row.dispatchAttemptCount} attempts).`,
      });
      if (r.count > 0) result.failed++;
      return;
    }
    // Confirmed-safe to retry: nothing was ever executed. Reset to `queued`
    // so the next dispatch sweep mints a fresh attempt (new idempotencyKey,
    // new ConnectorCommand) — never re-uses the failed command. Clearing
    // dispatchedAt (not just the claim fields) is required: sweepDispatch's
    // own eligibility query only re-selects a `queued` row whose
    // dispatchedAt is null (or older than the safety-net window) — a stale
    // non-null dispatchedAt from the just-superseded attempt would make
    // this row invisible to the next dispatch sweep for up to
    // PRINTER_DISPATCH_SAFETY_NET_MS, defeating "safe and bounded" retry.
    const r = await guardedUpdate({
      status: PrintJobStatus.queued,
      dispatchClaimId: null,
      dispatchClaimedAt: null,
      dispatchClaimExpiresAt: null,
      dispatchedAt: null,
      lastDispatchError: reason,
    });
    if (r.count > 0) result.retried++;
  }
}

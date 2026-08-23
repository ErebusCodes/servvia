import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrintJobStatus, PrinterJob, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';

/**
 * A print job is only safe to reprint once its own automated attempt is no
 * longer in flight. Reprinting a job that might still complete on its own
 * (queued/accepted/dispatching, or — E8-S1 expanded — connector_dispatched,
 * where a ConnectorCommand may currently be pending/claimed/executing at an
 * on-premise connector) risks a genuine duplicate physical ticket — exactly
 * what Story 8-1 exists to prevent, just via a careless manual action
 * instead of an automatic one.
 */
const NON_REPRINTABLE_STATUSES: PrintJobStatus[] = [
  PrintJobStatus.queued,
  PrintJobStatus.accepted,
  PrintJobStatus.dispatching,
  PrintJobStatus.connector_dispatched,
];

interface ReprintActor {
  id: string;
  email: string;
  role: StaffRole;
}

/**
 * E8-S1 (expanded): "retry only when safe" for `manual` jobs — distinct
 * from `requestReprint`, which always creates a brand-new row for any
 * terminal status. `manual` in this codebase's state machine is reserved
 * exclusively for confirmed-not-executed outcomes (deactivated printer,
 * connector-reported unsupported config, exhausted-but-never-executed
 * dispatch attempts) — never for an ambiguous/uncertain outcome (that is
 * `uncertain`, which requires `requestReprint`'s new-attempt lineage
 * instead). Retrying in place is therefore safe here: nothing was ever
 * transmitted to a printer for this exact job, so resetting it to `queued`
 * cannot produce a duplicate physical ticket.
 */
const RETRYABLE_STATUSES: PrintJobStatus[] = [PrintJobStatus.manual];

@Injectable()
export class PrinterJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listForPrinter(
    printerId: string,
    organizationId: string,
    venueId: string | undefined,
    status?: string,
  ): Promise<PrinterJob[]> {
    const printer = await this.prisma.printer.findFirst({
      where: { id: printerId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
    });
    if (!printer) {
      throw new NotFoundException('Printer not found');
    }

    const statusFilter = this.parseStatusFilter(status);
    return this.prisma.printerJob.findMany({
      where: { printerId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      // E8-S1 (expanded): join the linked ConnectorCommand's own status so
      // operators see dispatch/command state (pending/claimed/accepted,
      // resultType, claimedByInstallationId, last acceptance/report
      // timestamps) without a second call — the same PrinterJob row already
      // carries dispatchAttemptCount/lastDispatchError for the producer-
      // level history. Never returns fabricated data: absent
      // connectorCommand means dispatch has not happened yet.
      include: {
        connectorCommand: {
          select: {
            id: true,
            status: true,
            resultType: true,
            failureReason: true,
            claimedByInstallationId: true,
            claimedAt: true,
            acceptedAt: true,
            reportedAt: true,
          },
        },
      },
    });
  }

  async listForOrder(
    orderId: string,
    organizationId: string,
    venueId: string | undefined,
  ): Promise<PrinterJob[]> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.printerJob.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        connectorCommand: {
          select: {
            id: true,
            status: true,
            resultType: true,
            failureReason: true,
            claimedByInstallationId: true,
            claimedAt: true,
            acceptedAt: true,
            reportedAt: true,
          },
        },
      },
    });
  }

  /**
   * Creates a brand-new PrinterJob row linked to the original via
   * `reprintOfId` — never mutates the original job's own history. Copies
   * the original's payload verbatim rather than regenerating it from
   * current order state, so a reprint reproduces exactly what was supposed
   * to print (the same reasoning that keeps Story 6-1's idempotent replay
   * from re-validating live state — see deferred-work.md).
   *
   * Two concurrent reprint requests against the same original job (a
   * double-click, or a client retrying a request whose response it never
   * saw) must not create two independently-dispatchable jobs — that would
   * be a real duplicate physical ticket from a careless manual action,
   * exactly the class of bug this story exists to prevent. The fast-path
   * checks above are an optimization only; a `SELECT ... FOR UPDATE` lock
   * on the original row is the actual, database-enforced guard (found
   * missing in independent review — the original version was a plain
   * check-then-create with a real TOCTOU gap under genuine concurrency).
   *
   * E8-S1 (expanded) independent review found a second, related gap: the
   * outer `NON_REPRINTABLE_STATUSES` check above reads a STALE `original`
   * snapshot fetched before the transaction/lock even opens. A concurrent
   * `retryDispatch` call (or, in principle, anything else that mutates this
   * exact row) can move the job from `manual` to `queued` in the window
   * between that stale read and this transaction acquiring the row lock —
   * the lock alone does not re-validate status, only serializes access to
   * it. Fixed by re-reading the row's CURRENT status inside the
   * transaction, after the lock, and re-rejecting if it is no longer
   * reprintable — this is what actually closes the race, not the lock by
   * itself.
   */
  async requestReprint(
    printerId: string,
    jobId: string,
    organizationId: string,
    venueId: string | undefined,
    actor: ReprintActor,
  ): Promise<PrinterJob> {
    const original = await this.prisma.printerJob.findFirst({
      where: { id: jobId, printerId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
    });
    if (!original) {
      throw new NotFoundException('Print job not found');
    }
    if (NON_REPRINTABLE_STATUSES.includes(original.status)) {
      throw new ConflictException(
        'This print job is still in progress and cannot be reprinted yet.',
      );
    }

    const reprint = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent reprint requests against this exact original:
      // the second transaction blocks here until the first commits, then
      // re-observes its newly-created in-flight reprint below.
      await tx.$executeRaw`SELECT id FROM "PrinterJob" WHERE id = ${original.id} FOR UPDATE`;

      // Re-validate against the row's CURRENT status, not the stale
      // pre-transaction snapshot above — see this method's own doc comment.
      const current = await tx.printerJob.findUniqueOrThrow({ where: { id: original.id } });
      if (NON_REPRINTABLE_STATUSES.includes(current.status)) {
        throw new ConflictException(
          'This print job is now in progress and cannot be reprinted yet.',
        );
      }

      const inFlightReprint = await tx.printerJob.findFirst({
        where: {
          reprintOfId: original.id,
          status: {
            in: [
              PrintJobStatus.queued,
              PrintJobStatus.accepted,
              PrintJobStatus.dispatching,
              PrintJobStatus.connector_dispatched,
            ],
          },
        },
      });
      if (inFlightReprint) {
        throw new ConflictException('A reprint of this job is already in progress.');
      }

      return tx.printerJob.create({
        data: {
          printerId: current.printerId,
          orderId: current.orderId,
          venueId: current.venueId,
          status: PrintJobStatus.queued,
          payload: current.payload,
          payloadFormat: current.payloadFormat,
          reprintOfId: current.id,
          reprintRequestedById: actor.id,
        },
      });
    });

    await this.logAuditEventSafely({
      organizationId,
      venueId: original.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'PRINTER_JOB_REPRINT_REQUESTED',
      resource: 'printer_job',
      resourceId: reprint.id,
      after: { originalJobId: original.id, printerId: original.printerId },
    });

    return reprint;
  }

  /**
   * Resets a `manual` job to `queued` for `PrinterDispatcherService`'s next
   * sweep to pick up — in place, not a new row, because nothing was ever
   * transmitted for this exact attempt (see RETRYABLE_STATUSES doc
   * comment).
   *
   * Takes the SAME `SELECT ... FOR UPDATE` row lock `requestReprint` uses
   * on this exact job id, and — symmetrically with `requestReprint`'s own
   * in-flight-reprint check — refuses to proceed if a reprint of this job
   * is currently in flight. Without this, a `requestReprint` that runs
   * first (creating a new, independently-dispatchable row and leaving the
   * original untouched at `manual`) followed by a concurrent
   * `retryDispatch` on the same original would reset the original to
   * `queued` too — two dispatchable rows for one logical ticket. This is
   * the reverse ordering of the race independent review found in
   * `requestReprint` alone; fixing only that direction left this one open.
   */
  async retryDispatch(
    printerId: string,
    jobId: string,
    organizationId: string,
    venueId: string | undefined,
    actor: ReprintActor,
  ): Promise<PrinterJob> {
    const original = await this.prisma.printerJob.findFirst({
      where: { id: jobId, printerId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
    });
    if (!original) {
      throw new NotFoundException('Print job not found');
    }
    if (!RETRYABLE_STATUSES.includes(original.status)) {
      throw new ConflictException(
        'This print job is not in a state that can be safely retried in place. Use reprint instead.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "PrinterJob" WHERE id = ${jobId} FOR UPDATE`;

      const current = await tx.printerJob.findUniqueOrThrow({ where: { id: jobId } });
      if (!RETRYABLE_STATUSES.includes(current.status)) {
        throw new ConflictException('This print job changed state and can no longer be retried.');
      }

      const inFlightReprint = await tx.printerJob.findFirst({
        where: {
          reprintOfId: jobId,
          status: {
            in: [
              PrintJobStatus.queued,
              PrintJobStatus.accepted,
              PrintJobStatus.dispatching,
              PrintJobStatus.connector_dispatched,
            ],
          },
        },
      });
      if (inFlightReprint) {
        throw new ConflictException(
          'A reprint of this job is already in progress; use that instead of retrying in place.',
        );
      }

      const result = await tx.printerJob.updateMany({
        where: { id: jobId, status: PrintJobStatus.manual },
        data: {
          status: PrintJobStatus.queued,
          dispatchClaimId: null,
          dispatchClaimedAt: null,
          dispatchClaimExpiresAt: null,
          dispatchedAt: null,
          dispatchAttemptCount: 0,
          dispatchExhaustedAt: null,
          lastDispatchError: null,
          errorMessage: null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('This print job changed state and can no longer be retried.');
      }
    });

    await this.logAuditEventSafely({
      organizationId,
      venueId: original.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'PRINTER_JOB_MANUAL_RETRY_REQUESTED',
      resource: 'printer_job',
      resourceId: jobId,
      before: { status: original.status },
      after: { status: PrintJobStatus.queued },
    });

    return this.prisma.printerJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  private parseStatusFilter(status?: string): PrintJobStatus | undefined {
    if (status === undefined) return undefined;
    if (!Object.values(PrintJobStatus).includes(status as PrintJobStatus)) {
      throw new BadRequestException(`Invalid status filter: ${status}`);
    }
    return status as PrintJobStatus;
  }

  /**
   * Best-effort audit write, matching OrdersService's convention: the
   * reprint has already been durably created by the time this runs, and a
   * transient audit-log failure must not turn that into a 500.
   */
  private async logAuditEventSafely(
    event: Parameters<AuditLogService['logAuthEvent']>[0],
  ): Promise<void> {
    try {
      await this.auditLogService.logAuthEvent(event);
    } catch (auditError) {
      console.error(
        '[PrinterJobsService] audit log write failed (non-fatal):',
        event.action,
        auditError,
      );
    }
  }
}

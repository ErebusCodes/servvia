import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintJobStatus, PrinterConnectionType, Prisma } from '@prisma/client';
import * as net from 'net';

/**
 * Story 8-1: only these classified, sanitized strings are ever persisted as
 * PrinterJob.errorMessage. Never persist a raw Node error — on real
 * printers `err.message` routinely embeds the venue's internal host/IP and
 * port (e.g. "connect ECONNREFUSED 10.0.5.23:9100"), and this field is
 * readable through the admin API (see PrinterJobsService).
 */
function classifyPrinterError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ECONNREFUSED':
      return 'Printer refused the connection.';
    case 'ETIMEDOUT':
      return 'Connection to the printer timed out.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Printer host is unreachable.';
    case 'ENOTFOUND':
      return 'Printer hostname could not be resolved.';
    case 'ECONNRESET':
      return 'The printer closed the connection unexpectedly.';
  }
  if (err instanceof Error && err.message === 'Timeout connecting to printer') {
    return 'Connection to the printer timed out.';
  }
  if (err instanceof Error && err.message === 'MISSING_HOST_CONFIG') {
    return 'Printer connection is not configured with a host address.';
  }
  return 'Printer dispatch failed.';
}

@Processor('print-jobs')
export class PrintJobsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  async process(job: Job<{ printerJobId: string }>): Promise<void> {
    const { printerJobId } = job.data;
    if (!printerJobId) return;

    const dbJob = await this.prisma.printerJob.findUnique({
      where: { id: printerJobId },
      include: { printer: true },
    });
    if (!dbJob) return;

    // Terminal states: nothing further to do. `delivered` is included
    // because, absent a real acknowledgement mechanism, it is this
    // codebase's ceiling for TCP jobs today — re-processing it would mean
    // sending the bytes a second time, i.e. a real duplicate transmission.
    const terminal: PrintJobStatus[] = [
      PrintJobStatus.printed,
      PrintJobStatus.delivered,
      PrintJobStatus.manual,
      PrintJobStatus.failed,
      PrintJobStatus.cancelled,
      PrintJobStatus.uncertain,
    ];
    if (terminal.includes(dbJob.status)) return;

    // Found already `accepted` or `dispatching` on a re-observation (this
    // call did not just win the claim below — see the crash-window review
    // finding this addresses): a previous invocation either still owns this
    // job right now, or crashed somewhere after claiming it and before
    // recording an outcome. These cases are indistinguishable without a
    // real lease/heartbeat mechanism (out of scope), and in every one of
    // them blindly proceeding — or worse, blindly doing nothing forever —
    // is wrong. `accepted` was previously treated as a safe silent no-op on
    // the reasoning that no transport action had happened yet; that left a
    // job whose claiming worker crashed before reaching `dispatching`
    // permanently stuck (unreachable by re-processing, and — before this
    // fix — also blocked from manual reprint, since `accepted` was in
    // NON_REPRINTABLE_STATUSES). Both `accepted` and `dispatching` now
    // resolve the same way: mark `uncertain` and stop. Reprinting an
    // `accepted` job carries no duplicate-transmission risk (no transport
    // attempt has begun), so surfacing it promptly is strictly safer than
    // leaving it silently invisible. Guarded so a genuinely-still-running
    // original attempt that finishes in the interim is not clobbered.
    if (dbJob.status === PrintJobStatus.accepted || dbJob.status === PrintJobStatus.dispatching) {
      await this.prisma.printerJob.updateMany({
        where: { id: printerJobId, status: dbJob.status },
        data: {
          status: PrintJobStatus.uncertain,
          errorMessage:
            'Dispatch outcome unknown after an interrupted attempt. Resolve via manual reprint.',
        },
      });
      return;
    }

    // Only `queued` remains. Durably claim it — this is a compare-and-swap
    // against the database, not an in-memory check, so it is safe even if
    // this exact job is being processed by two workers at once (BullMQ can,
    // in rare stall/lock-expiry cases, redeliver a job). The loser sees
    // count === 0 and backs off without touching anything.
    const claim = await this.prisma.printerJob.updateMany({
      where: { id: printerJobId, status: PrintJobStatus.queued },
      data: {
        status: PrintJobStatus.accepted,
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    if (claim.count === 0) return;

    const freshJob = await this.prisma.printerJob.findUniqueOrThrow({
      where: { id: printerJobId },
    });
    const printer = dbJob.printer;

    // Connection types with no real dispatch mechanism today: never
    // fabricate success. The ticket needs a human.
    if (
      printer.connectionType === PrinterConnectionType.usb ||
      printer.connectionType === PrinterConnectionType.windows_shared
    ) {
      await this.resolveFrom(printerJobId, PrintJobStatus.accepted, {
        status: PrintJobStatus.manual,
        errorMessage: `No automated dispatch exists yet for connection type "${printer.connectionType}"; ticket requires manual handling.`,
      });
      return;
    }

    if (printer.connectionType === PrinterConnectionType.simulated) {
      if (this.isProduction()) {
        // Explicit, visibly-configured dev/test simulation selected in
        // production: fail closed immediately. Never simulate success here.
        await this.resolveFrom(printerJobId, PrintJobStatus.accepted, {
          status: PrintJobStatus.failed,
          failedAt: new Date(),
          errorMessage: 'Simulated printer connections are not permitted in production.',
        });
        return;
      }
      // Non-production only. Still goes through `dispatching` so the same
      // crash-window/duplicate-detection guards above apply to simulated
      // jobs too, and still stops at `delivered` — never `printed` — so a
      // developer never sees a status in dev that production could not
      // truthfully produce.
      await this.resolveFrom(printerJobId, PrintJobStatus.accepted, {
        status: PrintJobStatus.dispatching,
      });
      await this.resolveFrom(printerJobId, PrintJobStatus.dispatching, {
        status: PrintJobStatus.delivered,
        deliveredAt: new Date(),
        errorMessage: null,
      });
      return;
    }

    if (
      printer.connectionType === PrinterConnectionType.tcp ||
      printer.connectionType === PrinterConnectionType.network
    ) {
      await this.resolveFrom(printerJobId, PrintJobStatus.accepted, {
        status: PrintJobStatus.dispatching,
      });
      try {
        if (!printer.host) throw new Error('MISSING_HOST_CONFIG');
        await this.sendToTcpPrinter(printer.host, printer.port || 9100, dbJob.payload);
        await this.resolveFrom(printerJobId, PrintJobStatus.dispatching, {
          status: PrintJobStatus.delivered,
          deliveredAt: new Date(),
          errorMessage: null,
        });
      } catch (err: unknown) {
        const maxedOut = freshJob.attemptCount >= freshJob.maxAttempts;
        await this.resolveFrom(printerJobId, PrintJobStatus.dispatching, {
          status: maxedOut ? PrintJobStatus.failed : PrintJobStatus.queued,
          failedAt: maxedOut ? new Date() : null,
          errorMessage: classifyPrinterError(err),
        });
        // Preserves the original processor's contract: BullMQ retry
        // mechanics are driven by the thrown error, not by our own status
        // bookkeeping alone.
        throw err;
      }
      return;
    }

    // Any future/unrecognised connection type: fail closed, never fabricate.
    await this.resolveFrom(printerJobId, PrintJobStatus.accepted, {
      status: PrintJobStatus.failed,
      failedAt: new Date(),
      errorMessage: `Unsupported printer connection type: ${printer.connectionType as string}`,
    });
  }

  /**
   * Writes an outcome only if the row is still in `expectedStatus` — an
   * unguarded `update()` anywhere past the initial `queued→accepted` claim
   * was a real bug (found in independent review, in two places: writes
   * resolving out of `dispatching`, and — found in a follow-up review pass
   * after the first fix — writes resolving out of `accepted`, the same
   * class of bug one step earlier). A worker that is merely slow, not
   * actually crashed, can have a later unconditional write silently
   * overwrite an `uncertain` marker that a second, concurrent invocation
   * legitimately raised in the interim (via the `accepted`/`dispatching`
   * re-observation branch above) — erasing the only evidence that a
   * duplicate-delivery risk was ever detected. If the CAS finds the row is
   * no longer in `expectedStatus` (count === 0), some other observer has
   * already reclassified it — almost certainly `uncertain` — and that
   * classification must stand rather than be clobbered by a late write,
   * even one carrying a genuinely-successful outcome.
   */
  private async resolveFrom(
    printerJobId: string,
    expectedStatus: PrintJobStatus,
    data: Prisma.PrinterJobUpdateManyMutationInput,
  ): Promise<void> {
    await this.prisma.printerJob.updateMany({
      where: { id: printerJobId, status: expectedStatus },
      data,
    });
  }

  private sendToTcpPrinter(host: string, port: number, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(4000);

      client.connect(port, host, () => {
        client.write(payload, 'utf8', (err) => {
          client.end();
          if (err) {
            reject(err);
          } else {
            // The write callback firing means the OS accepted the bytes for
            // transmission — a transport-level fact only. It is not, and
            // must never be treated as, evidence the printer received or
            // rendered anything.
            resolve();
          }
        });
      });

      client.on('error', (err) => {
        client.destroy();
        reject(err);
      });

      client.on('timeout', () => {
        client.destroy();
        reject(new Error('Timeout connecting to printer'));
      });
    });
  }
}

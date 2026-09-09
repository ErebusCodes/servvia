/**
 * The durable side of "we are about to send".
 *
 * WHY THIS EXISTS AS ITS OWN NARROW CLASS. `WaiterPadTableRoundWriter` takes
 * persistence as a hook rather than a Prisma dependency, so that the writer's
 * own tests can drive crash timings that a real database makes awkward. This
 * class is the production implementation of that hook and nothing else: two
 * methods, no business rules, no decisions. Every rule about WHEN to persist
 * lives in the writer, which will not open a socket until `recordSendInitiated`
 * has resolved.
 *
 * THE ORDERING GUARANTEE THIS IS RESPONSIBLE FOR. `recordSendInitiated` must
 * not resolve until the row is committed and would survive `kill -9`. A Prisma
 * `create` on Postgres satisfies that: it is a synchronous round trip to the
 * server and the transaction is committed when the promise resolves. That is
 * the whole contract - if this ever grows a write-behind cache or an in-memory
 * queue, the safety argument in `waiterpad-table-round-writer.ts` breaks
 * silently.
 *
 * WHY A FAILURE HERE IS SAFE AND A FAILURE LATER IS NOT. If this throws, no
 * byte has left the host, so the round is provably unsent and may be prepared
 * again as a NEW attempt. That is the only failure on this path with that
 * property, which is exactly why it is placed before the socket rather than
 * after it.
 */

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';
import type { WaiterPadSendOutcome } from './waiterpad-transport';

/** Cap on stored receiver text. A response is diagnostic, never a payload. */
const MAX_RESPONSE_NOTE = 500;

@Injectable()
export class NativeSendAttemptStore {
  private readonly logger = new Logger(NativeSendAttemptStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Commit the attempt. Resolves only once the row is durable.
   *
   * `attemptId` is unique, so a duplicate call for the same attempt is a
   * conflict rather than a second row - which is the behaviour we want, since
   * two rows for one attempt would make the restart reasoning ambiguous in
   * precisely the situation it exists to disambiguate.
   */
  async recordSendInitiated(record: SendInitiatedRecord): Promise<void> {
    await this.prisma.nativeSendAttempt.create({
      data: {
        roundId: record.roundId,
        attemptId: record.attemptId,
        externalOrderId: record.externalOrderId,
        posTableCode: String(record.table),
        deviceId: record.deviceId,
        token: record.token,
        payloadHash: record.payloadHash,
        sendInitiatedAt: record.sendInitiatedAt,
      },
    });
  }

  /**
   * Record how the send ended.
   *
   * BEST EFFORT ON PURPOSE, and the asymmetry is deliberate: a failure to
   * persist the OUTCOME must never propagate, because by the time we are here
   * the bytes have already gone. Throwing would turn a recorded-but-unsettled
   * attempt into an exception the caller might read as "the send failed", and
   * "the send failed" is the one conclusion this protocol does not license.
   * The row already exists and already says a send was initiated; an
   * unsettled row is correctly read by reconciliation as UNCERTAIN, which is
   * the truthful state.
   */
  async recordOutcome(record: SendInitiatedRecord, outcome: WaiterPadSendOutcome): Promise<void> {
    try {
      await this.prisma.nativeSendAttempt.update({
        where: { attemptId: record.attemptId },
        data: {
          outcomeKind: outcome.kind,
          bytesLeftHost: outcome.bytesLeftHost,
          responseNote: noteFor(outcome),
          settledAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `could not record the outcome of attempt ${record.attemptId} (round ` +
          `${record.roundId}, table ${record.table}). The attempt row stands and ` +
          'reconciliation will treat it as unresolved, which is the safe reading: ' +
          (err instanceof Error ? err.message : 'unknown error'),
      );
    }
  }

  /**
   * Attach the licensed transition the writer derived. Kept separate from
   * `recordOutcome` because the decision is the caller's conclusion, not the
   * transport's observation, and conflating them in one column has already
   * been a source of confusion between "the till said NAK" and "we decided
   * this is uncertain".
   */
  async recordDecision(attemptId: string, decision: string): Promise<void> {
    try {
      await this.prisma.nativeSendAttempt.update({
        where: { attemptId },
        data: { decision },
      });
    } catch (err) {
      this.logger.error(
        `could not record the decision for attempt ${attemptId}: ` +
          (err instanceof Error ? err.message : 'unknown error'),
      );
    }
  }
}

/**
 * Sanitize what we keep from the receiver.
 *
 * Truncated and never the raw packet: the response can echo order content, and
 * an attempt row is read during incident review by people who do not need the
 * customer's order to answer "did this land".
 */
function noteFor(outcome: WaiterPadSendOutcome): string {
  const text =
    outcome.kind === 'responded'
      ? `${outcome.response.type}`
      : outcome.kind === 'unparseableResponse'
        ? `unparseable: ${outcome.detail}`
        : outcome.detail;
  return text.slice(0, MAX_RESPONSE_NOTE);
}

/**
 * SETTLING ROUNDS THAT THE WIRE COULD NOT SETTLE.
 *
 * A send on this protocol can end without an answer. The receiver ACKs before
 * durable processing, byte-identically to the ACK for a no-op and even when its
 * buffer was full and the packet was dropped; a NAK can follow an order it has
 * already printed. So `awaiting_native_confirmation` is the strongest state a
 * send can reach, and something else has to decide what actually happened.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE THING THIS SERVICE MUST NEVER DO.
 *
 * Reconciliation polls. It does not resend. Those are different operations and
 * the difference is the whole integration: a round that may already be on the
 * tab must be LOOKED AT, never sent again, because a second copy is a second
 * Lamb Shank on a real customer's real bill and nobody notices until the docket
 * prints.
 *
 * That is not enforced by a rule this file remembers. It is enforced by
 * construction: this service has NO writer. `ITableRoundWriter` is not a
 * constructor parameter, is not imported, and there is no transport anywhere in
 * its dependency graph. It cannot send a packet because it holds nothing that
 * could. A future edit that wanted to resend from here would have to add a
 * dependency, which is a visible change to a signature rather than a line
 * buried in a branch.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ-ONLY, AND THE EVIDENCE PORT IS UNBOUND BY DEFAULT.
 *
 * The confirming evidence lives on the till: the receiver stores OUR token
 * verbatim against OUR DeviceID (`AAAExampleData`, `ColumnType='IH-<DeviceID>'`),
 * which is the only artefact found anywhere on this protocol that ties a
 * durable row on the till to a specific Verdura submission. Reading it requires
 * a connector capability that no connector build advertises today.
 *
 * So `NATIVE_ROUND_EVIDENCE_READER` is an optional injection token, and leaving
 * it unbound - which is the state of every build today, including production -
 * is a supported configuration: the sweep reports `readerBound: false`, gathers
 * no evidence, and confirms nothing. It still does the half of its job that
 * needs no till access at all, which is the ESCALATION below.
 *
 * When a reader is bound it must be READ-ONLY. Nothing in this module writes to
 * the IdealPOS database, and the port's contract says so in its own type: it
 * returns evidence and has no other method.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESCALATION IS THE PART THAT WORKS TODAY.
 *
 * A round sitting in `awaiting_native_confirmation` is telling staff "sent,
 * waiting for the till". If nothing ever confirms it, that message is a lie by
 * omission - it will sit there all night looking like progress. After a bounded
 * wait it becomes `unresolved`, which is the state that says a human must look
 * at the till. That is a downgrade, deliberately: an unproven round should get
 * MORE alarming with age, not less.
 *
 * Escalation never touches a round's lines and never opens anything. It changes
 * what staff are told, and nothing else.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NativeRoundState } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { reconcileAmbiguousSend, type ReconciliationEvidence } from './waiterpad-reconciliation';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

/**
 * The read-only port onto the till's own evidence.
 *
 * ONE METHOD, AND IT RETURNS. There is deliberately no way to express a write
 * through this interface - not a flag, not an optional second method. An
 * implementation that wanted to change something on the till would have no
 * shape here to do it through.
 */
export interface NativeRoundEvidenceReader {
  /**
   * Gather what can be observed about one attempt, WITHOUT changing anything.
   *
   * Every field of the result is optional and `undefined` means "did not
   * look" - which the predicate treats as ignorance rather than as absence.
   * Conflating the two is how a round gets marked not-applied because a log
   * file was unreadable.
   */
  readEvidence(record: SendInitiatedRecord): Promise<ReconciliationEvidence>;
}

export const NATIVE_ROUND_EVIDENCE_READER = Symbol('NATIVE_ROUND_EVIDENCE_READER');

export interface ReconciliationSweepResult {
  /** False when no evidence reader is bound - the default, and production today. */
  readonly readerBound: boolean;
  /** Rounds considered this tick. */
  readonly examined: number;
  /** Advanced to `confirmed` on strong, causal evidence. */
  readonly confirmed: number;
  /** Proven NOT to have landed; their lines were released for a genuinely new round. */
  readonly notApplied: number;
  /** Downgraded from "awaiting" to "a human must look" because the wait ran out. */
  readonly escalated: number;
  /** Still waiting, still within their window. */
  readonly stillPending: number;
  /** Errors that did not stop the sweep. */
  readonly errored: number;
}

/** The two states a round can be reconciled FROM. Nothing else is this sweep's business. */
const RECONCILABLE: NativeRoundState[] = [
  // Sent, ACKed, unproven. The ordinary case.
  NativeRoundState.awaiting_native_confirmation,
  // Sent, and the answer was ambiguous or absent. Already a human's problem,
  // but strong evidence can still settle it without one.
  NativeRoundState.unresolved,
];

@Injectable()
export class NativeRoundReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NativeRoundReconciliationService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly enabled: boolean;
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly escalateAfterMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    // Optional BY DESIGN. See the file header: no connector build can read the
    // till's token row yet, and a service that refused to start without one
    // would take the escalation half of this job down with it.
    @Optional()
    @Inject(NATIVE_ROUND_EVIDENCE_READER)
    private readonly reader: NativeRoundEvidenceReader | null = null,
  ) {
    this.enabled = config.get<string>('IDEALPOS_NATIVE_RECONCILE_ENABLED') === 'true';
    this.sweepIntervalMs = Number(
      config.get<string>('IDEALPOS_NATIVE_RECONCILE_INTERVAL_MS') ?? 30_000,
    );
    this.batchSize = Number(config.get<string>('IDEALPOS_NATIVE_RECONCILE_BATCH_SIZE') ?? 50);
    // How long a round may claim to be "awaiting the till" before staff are
    // told plainly that nobody knows. Deliberately minutes, not hours: this is
    // a message on a screen during a service, and a stale reassuring message is
    // worse than an alarming true one.
    this.escalateAfterMs = Number(
      config.get<string>('IDEALPOS_NATIVE_RECONCILE_ESCALATE_AFTER_MS') ?? 5 * 60_000,
    );
  }

  onModuleInit(): void {
    // Same rule the other sweeps in this module follow: the unattended timer
    // never runs under the test suite, where it could mutate another test
    // file's fixture rows in the shared local database. Tests call sweep()
    // directly, which is the whole of the behaviour anyway.
    if (process.env.NODE_ENV === 'test') return;
    if (!this.enabled) {
      this.logger.log(
        'Native round reconciliation timer is off (IDEALPOS_NATIVE_RECONCILE_ENABLED is not "true").',
      );
      return;
    }
    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) => {
        this.logger.error(
          `Reconciliation tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One bounded tick.
   *
   * EVERY ROUND IT LOOKS AT COMES FROM THE DATABASE, which is what makes a
   * restart resume reconciliation rather than lose it. Nothing about which
   * rounds are outstanding lives in this process; a new instance over the same
   * rows picks up exactly where the last one stopped, and it picks up
   * RECONCILING - there is no submission state to resume because this service
   * has never held any.
   */
  async sweep(now: Date = new Date()): Promise<ReconciliationSweepResult> {
    const rounds = await this.prisma.nativeTableRound.findMany({
      where: { state: { in: RECONCILABLE } },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      include: {
        // Newest attempt first: the receiver's token row is ONE DEEP, so it can
        // only speak about the most recent attempt for a device. For the
        // ambiguous-send case that is precisely the attempt in question.
        attempts: { orderBy: { sendInitiatedAt: 'desc' }, take: 1 },
        items: { select: { id: true } },
      },
    });

    const result = {
      readerBound: this.reader !== null,
      examined: rounds.length,
      confirmed: 0,
      notApplied: 0,
      escalated: 0,
      stillPending: 0,
      errored: 0,
    };

    for (const round of rounds) {
      try {
        const attempt = round.attempts[0];
        if (!attempt) {
          // A round in a reconcilable state with no attempt row should not
          // exist - the attempt is written BEFORE the socket. Left alone
          // rather than guessed at, and counted so it is visible.
          this.logger.warn(
            `Round ${round.id} is ${round.state} but has no send attempt recorded; leaving it alone.`,
          );
          result.stillPending += 1;
          continue;
        }

        const record: SendInitiatedRecord = {
          roundId: round.id,
          attemptId: attempt.attemptId,
          externalOrderId: attempt.externalOrderId,
          table: Number(attempt.posTableCode),
          deviceId: attempt.deviceId,
          token: attempt.token,
          payloadHash: attempt.payloadHash,
          sendInitiatedAt: attempt.sendInitiatedAt,
        };

        // No reader bound means no evidence - NOT absent evidence. Every field
        // stays `undefined`, which the predicate reads as ignorance and answers
        // `manualResolutionRequired` to. It must never be read as "the till
        // holds nothing", which would be a `notApplied` verdict drawn from
        // never having looked.
        const evidence: ReconciliationEvidence = this.reader
          ? await this.reader.readEvidence(record)
          : {};

        const verdict = reconcileAmbiguousSend(record, {
          ...evidence,
          expectedLineCount: evidence.expectedLineCount ?? round.items.length,
        });

        if (verdict.kind === 'confirmed') {
          await this.markConfirmed(round.id, attempt.token, now, verdict.basis);
          result.confirmed += 1;
          continue;
        }

        if (verdict.kind === 'notApplied') {
          await this.markNotApplied(round.id, now, verdict.basis);
          result.notApplied += 1;
          continue;
        }

        // manualResolutionRequired. The only remaining question is whether
        // staff are still being told something reassuring about it.
        if (
          round.state === NativeRoundState.awaiting_native_confirmation &&
          now.getTime() - attempt.sendInitiatedAt.getTime() >= this.escalateAfterMs
        ) {
          await this.escalate(round.id, verdict.basis);
          result.escalated += 1;
          continue;
        }

        result.stillPending += 1;
      } catch (err) {
        result.errored += 1;
        this.logger.error(
          `Reconciling round ${round.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }

  /**
   * The till is holding OUR token against OUR device. Nothing else reaches this.
   *
   * `nativeSaleTier` is written as `causal` because that is what the evidence
   * is: the token could only have got there from our packet. The domain model
   * refuses to confirm a round on anything weaker - a table-code or content
   * match is corroboration, and corroboration cannot tell "we caused this" from
   * "a waiter keyed the same items while we were deciding".
   */
  private async markConfirmed(
    roundId: string,
    token: string,
    now: Date,
    basis: string,
  ): Promise<void> {
    await this.prisma.nativeTableRound.update({
      where: { id: roundId },
      data: {
        state: NativeRoundState.confirmed,
        nativeSaleId: token,
        nativeSaleTier: 'causal',
        nativeObservedAt: now,
      },
    });
    this.logger.log(`Round ${roundId} CONFIRMED on the till: ${basis}`);
  }

  /**
   * Positive evidence that the round did NOT land.
   *
   * The lines are released so the next Send carries them - which is the point:
   * a round proven not to have landed is food a customer ordered and did not
   * get, and leaving its lines claimed by a dead round would strand them.
   *
   * This is the only automatic line release in the reconciler and it is
   * licensed by the predicate's own conservatism: `notApplied` needs the till
   * to be holding a DIFFERENT token AND nothing processed for the table, or no
   * token row at all AND nothing processed. Ambiguity never reaches here.
   */
  private async markNotApplied(roundId: string, now: Date, basis: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { nativeRoundId: roundId },
        data: { nativeRoundId: null },
      });
      await tx.nativeTableRound.update({
        where: { id: roundId },
        data: { state: NativeRoundState.failed, nativeObservedAt: now },
      });
    });
    this.logger.warn(
      `Round ${roundId} did NOT reach the till: ${basis}. Its lines are back on the order ` +
        'and will go with the next round.',
    );
  }

  /**
   * Stop telling staff a round is merely "awaiting the till" once it plainly is
   * not going to be answered.
   *
   * State only. No lines move, no round opens, nothing is sent. `unresolved` is
   * the state that puts the round in front of a human, which after this long is
   * the truthful thing to do.
   */
  private async escalate(roundId: string, basis: string): Promise<void> {
    await this.prisma.nativeTableRound.update({
      where: { id: roundId },
      data: { state: NativeRoundState.unresolved },
    });
    this.logger.warn(
      `Round ${roundId} has been awaiting confirmation past its window and is now UNRESOLVED - ` +
        `a human must check the table on the till. ${basis}`,
    );
  }
}

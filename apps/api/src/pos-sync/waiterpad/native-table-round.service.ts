/**
 * The Order Tablet's Send to Kitchen, as the application actually performs it.
 *
 * THIS IS THE HOP THAT WAS MISSING. Every piece below it was built and tested
 * in isolation - the codec, the token, the transport, the writer - and nothing
 * in the running application called any of it. A staff member pressing Send to
 * Kitchen reached the Webit path instead. This service is what makes the
 * button mean "a native Order2 round for the exact table the waiter selected".
 *
 * THE DELTA RULE, WHICH IS THE WHOLE PRODUCT PROMISE.
 *
 * A native handheld sends DELTAS. The second Send to Kitchen on Table 5 puts
 * only the new items on the tab; it does not re-send the first round. So a
 * round here is defined by the lines that have NOT yet been assigned to one:
 *
 *     openRound() claims every OrderItem with nativeRoundId = NULL
 *
 * The claim happens in the same transaction that creates the round, so a line
 * belongs to exactly one round forever after. A confirmed round's lines carry
 * its id and can never be swept into a later one - which makes replay
 * structurally impossible rather than a thing the code remembers not to do.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL BEATS ITS ALTERNATIVE.
 *
 *   no native table mapping   -> refuse. Sending to a guessed table puts a
 *                                customer's food on a stranger's bill.
 *   no native PLU for an item -> refuse. The alternative is inventing a code,
 *                                and an invented code is a wrong product at a
 *                                wrong price on a real bill.
 *   nothing new to send       -> refuse. A zero-line round consumes an
 *                                idempotency key to ask the kitchen for
 *                                nothing.
 *   a round already in flight -> refuse. One in-flight round per table
 *                                session; an ambiguous one is a human's to
 *                                resolve before another is opened.
 *
 * WHAT IT NEVER DOES: retry, fall back to Webit, or report success on an ACK.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { NativeRoundState, PosSubmissionStrategy, type Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { resolveNativeProductCode } from '../resolve-native-product-code';
import { newAttemptId } from './waiterpad-token';
import { TABLE_ROUND_WRITER } from './waiterpad-writer.provider';
import {
  type ITableRoundWriter,
  type TableRoundLine,
  type WaiterPadWriteResult,
} from './waiterpad-table-round-writer';
import type { ManualResolutionOutcome, OrderRound } from '../../orders/rounds/order-round.model';

export type NativeRoundFailureReason =
  | 'unmapped_table'
  | 'unmapped_item'
  | 'nothing_to_send'
  | 'round_in_flight'
  | 'order_not_found'
  | 'not_dine_in'
  | 'not_native_owned'
  /** A round was asked to be resolved by hand and it is not `unresolved`. */
  | 'not_resolvable'
  /** Somebody else resolved it between this request reading it and writing. */
  | 'already_resolved';

export class NativeRoundError extends Error {
  constructor(
    readonly reason: NativeRoundFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'NativeRoundError';
  }
}

/**
 * What staff are told, and the rule that generates it.
 *
 * `confirmed` is NOT reachable from a wire response alone, and is deliberately
 * absent from this union. The strongest thing the transport can return is an
 * ACK, and an ACK on this protocol is emitted before durable processing, is
 * byte-identical to the ACK for a no-op Test, and is returned even when the
 * receiver's buffer was full and the packet was dropped. So an accepted send
 * produces `sentAwaitingConfirmation`, and only reconciliation against the
 * till's own token row may advance a round past it.
 */
export type SendToKitchenResult =
  | {
      readonly status: 'sentAwaitingConfirmation';
      readonly roundId: string;
      readonly message: string;
    }
  | { readonly status: 'registrationRejected'; readonly roundId: string; readonly message: string }
  | { readonly status: 'rejected'; readonly roundId: string; readonly message: string }
  | { readonly status: 'uncertain'; readonly roundId: string; readonly message: string }
  | { readonly status: 'failedBeforeSend'; readonly roundId: string; readonly message: string };

/**
 * A line the waiter has entered but that does not exist in the database yet.
 *
 * Already priced and validated by the caller against the venue's menu - this
 * service does not resolve prices, and must not, because the one authority on
 * what a line costs is the same code that priced the order it belongs to.
 */
/**
 * WHERE A ROUND STANDS RIGHT NOW, for a screen that is looking rather than sending.
 *
 * A separate vocabulary from `SendToKitchenResult` on purpose. That type answers
 * "you pressed Send and here is what became of it" - a sentence about one
 * request, which is why it has no `confirmed` member at all: no send may ever
 * report `confirmed`, because the receiver ACKs before durable processing. This
 * one answers "here is where that round stands now", asked minutes later by a
 * screen that sent nothing, and by then `confirmed` is a real answer because
 * reconciliation may have reached it.
 *
 * Collapsing the two would mean one of them lying. Reusing the send vocabulary
 * here would report a confirmed round as `sentAwaitingConfirmation` forever;
 * adding `confirmed` to the send vocabulary would put a value in the send path's
 * type that the send path must never produce.
 */
export type RoundReadStatus =
  /** On the table in IdealPOS, proven by the till holding our own token. */
  | 'confirmed'
  /**
   * On the table according to a PERSON who checked, not according to the till.
   *
   * Kept apart from `confirmed` for the same reason the durable states are:
   * one is evidence and the other is testimony, and a screen that renders them
   * identically has thrown away the difference on the operator's behalf.
   */
  | 'resolvedManually'
  /** Sent and ACKed, not yet proven. The ordinary state for the first minutes. */
  | 'awaitingConfirmation'
  /** Nobody knows, and a human must look at the till. */
  | 'unresolved'
  /** The till refused it and created nothing. */
  | 'rejected'
  /** Provably never sent; the lines are back on the order. */
  | 'notSent'
  /** Being assembled or mid-send this instant. */
  | 'assembling';

/** One round of an order, as read back. Every field is something the UI renders. */
export interface RoundStatusView {
  readonly roundId: string;
  readonly sequence: number;
  /**
   * The durable enum, unmapped and uninterpreted.
   *
   * Carried alongside the derived fields so that a state added to the enum
   * later is still VISIBLE to a client built today, rather than being silently
   * folded into whichever derived value happened to be the closest fit.
   */
  readonly state: NativeRoundState;
  readonly status: RoundReadStatus;
  readonly message: string;
  /** True when only a human looking at the till can settle this round. */
  readonly requiresReconciliation: boolean;
  /** True when this round can no longer change on its own. */
  readonly settled: boolean;
  /**
   * When the bytes went out, from the most recent attempt - the clock that
   * escalation runs against, so a screen can say how long this has been unproven
   * instead of only that it is. Null when nothing was ever sent.
   */
  readonly sendInitiatedAt: Date | null;
  readonly lineCount: number;
  /**
   * EXACTLY WHAT A MANAGER IS BEING ASKED TO VOUCH FOR.
   *
   * Present only on a round that needs a human, because that is the only
   * screen it belongs on: this is the list somebody stands at a till holding,
   * comparing line by line against a customer's bill before putting their name
   * to it.
   *
   * It exists because the first version of the attestation dialog asked "what
   * do you see on this table in IdealPOS?" over a blank text box, and offered
   * no way to know what SHOULD be there. Being asked to confirm a round you
   * have not been shown is not a check - it is a formality with a signature on
   * it, and a formality is exactly what a tired manager will produce at 9pm.
   */
  readonly attestation: RoundAttestationEvidence | null;
}

/** The facts a human needs in front of them to settle a round honestly. */
export interface RoundAttestationEvidence {
  /** The IdealPOS table, not the Verdura display number - that is the one they read on the till. */
  readonly posTableCode: string;
  readonly guests: number;
  readonly lines: readonly {
    readonly description: string;
    readonly quantity: number;
    /** The native code, where the item has one. Useful when two items read alike on a bill. */
    readonly plu: string | null;
    readonly seat: number | null;
  }[];
  /** Our own id for the order, as the till would know it. */
  readonly externalOrderId: string;
  /**
   * WHEN IT WENT, as a wall clock for the manager to match against the till's
   * own order list. Carried inside the docket rather than beside it because it
   * is one of the facts being attested to, and because a panel that had to be
   * assembled from two places is a panel that can be rendered half-empty.
   */
  readonly sentAt: Date | null;
  /**
   * A SHORT PREFIX OF THE DUPLICATE TOKEN, never the whole thing.
   *
   * Enough to match a row during an incident review; not enough to reconstruct
   * a token and present it to a till. It is on this screen because staff
   * occasionally need to read it to somebody on the phone, not because the
   * attestation depends on it.
   */
  readonly tokenPrefix: string | null;
}

/** What a human's resolution did. Every field is something the tablet renders. */
export interface ManualResolutionResult {
  readonly roundId: string;
  readonly sequence: number;
  readonly outcome: ManualResolutionOutcome;
  /** The durable state written, unmapped - see `RoundStatusView.state`. */
  readonly state: NativeRoundState;
  /**
   * Whether this round's lines went back on the order.
   *
   * ALWAYS FALSE. No manual path releases a line - see `attestRoundPresent`
   * for why the outcome that used to is gone. It is still returned as an
   * explicit field rather than left to be inferred, for two reasons: a client
   * that has to derive "will these items be sent again?" from a vocabulary word
   * will one day derive it wrong, and a future change that made it true would
   * have to say so here, in front of a reviewer.
   */
  readonly linesReleased: false;
  /** True only for `present`. A `notFound` round is still unresolved. */
  readonly settled: boolean;
  readonly resolvedAt: Date;
  readonly message: string;
}

export interface NewRoundLine {
  readonly menuItemId: string;
  readonly menuItemTitle: string;
  readonly menuItemCategory: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly lineTotalCents: number;
  readonly selectedModifiers: unknown;
  readonly notes: string | null;
  readonly seat: number | null;
}

export type SubmitRoundResult = SendToKitchenResult & {
  readonly sequence: number;
  /**
   * True when this request did NOT send anything because a request carrying
   * the same key already had. The status describes the EXISTING round.
   *
   * A caller must not read `replayed: true` as reassurance. If that round is
   * uncertain it is still uncertain; a second tap is not evidence about the
   * first tap's outcome.
   */
  readonly replayed: boolean;
};

/** States in which a round still occupies the session's single in-flight slot. */
const IN_FLIGHT: NativeRoundState[] = [
  NativeRoundState.submitting,
  NativeRoundState.awaiting_native_confirmation,
  NativeRoundState.unresolved,
];

@Injectable()
export class NativeTableRoundService {
  private readonly logger = new Logger(NativeTableRoundService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TABLE_ROUND_WRITER) private readonly writer: ITableRoundWriter,
  ) {}

  /**
   * Open the next delta round for an order and send it.
   *
   * Open-then-send rather than one atomic act, because the two have opposite
   * failure semantics: opening is a local database decision that is always
   * safe to undo, and sending is not undoable at all. Keeping them separate is
   * what stops a failure to open from leaving a half-sent round.
   */
  async sendToKitchen(orderId: string): Promise<SendToKitchenResult> {
    const round = await this.openRound(orderId);
    return await this.sendRound(round.id);
  }

  /**
   * WHAT THE SEND TO KITCHEN BUTTON ACTUALLY CALLS.
   *
   * `sendToKitchen` above sends whatever is already unclaimed on an order.
   * This is the shape the tablet needs: the waiter has entered NEW lines since
   * the last round, and those lines do not exist in the database yet. Round 1
   * carries the lines the order was created with and passes none here; round 2
   * carries the mains the waiter has just typed.
   *
   * THE APPEND AND THE CLAIM ARE ONE TRANSACTION. If they were two, a crash
   * between them would leave the new lines unclaimed - recoverable, but it
   * would also let a concurrent second press claim them into a DIFFERENT round
   * from the one this request is going to send. Doing both under one commit
   * means the lines this request created are the lines this request sends, or
   * neither happened.
   *
   * THE DOUBLE TAP. `requestKey` is the client's own key for one press of the
   * button, and `NativeTableRound.requestKey` is unique. Two taps carrying the
   * same key cannot both open a round: the loser fails on the constraint, and
   * is answered with the winner's round rather than an error. That is the
   * difference between "your second tap did nothing" and "your second tap put
   * another Lamb Shank in the kitchen".
   *
   * IT RETURNS `replayed` FOR THAT CASE, and the caller must NOT treat it as a
   * fresh send. In particular a replayed round that is `unresolved` is still
   * unresolved - a second tap is not evidence about the first one's outcome.
   */
  async submitRound(params: {
    readonly orderId: string;
    /** One press of Send to Kitchen. Two requests carrying this key are one press. */
    readonly requestKey: string;
    /** Lines entered since the last round. Empty for the first round of an order. */
    readonly newLines: readonly NewRoundLine[];
  }): Promise<SubmitRoundResult> {
    const { orderId, requestKey, newLines } = params;

    // A round already opened under this key means this request is a repeat of
    // one that has been handled. Report what became of it; do not send again.
    const alreadyDone = await this.prisma.nativeTableRound.findUnique({
      where: { requestKey },
      select: { id: true, sequence: true, state: true },
    });
    if (alreadyDone) return this.replayOf(alreadyDone);

    let opened: { id: string; sequence: number };
    try {
      opened = await this.openRound(orderId, { requestKey, newLines });
    } catch (err) {
      // The other tap won the constraint between our read above and our write.
      // Its round is the real one; answer with that rather than with an error
      // the waiter would read as "it did not go".
      if (isUniqueViolation(err, 'requestKey')) {
        const winner = await this.prisma.nativeTableRound.findUnique({
          where: { requestKey },
          select: { id: true, sequence: true, state: true },
        });
        if (winner) return this.replayOf(winner);
      }
      throw err;
    }

    const sent = await this.sendRound(opened.id);
    return { ...sent, sequence: opened.sequence, replayed: false };
  }

  private replayOf(round: {
    id: string;
    sequence: number;
    state: NativeRoundState;
  }): SubmitRoundResult {
    return {
      ...describeExistingRound(round.id, round.state),
      sequence: round.sequence,
      replayed: true,
    };
  }

  /**
   * Claim the unsent lines of an order into a new round.
   *
   * ONE TRANSACTION, and the claim is the point of it. Creating the round and
   * stamping its lines must be atomic, or a crash between them leaves lines
   * belonging to a round that does not describe them - and the next round
   * would then either double-send them or skip them.
   */
  async openRound(
    orderId: string,
    options: {
      readonly requestKey?: string;
      readonly newLines?: readonly NewRoundLine[];
    } = {},
  ): Promise<{ id: string; sequence: number }> {
    return await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          table: true,
          nativeRounds: { select: { sequence: true, state: true } },
          // The durable ownership record. Read inside this transaction, with
          // the round creation it guards, rather than in a separate earlier
          // query - see the check below.
          posSyncRecord: { select: { strategy: true, status: true } },
        },
      });
      if (!order) {
        throw new NativeRoundError('order_not_found', `order ${orderId} does not exist`);
      }

      // ── ROUTE EXCLUSIVITY, ENFORCED IN THE OTHER DIRECTION. ──
      //
      // The dispatchers refuse native-owned orders. This is the mirror: the
      // native path refuses an order the Webit pipeline owns. Without it the
      // exclusion would be one-sided - a caller could hand this service any
      // order id and put an Order2 packet on a table for an order that a
      // ConnectorCommand is already carrying to the Bridge.
      //
      // An order with NO POSSyncRecord is allowed through. That is a venue
      // with `posAdapterType: 'none'`, which has no Webit pipeline at all, so
      // there is no second claimant to exclude. Refusing it would break the
      // only configuration in which a native round is unambiguously the sole
      // path an order can take.
      const owner = order.posSyncRecord?.strategy ?? null;
      if (owner !== null && owner !== PosSubmissionStrategy.native_table_round) {
        throw new NativeRoundError(
          'not_native_owned',
          `order ${orderId} is owned by the '${owner}' POS strategy, not the native ` +
            'handheld workflow. Refusing to open a round: that order is already on its ' +
            'way to IdealPOS by another transport, and sending it again would put a ' +
            "second copy of it on the customer's bill.",
        );
      }
      if (order.serviceMode !== 'dine_in') {
        throw new NativeRoundError(
          'not_dine_in',
          'the native handheld protocol addresses a table; a takeaway order has none, ' +
            'and no table may be fabricated to give it one',
        );
      }

      // Native table identity comes from the mapping, never from the Verdura
      // table's own display number. "Table 5" in Verdura is native Table 5
      // only because Table.posTableCode says so.
      const posTableCode = order.table?.posTableCode ?? null;
      if (!posTableCode) {
        throw new NativeRoundError(
          'unmapped_table',
          `table ${order.tableNumber ?? '(none)'} has no configured IdealPOS table code ` +
            '(Table.posTableCode). Refusing to send: a guessed table number puts this ' +
            "round on some other customer's bill.",
        );
      }

      const inFlight = order.nativeRounds.find((r) => IN_FLIGHT.includes(r.state));
      if (inFlight) {
        throw new NativeRoundError(
          'round_in_flight',
          `round ${inFlight.sequence} on this table is still ${inFlight.state}. A second ` +
            'round may not be opened until that one is resolved - an unresolved round ' +
            'may already be in the kitchen.',
        );
      }

      // ── The lines the waiter has just entered, written here and nowhere
      //    else. ──
      //
      // AFTER the in-flight check on purpose. If a previous round on this
      // table is unresolved, this request is refused, and these lines must
      // NOT have been written: an order that silently grew by three lines
      // during a refusal is an order whose next round carries food the waiter
      // does not remember ordering.
      for (const line of options.newLines ?? []) {
        await tx.orderItem.create({
          data: {
            orderId,
            menuItemId: line.menuItemId,
            menuItemTitle: line.menuItemTitle,
            menuItemCategory: line.menuItemCategory,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            selectedModifiers: line.selectedModifiers as Prisma.InputJsonValue,
            notes: line.notes,
            seat: line.seat,
            // Explicit, though it is also the column default. This line is
            // unclaimed for exactly as long as it takes the claim below to
            // run, inside this same transaction.
            nativeRoundId: null,
          },
        });
      }

      // The delta: only lines no round has carried yet. The lines just
      // appended are among them, and so is anything a previous refused
      // attempt left behind.
      const unsent = await tx.orderItem.findMany({
        where: { orderId, nativeRoundId: null },
        select: { id: true },
      });
      if (unsent.length === 0) {
        throw new NativeRoundError(
          'nothing_to_send',
          'every line on this order has already been assigned to a round. There is ' +
            'nothing new to send, and re-sending a previous round would duplicate it ' +
            'on the native tab.',
        );
      }

      const sequence = order.nativeRounds.reduce((max, r) => Math.max(max, r.sequence), 0) + 1;
      const created = await tx.nativeTableRound.create({
        data: {
          orderId,
          venueId: order.venueId,
          sequence,
          // Durable before any send, derived from ids that survive a restart -
          // never minted in browser state at submit time.
          idempotencyKey: `${orderId}:r${sequence}`,
          // The client's key for this press of Send. Unique, so a second tap
          // carrying the same key cannot open a second round - see
          // submitRound, which turns that constraint failure into an answer
          // rather than an error.
          requestKey: options.requestKey ?? null,
          state: NativeRoundState.drafting,
          posTableCode,
          guests: order.guests ?? 0,
        },
        select: { id: true, sequence: true },
      });

      await tx.orderItem.updateMany({
        where: { orderId, nativeRoundId: null },
        data: { nativeRoundId: created.id },
      });

      return created;
    });
  }

  /**
   * Freeze a drafting round and hand it to the writer, exactly once.
   */
  async sendRound(roundId: string): Promise<SendToKitchenResult> {
    const round = await this.prisma.nativeTableRound.findUnique({
      where: { id: roundId },
      include: { items: true },
    });
    if (!round) throw new NativeRoundError('order_not_found', `round ${roundId} does not exist`);
    if (round.state !== NativeRoundState.drafting) {
      throw new NativeRoundError(
        'round_in_flight',
        `round ${round.sequence} is ${round.state}, not drafting - refusing to send it again`,
      );
    }

    // ── RESOLVE BEFORE FREEZING, AND RELEASE THE LINES IF IT REFUSES. ──
    //
    // An unmapped PLU is a deterministic refusal reached before the round is
    // frozen, before an attempt row exists and before any socket: nothing can
    // have been sent, and that is what licenses the release below.
    //
    // AN EARLIER VERSION LET THE THROW ESCAPE, and the comment here claimed it
    // left the round "exactly as it was, editable and re-sendable". It was
    // neither. The round stayed `drafting` holding its lines, `drafting` is not
    // an IN_FLIGHT state, and so the NEXT press opened a fresh round whose
    // "lines no round has carried yet" query found only the newly-typed ones.
    // The stranded lines were never sent and never mentioned again: an order
    // for lamb, tiramisu and a Coke reached the kitchen as a Coke, and the
    // tablet said `sentAwaitingConfirmation`. The refusal even advertised
    // `safeToRetry: true`, and every retry answered `nothing_to_send` - an
    // invitation to keep pressing a button that could never work.
    //
    // This is the identical trap `settleWithoutSendAndRelease` was written to
    // close for the writer's own refusals. It is the same precondition and it
    // gets the same treatment.
    let lines: TableRoundLine[];
    try {
      lines = await this.resolveLines(round.items);
    } catch (err) {
      await this.settleWithoutSendAndRelease(roundId, NativeRoundState.abandoned);
      this.logger.warn(
        `round ${roundId} refused before any send boundary: ` +
          `${err instanceof Error ? err.message : 'line resolution failed'}. Its lines are back ` +
          'on the order and the next send will carry them.',
      );
      // Rethrown rather than converted: the caller turns it into the refusal
      // that names WHICH item has no till code, which is the one thing that
      // makes it fixable. The lines are already released, so the retry that
      // refusal invites can genuinely carry them now.
      throw err;
    }

    const frozenAt = new Date();
    await this.prisma.nativeTableRound.update({
      where: { id: roundId },
      data: { state: NativeRoundState.submitting, payloadFrozenAt: frozenAt },
    });

    const domainRound: OrderRound = {
      roundId: round.id,
      sessionId: round.orderId,
      sequence: round.sequence,
      idempotencyKey: round.idempotencyKey,
      state: 'submitting',
      lines: round.items.map((i) => ({
        lineId: i.id,
        menuItemId: i.menuItemId,
        quantity: i.quantity,
        expectedUnitPriceCents: i.unitPriceCents,
      })),
      payloadFrozenAt: frozenAt,
      nativeSaleRef: null,
    };

    let result: WaiterPadWriteResult;
    try {
      result = await this.writer.writeRound({
        round: domainRound,
        attemptId: newAttemptId(),
        table: Number(round.posTableCode),
        guests: round.guests,
        lines,
      });
    } catch (err) {
      // The writer refused BEFORE opening a socket - disabled, misconfigured,
      // or a seat it will not send. Nothing left the host, so the round is
      // abandoned and its lines are RELEASED back to unclaimed.
      await this.settleWithoutSendAndRelease(roundId, NativeRoundState.abandoned);
      const message = err instanceof Error ? err.message : 'the native writer refused this round';
      this.logger.warn(`round ${roundId} refused before send: ${message}`);
      return { status: 'failedBeforeSend', roundId, message };
    }

    return await this.applyDecision(roundId, result);
  }

  /**
   * READ EVERY ROUND OF AN ORDER. Opens nothing, sends nothing, writes nothing.
   *
   * WHY THIS EXISTS. Until it did, a round's state after the POST answered was
   * unobservable from the tablet. The send returns
   * `sentAwaitingConfirmation` and the screen holds that sentence forever -
   * including after reconciliation has escalated the round to `unresolved`
   * because nothing ever confirmed it. The escalation was real and durable and
   * reached nobody: staff went on reading "waiting for the till" all night about
   * a round the server had already given up on. Escalation only changes what
   * staff are told if something tells them.
   *
   * IT IS A READ, AND HAS NO SHAPE THROUGH WHICH IT COULD BECOME MORE. There is
   * no writer here, no transport, and no branch that could decide to resend
   * something it found in a worrying state - it returns rows. The same rule the
   * reconciler is built around applies with more force to a route staff can
   * refresh at will: a round that may be on the tab is LOOKED AT, never sent
   * again.
   */
  async readRounds(orderId: string): Promise<RoundStatusView[]> {
    const rounds = await this.prisma.nativeTableRound.findMany({
      where: { orderId },
      orderBy: { sequence: 'asc' },
      include: {
        // Newest first, and only one: the "waiting since" clock staff are shown
        // must be the same instant escalation measures from, which is the most
        // recent attempt's. An older attempt's timestamp would make a round
        // look more overdue than the sweep considers it.
        attempts: { orderBy: { sendInitiatedAt: 'desc' }, take: 1 },
        // The whole line, not just a count: a round that needs a human needs
        // its contents rendered so somebody can compare them to a real bill.
        items: {
          select: {
            id: true,
            menuItemTitle: true,
            quantity: true,
            seat: true,
            menuItem: { select: { posProductCode: true } },
          },
        },
      },
    });

    return rounds.map((round) => {
      const described = describeRoundForReadback(round.state);
      return {
        roundId: round.id,
        sequence: round.sequence,
        state: round.state,
        ...described,
        sendInitiatedAt: round.attempts[0]?.sendInitiatedAt ?? null,
        lineCount: round.items.length,
        // ONLY WHERE A HUMAN IS BEING ASKED. Attaching it to every round would
        // put a customer's order contents on screens that have no question to
        // answer, and would invite a UI to render an attestation panel beside a
        // round nobody may attest to.
        attestation: described.requiresReconciliation
          ? {
              posTableCode: round.posTableCode,
              guests: round.guests,
              lines: round.items.map((i) => ({
                description: i.menuItemTitle,
                quantity: i.quantity,
                plu: i.menuItem?.posProductCode ?? null,
                seat: i.seat,
              })),
              externalOrderId: round.idempotencyKey,
              sentAt: round.attempts[0]?.sendInitiatedAt ?? null,
              // A PREFIX ONLY. Enough to match a row during an incident review,
              // never enough to reconstruct a token and hand it to a till.
              tokenPrefix: round.attempts[0]?.token
                ? `${round.attempts[0].token.slice(0, 8)}...`
                : null,
            }
          : null,
      };
    });
  }

  /**
   * SETTLE AN UNRESOLVED ROUND ON A HUMAN'S WORD. Sends nothing, opens nothing.
   *
   * THE DEAD END THIS OPENS. `unresolved` holds the table's single in-flight
   * slot, so while one stands `openRound` refuses every further round on that
   * table. Its two machine exits - `confirmed` and `failed` - are both written
   * by the reconciler, and both need evidence read from the till. No connector
   * build binds an evidence reader yet. So in the configuration this
   * integration actually ships in, the reconciler's verdict is permanently
   * `manualResolutionRequired`, every round escalates to `unresolved` once its
   * window runs out, and the table is finished for the rest of the service with
   * no way back. The verdict has been named `manualResolutionRequired` since
   * the predicate was written; this is the manual resolution it names.
   *
   * IT CANNOT SEND. There is no writer on this path and no transport call in
   * it. That is not an accident of implementation, it is the point: this route
   * is reached precisely when a round MAY ALREADY BE ON THE TAB, which is the
   * worst possible moment to give code the ability to send it. The resolution
   * of a round that may be in the kitchen is a bookkeeping act. Where the
   * lines need to go to the kitchen after all, they go on the NEXT round, sent
   * by a waiter pressing Send - deliberately, with the table unblocked and the
   * screen showing what happened.
   *
   * ONLY `unresolved` IS RESOLVABLE. Not `awaiting_native_confirmation`: that
   * round is still inside its window and the machine may yet settle it on real
   * evidence, so letting testimony pre-empt it would replace evidence that is
   * coming with evidence that is weaker. Not `submitting`: a socket may be open
   * for it this instant. Not the terminal states: they are settled, and
   * re-settling them is rewriting history.
   *
   * THE RACE IS WON AT THE DATABASE, not by a read-then-write. Two managers on
   * two tablets, or a manager and a reconciler sweep landing a real `confirmed`
   * at the same moment, are both ordinary on a busy service. The update is
   * conditional on the row STILL being `unresolved`, so exactly one writer can
   * win; the loser is told what the round is now rather than being handed an
   * error that invites a retry.
   */
  async resolveRound(options: {
    readonly orderId: string;
    readonly sequence: number;
    readonly outcome: ManualResolutionOutcome;
    readonly basis: string;
    readonly resolvedByUserId: string;
    readonly resolvedByActingStaffId?: string | null;
    readonly now?: Date;
  }): Promise<ManualResolutionResult> {
    const now = options.now ?? new Date();

    // ── AN OUTCOME THIS METHOD DOES NOT KNOW SETTLES NOTHING. ──
    //
    // The DTO's `IsIn` is the guard on the HTTP boundary, and this is the one
    // behind it. It exists because of what the FALL-THROUGH would be: the
    // `notFound` branch below is an early return and everything after it is the
    // `present` path, so an outcome that is neither - a reinstated
    // `didNotLand`, a client on an older contract, an internal caller that
    // skips validation - would be silently treated as an attestation and settle
    // a round nobody attested to. Named explicitly rather than restructured
    // into a switch, because the property worth asserting is "unknown means
    // refuse", not "the branches happen to be ordered safely today".
    if (options.outcome !== 'present' && options.outcome !== 'notFound') {
      throw new NativeRoundError(
        'not_resolvable',
        `'${String(options.outcome)}' is not something a person can report about a round. ` +
          'Nothing was changed.',
      );
    }

    const round = await this.prisma.nativeTableRound.findFirst({
      where: { orderId: options.orderId, sequence: options.sequence },
      select: { id: true, state: true, resolvedByUserId: true, resolvedAt: true },
    });
    if (!round) {
      throw new NativeRoundError(
        'order_not_found',
        `no round ${options.sequence} exists on order ${options.orderId}`,
      );
    }

    // Checked here so the refusal can name the state, and enforced again by the
    // conditional write below - which is the check that actually holds.
    if (round.state !== NativeRoundState.unresolved) {
      throw new NativeRoundError(
        round.state === NativeRoundState.resolved_manually || round.resolvedAt !== null
          ? 'already_resolved'
          : 'not_resolvable',
        describeWhyNotResolvable(round.state),
      );
    }

    // ── `notFound` RECORDS AND CHANGES NOTHING. ──
    //
    // Not a resolution, and not the other half of a pair. A manager failing to
    // see a round is a FAILURE TO OBSERVE, not evidence of absence: the
    // receiver ACKs before durable processing, a packet can sit in a 200-slot
    // buffer waiting for a drain loop, and the manager may be at the wrong
    // table or ahead of the kitchen printer. Every one of those reads as "I
    // cannot see it" while the food is on its way to the customer.
    //
    // So the round stays exactly as unresolved as it was, its lines stay
    // claimed, and the table stays blocked. The observation is written to the
    // audit log by the caller, which is where a statement by a named person
    // belongs, and staff are told what to do with a table only they can clear.
    if (options.outcome === 'notFound') {
      this.logger.warn(
        `Round ${round.id} (order ${options.orderId} seq ${options.sequence}) was CHECKED BY ` +
          `user ${options.resolvedByUserId} who could not see it: ${options.basis}. Nothing was ` +
          'changed - its lines stay claimed, it will not be sent again, and the table stays ' +
          'blocked until somebody settles the customer in IdealPOS.',
      );
      return {
        roundId: round.id,
        sequence: options.sequence,
        outcome: 'notFound',
        state: NativeRoundState.unresolved,
        linesReleased: false,
        settled: false,
        resolvedAt: now,
        message:
          'Recorded: you checked IdealPOS and could not see this round. NOTHING HAS CHANGED ' +
          'and these items have NOT been sent again - the till can accept an order before it ' +
          'shows up, so not seeing it is not proof it is missing. Settle this customer on the ' +
          'till in IdealPOS. Do not re-send this round from the tablet.',
      };
    }

    // ── `present` SETTLES IT, AND KEEPS THE LINES CLAIMED. ──
    //
    // Claimed lines cannot be swept into a later round, so the worst case of a
    // mistaken attestation is a customer who ordered food and did not get it -
    // noticed within minutes, fixed by ordering it again. There is no line
    // movement anywhere on this path.
    const won = await this.prisma.nativeTableRound
      .updateMany({
        // THE GUARD. `updateMany` with the state in the WHERE clause is an
        // atomic compare-and-set: whichever of two concurrent attestations gets
        // there second matches no rows and changes nothing. It also means a
        // round the reconciler CONFIRMED a moment ago keeps its confirmation -
        // machine evidence is never overwritten by testimony.
        where: { id: round.id, state: NativeRoundState.unresolved },
        data: {
          state: NativeRoundState.resolved_manually,
          resolvedByUserId: options.resolvedByUserId,
          resolvedByActingStaffId: options.resolvedByActingStaffId ?? null,
          resolvedAt: now,
          resolutionBasis: options.basis,
        },
      })
      .then(({ count }) => count > 0);

    if (!won) {
      // Somebody else got there first. Re-read rather than guess, so the
      // message names what the round actually is now.
      const current = await this.prisma.nativeTableRound.findUnique({
        where: { id: round.id },
        select: { state: true },
      });
      throw new NativeRoundError(
        'already_resolved',
        `round ${options.sequence} was settled by someone else while this was being submitted; ` +
          `it is now ${current?.state ?? 'unknown'}. Nothing was changed by this request.`,
      );
    }

    this.logger.warn(
      `Round ${round.id} (order ${options.orderId} seq ${options.sequence}) ATTESTED PRESENT by ` +
        `user ${options.resolvedByUserId}: ${options.basis}. Its lines stay claimed by this ` +
        'round and will NOT go with a later one. This is testimony, not till evidence.',
    );

    return {
      roundId: round.id,
      sequence: options.sequence,
      outcome: 'present',
      state: NativeRoundState.resolved_manually,
      // NEVER TRUE ON THIS PATH. Kept as an explicit field rather than left to
      // be inferred, because "will these items be sent again?" is the one
      // question a client must never derive wrong - and because a future
      // change that made it true would have to say so here, in front of a
      // reviewer, rather than by quietly adding a branch.
      linesReleased: false,
      settled: true,
      resolvedAt: now,
      message:
        'Recorded: a staff member checked IdealPOS and confirmed this round is on the table. ' +
        'It will not be sent again, and its items will not appear on a later round. The table ' +
        'is free for the next round.',
    };
  }

  /**
   * Map the outcome to a durable state and a staff-facing message.
   *
   * THE DURABLE STATE IS NOT DECIDED HERE. It comes from
   * `decideFromResponse`/`decideFromNonResponse` in `waiterpad-round-state.ts`,
   * which is where every response type has already been reasoned about against
   * the traced receiver behaviour. Re-deriving it here would create a second
   * policy that drifts from the first - and the first is the one with the
   * evidence and the tests behind it. This method only translates.
   *
   * IT BRANCHES ON `bytesLeftHost` FIRST, before looking at any response,
   * because that is the only field that separates "provably nothing was sent"
   * from everything else. Reading the response first is how an ambiguous send
   * gets reported as a clean failure and then re-sent by a helpful waiter.
   *
   * NOTHING HERE WRITES `confirmed`. The best a send can reach is
   * `awaiting_native_confirmation`; only reconciliation holding the till's own
   * token row may go further.
   */
  private async applyDecision(
    roundId: string,
    result: WaiterPadWriteResult,
  ): Promise<SendToKitchenResult> {
    const { outcome, decision } = result;

    if (!outcome.bytesLeftHost) {
      await this.settleWithoutSendAndRelease(roundId, NativeRoundState.abandoned);
      return {
        status: 'failedBeforeSend',
        roundId,
        message:
          'The order was NOT sent - the till could not be reached and nothing left this ' +
          'device. It is safe to send again.',
      };
    }

    const to = decision.transition.to;

    // ── `rejected` IS COUPLED TO `not_accepted`, AND THE COUPLING IS CHECKED. ──
    //
    // `rejected` is the one post-send state that gives the lines back, so it is
    // the one post-send state that could ever duplicate a customer's food. Its
    // licence is not the name of the transition - it is `nativeEffect`, which
    // the decision table grants ONLY to LOCK, whose "LOCKED BY" check returns
    // before the receiver's buffering loop runs.
    //
    // Read from the decision rather than from the state, because a future
    // response type mapped to `rejected` without that proof would inherit the
    // release silently. If one ever appears, it lands on `unresolved` instead:
    // a table a human must look at, which is survivable, rather than a second
    // docket, which is not.
    if (to === 'rejected' && decision.nativeEffect !== 'not_accepted') {
      this.logger.error(
        `round ${roundId} mapped to 'rejected' with nativeEffect '${decision.nativeEffect}', ` +
          "which does not prove non-acceptance. Downgrading to 'unresolved' rather than " +
          'releasing its lines. This is a decision-table bug and needs fixing.',
      );
      await this.setState(roundId, NativeRoundState.unresolved);
      return {
        status: 'uncertain',
        roundId,
        message:
          'This round MAY already be on the table in IdealPOS - the till did not answer ' +
          'clearly. DO NOT send it again. Check the table in IdealPOS before doing anything ' +
          'else.',
      };
    }

    if (to === 'rejected') {
      // POSITIVE EVIDENCE NOTHING WAS CREATED, so the lines go back on the
      // order in the SAME write that records the rejection.
      //
      // The API answers this outcome with `safeToRetry: true`. Until now that
      // was a promise the database could not keep: the round kept its lines,
      // so the retry it invited hit `nothing_to_send` - "every line on this
      // order has already been assigned to a round" - and the order was
      // stranded on a table nobody could clear. `safeToRetry: true` now means
      // what it says, because the next press genuinely carries these lines.
      //
      // The state stays `rejected` rather than becoming `abandoned`: the till
      // refusing a round and Verdura declining to send one are different
      // events, and an incident review a week later needs to tell them apart.
      await this.settleWithoutSendAndRelease(roundId, NativeRoundState.rejected);
      return {
        status: 'rejected',
        roundId,
        message: `IdealPOS did not take this round, and nothing was created. ${decision.reason}`,
      };
    }

    await this.setState(roundId, toNativeState(to));

    if (to === 'awaiting_native_confirmation') {
      return {
        status: 'sentAwaitingConfirmation',
        roundId,
        message:
          'Sent to IdealPOS. Waiting for the till to confirm the round landed on the table - ' +
          'this is not yet proof the kitchen has it.',
      };
    }

    // Unresolved. NAKREGO gets its own operational message because the fix is
    // a licence rather than anything a waiter can do at the table - but its
    // durable state stays unresolved like every other unproven outcome, so
    // nothing here can auto-retry it.
    if (outcome.kind === 'responded' && outcome.response.type === 'NAKREGO') {
      return {
        status: 'registrationRejected',
        roundId,
        message:
          "IdealPOS refused this device's handheld registration, so no order was created. " +
          'Verdura needs its own IdealPOS handheld licence. Do not send this again - ' +
          'it will be refused the same way until the licence exists.',
      };
    }

    return {
      status: 'uncertain',
      roundId,
      message:
        'This round MAY already be on the table in IdealPOS - the till did not answer ' +
        'clearly. DO NOT send it again. Check the table in IdealPOS before doing anything ' +
        'else.',
    };
  }

  /**
   * End a round that PROVABLY never sent, and give its lines back.
   *
   * REACHED ONLY WHERE `bytesLeftHost` IS FALSE - the writer refused before
   * opening a socket, or the connection never established. That precondition
   * is the whole licence for what this does: releasing the lines of a round
   * that MIGHT have been sent would let the next round carry them a second
   * time, which is the one failure this module exists to prevent.
   *
   * WHY RELEASE RATHER THAN LEAVE THEM CLAIMED. An earlier version returned the
   * round to `drafting` with its lines still stamped. That looked conservative
   * and was actually a trap: the next press opened a NEW round, whose "lines no
   * round has carried yet" query found nothing, and the waiter got
   * `nothing_to_send` on an order whose food had never been sent anywhere. The
   * table was stuck, and the only visible symptom was a refusal that read like
   * the order had already gone.
   *
   * The round is kept rather than deleted so the attempt history stays
   * readable: an incident review can still see that a round was opened, frozen
   * and refused, and why.
   *
   * THE STATE IS A PARAMETER BECAUSE TWO DIFFERENT EVENTS END HERE, and an
   * incident review needs to tell them apart:
   *
   *   `abandoned` - VERDURA declined to send. The writer was disabled or
   *                 misconfigured, a seat it will not send, an unmapped PLU, or
   *                 the connection never established. Nothing left this device.
   *   `rejected`  - the TILL declined it, with positive evidence that nothing
   *                 was created (`nativeEffect: 'not_accepted'`, which only
   *                 LOCK earns). Bytes left; nothing was accepted.
   *
   * Both are settled, both created nothing, and both therefore give the lines
   * back. Collapsing them into one state would lose the only distinction that
   * matters at 9pm on a Friday: whether to look at the till or at the config.
   */
  private async settleWithoutSendAndRelease(
    roundId: string,
    state: Extract<
      NativeRoundState,
      typeof NativeRoundState.abandoned | typeof NativeRoundState.rejected
    >,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { nativeRoundId: roundId },
        data: { nativeRoundId: null },
      });
      await tx.nativeTableRound.update({
        where: { id: roundId },
        data: { state, payloadFrozenAt: null },
      });
    });
  }

  private async setState(
    roundId: string,
    state: NativeRoundState,
    extra: Prisma.NativeTableRoundUpdateInput = {},
  ): Promise<void> {
    await this.prisma.nativeTableRound.update({
      where: { id: roundId },
      data: { state, ...extra },
    });
  }

  /**
   * Resolve every line to a real IdealPOS product code, or refuse the round.
   *
   * Uses the same dual-read resolution the Webit dispatcher uses, so the two
   * paths can never disagree about a menu item's native code. A miss is fatal
   * to the WHOLE round rather than to one line: a partial round hands the
   * kitchen an order the customer did not place.
   */
  private async resolveLines(
    items: readonly {
      menuItemId: string;
      menuItemTitle: string;
      quantity: number;
      seat: number | null;
      notes: string | null;
    }[],
  ): Promise<TableRoundLine[]> {
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: items.map((i) => i.menuItemId) } },
      include: { posIdentity: true },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    return items.map((item) => {
      const menuItem = byId.get(item.menuItemId);
      const resolution = resolveNativeProductCode({
        posProductCode: menuItem?.posProductCode ?? null,
        posIdentity: menuItem?.posIdentity ?? null,
      });
      if (!resolution.ok) {
        throw new NativeRoundError(
          'unmapped_item',
          `"${item.menuItemTitle}" has no usable IdealPOS product code (${resolution.reason}). ` +
            'Refusing the whole round: sending it without this item would give the kitchen ' +
            'an order the customer did not place, and inventing a code would bill them for ' +
            'the wrong product.',
        );
      }
      return {
        plu: resolution.nativeCode,
        description: item.menuItemTitle,
        quantity: item.quantity,
        // NULL means "no seat" throughout the pipeline. It becomes 0 here,
        // which is the protocol's own "no seat", never a fabricated number.
        seat: item.seat ?? 0,
        instructions: item.notes ? [item.notes] : undefined,
      };
    });
  }
}

/**
 * Translate the domain round state the decision selected into its durable
 * enum. Exhaustive on purpose: a new state added to the decision table fails
 * the type check here rather than silently becoming `unresolved`, which would
 * be safe but would also hide that nobody had handled it.
 */
function toNativeState(
  to: 'awaiting_native_confirmation' | 'rejected' | 'unresolved',
): NativeRoundState {
  switch (to) {
    case 'awaiting_native_confirmation':
      return NativeRoundState.awaiting_native_confirmation;
    case 'rejected':
      return NativeRoundState.rejected;
    case 'unresolved':
      return NativeRoundState.unresolved;
  }
}

/**
 * What to tell staff about a round this request did NOT send.
 *
 * Reached only from the duplicate-request path, and every branch is written
 * for a waiter looking at a tablet mid-service rather than for a log reader.
 *
 * THE RULE THAT SHAPES ALL OF IT: a second tap is not evidence about the first
 * tap's outcome. A round that was unresolved before this request is unresolved
 * after it, and the message says so plainly rather than letting a hopeful
 * reading of "already sent" turn into a third tap.
 */
function describeExistingRound(roundId: string, state: NativeRoundState): SendToKitchenResult {
  switch (state) {
    case NativeRoundState.confirmed:
      return {
        status: 'sentAwaitingConfirmation',
        roundId,
        message: 'This round is already on the table in IdealPOS. Nothing was sent again.',
      };
    case NativeRoundState.awaiting_native_confirmation:
    case NativeRoundState.submitting:
      return {
        status: 'sentAwaitingConfirmation',
        roundId,
        message:
          'This round has already been sent and is waiting for the till to confirm it. ' +
          'Nothing was sent again.',
      };
    case NativeRoundState.rejected:
      return {
        status: 'rejected',
        roundId,
        message: 'IdealPOS did not take this round, and nothing was created on the table.',
      };
    case NativeRoundState.unresolved:
      return {
        status: 'uncertain',
        roundId,
        message:
          'This round may already be on the table and may not be - it has not been resolved. ' +
          'DO NOT send it again. Check the table in IdealPOS, or ask a manager to resolve it.',
      };
    case NativeRoundState.resolved_manually:
      // Somebody has already checked the till and vouched for this round, so a
      // second tap has nothing to do. `sentAwaitingConfirmation` for the same
      // reason `confirmed` uses it: this vocabulary has no settled-and-proven
      // member, and the one thing that must be unambiguous is that this
      // request sent nothing.
      return {
        status: 'sentAwaitingConfirmation',
        roundId,
        message:
          'A staff member has already checked IdealPOS and recorded that this round is on the ' +
          'table. Nothing was sent again.',
      };
    case NativeRoundState.drafting:
      // A round found by request key that is STILL DRAFTING means another
      // request carrying the same key got here first and is mid-send right
      // now. It is emphatically not "safe to send again": the other request's
      // packet may be on the wire as this one answers.
      return {
        status: 'sentAwaitingConfirmation',
        roundId,
        message:
          'This send is already being processed. Nothing was sent again - wait for it to ' +
          'finish rather than pressing again.',
      };
    case NativeRoundState.failed:
    case NativeRoundState.abandoned:
      // Provably nothing left the host, and the lines have been released back
      // onto the order - so they will go with the next round, and pressing
      // Send again is exactly the right thing to do.
      return {
        status: 'failedBeforeSend',
        roundId,
        message:
          `This round ended as ${state} and was not sent. Its lines are back on the order ` +
          'and will go with the next round.',
      };
  }
}

/**
 * The durable state, as a sentence for staff who are LOOKING rather than sending.
 *
 * Deliberately not shared with `describeExistingRound` above, which maps the
 * same enum. That one is written for the instant after a second tap, and every
 * message it produces says some form of "nothing was sent again" - which is
 * true there and meaningless here, where the reader pressed nothing. Sharing
 * them would force one context's sentence onto the other, and the wrong half of
 * that trade is a screen telling a waiter about a send they did not make.
 *
 * Exhaustive over the enum with no default, so a state added later fails the
 * type check here rather than quietly inheriting whichever branch was last.
 *
 * THE ASYMMETRY THIS TABLE ENCODES. `requiresReconciliation` is TRUE only for
 * `unresolved`, and that is the one state a round can arrive in without anybody
 * pressing anything - escalation puts it there when a send has gone unproven
 * for too long. Every other state is either settled or still legitimately in
 * flight. A round is never talked down: nothing in this table turns an
 * unresolved round back into a reassuring message.
 */
function describeRoundForReadback(state: NativeRoundState): {
  status: RoundReadStatus;
  message: string;
  requiresReconciliation: boolean;
  settled: boolean;
} {
  switch (state) {
    case NativeRoundState.confirmed:
      return {
        status: 'confirmed',
        message: 'On the table in IdealPOS. The till is holding this round.',
        requiresReconciliation: false,
        settled: true,
      };
    case NativeRoundState.awaiting_native_confirmation:
      return {
        status: 'awaitingConfirmation',
        message: 'Sent to the till. Waiting for confirmation that it landed.',
        requiresReconciliation: false,
        settled: false,
      };
    case NativeRoundState.unresolved:
      // The escalation target, and the reason this readback exists. A round
      // reaches it either from an ambiguous send or from having claimed to be
      // "awaiting the till" for longer than anyone should believe.
      return {
        status: 'unresolved',
        message:
          'This round may be on the table and may not be - nobody knows. ' +
          'DO NOT send it again. Check the table in IdealPOS, or ask a manager.',
        requiresReconciliation: true,
        settled: false,
      };
    case NativeRoundState.resolved_manually:
      // Settled on a person's word, and SAID SO. The message names the human
      // origin rather than borrowing `confirmed`'s sentence, because a waiter
      // reading "the till is holding this round" would reasonably believe the
      // machine had checked - and nothing has. What is true is narrower and is
      // what gets said: somebody looked, and this will not be sent again.
      return {
        status: 'resolvedManually',
        message:
          'Settled by hand: a staff member checked IdealPOS and recorded that this round is ' +
          'on the table. It will not be sent again.',
        requiresReconciliation: false,
        settled: true,
      };
    case NativeRoundState.rejected:
      // Settled, created nothing, and its lines are BACK ON THE ORDER - which
      // is the half a waiter has to act on. Saying only "refused" left them
      // wondering whether the food still needed ordering.
      return {
        status: 'rejected',
        message:
          'The till refused this round and nothing was created on the table. Its items are ' +
          'back on the order and will go with the next round you send.',
        requiresReconciliation: false,
        settled: true,
      };
    case NativeRoundState.failed:
    case NativeRoundState.abandoned:
      return {
        status: 'notSent',
        message: `This round ended as ${state} and never reached the till. Its lines are back on the order.`,
        requiresReconciliation: false,
        settled: true,
      };
    case NativeRoundState.drafting:
    case NativeRoundState.submitting:
      // Mid-flight this instant. Not settled and not a human's problem yet -
      // but emphatically not "safe to send again" either, which is why the
      // in-flight slot rather than this message is what guards a second tap.
      return {
        status: 'assembling',
        message: 'This round is being sent right now.',
        requiresReconciliation: false,
        settled: false,
      };
  }
}

/**
 * Is this the unique-constraint failure for a specific column?
 *
 * Narrow on purpose. A broad "was it a P2002" would also swallow a collision
 * on `idempotencyKey` or on `(orderId, sequence)`, and those two mean
 * something entirely different - two rounds racing for the same sequence
 * number, which must surface rather than be answered with somebody else's
 * round.
 */
function isUniqueViolation(err: unknown, column: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (!e || e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.some((t) => String(t).includes(column));
  return typeof target === 'string' ? target.includes(column) : false;
}

/**
 * Why a round cannot be settled by hand, phrased for the person holding the
 * tablet rather than for a log.
 *
 * Exhaustive with no default, so a state added later fails the type check here
 * instead of inheriting a sentence written about some other state.
 */
function describeWhyNotResolvable(state: NativeRoundState): string {
  switch (state) {
    case NativeRoundState.awaiting_native_confirmation:
      return (
        'This round is still waiting for the till, and the server may yet settle it on real ' +
        'evidence. Nothing was changed. If it is still unresolved in a few minutes it can be ' +
        'settled by hand then.'
      );
    case NativeRoundState.submitting:
    case NativeRoundState.drafting:
      return 'This round is being sent right now. Nothing was changed - wait for it to finish.';
    case NativeRoundState.confirmed:
      return 'The till itself confirmed this round; there is nothing to settle. Nothing was changed.';
    case NativeRoundState.resolved_manually:
      return 'A staff member has already settled this round. Nothing was changed.';
    case NativeRoundState.rejected:
      return 'IdealPOS refused this round and created nothing. Nothing was changed.';
    case NativeRoundState.failed:
    case NativeRoundState.abandoned:
      return (
        `This round ended as ${state}; its lines are already back on the order. ` +
        'Nothing was changed.'
      );
    case NativeRoundState.unresolved:
      // Not reachable: the caller checks for this state before asking. Kept so
      // the switch stays exhaustive over the enum rather than needing a
      // default that would swallow a state added later.
      return 'This round is unresolved and can be settled by hand.';
  }
}

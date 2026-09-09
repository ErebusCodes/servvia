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
import { NativeRoundState, type Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { resolveNativeProductCode } from '../resolve-native-product-code';
import { newAttemptId } from './waiterpad-token';
import { TABLE_ROUND_WRITER } from './waiterpad-writer.provider';
import {
  type ITableRoundWriter,
  type TableRoundLine,
  type WaiterPadWriteResult,
} from './waiterpad-table-round-writer';
import type { OrderRound } from '../../orders/rounds/order-round.model';

export type NativeRoundFailureReason =
  | 'unmapped_table'
  | 'unmapped_item'
  | 'nothing_to_send'
  | 'round_in_flight'
  | 'order_not_found'
  | 'not_dine_in';

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
   * Claim the unsent lines of an order into a new round.
   *
   * ONE TRANSACTION, and the claim is the point of it. Creating the round and
   * stamping its lines must be atomic, or a crash between them leaves lines
   * belonging to a round that does not describe them - and the next round
   * would then either double-send them or skip them.
   */
  async openRound(orderId: string): Promise<{ id: string; sequence: number }> {
    return await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { table: true, nativeRounds: { select: { sequence: true, state: true } } },
      });
      if (!order) {
        throw new NativeRoundError('order_not_found', `order ${orderId} does not exist`);
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

      // The delta: only lines no round has carried yet.
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

    // Resolve BEFORE freezing: an unmapped PLU is a deterministic refusal that
    // should leave the round exactly as it was, editable and re-sendable.
    const lines = await this.resolveLines(round.items);

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
      // or a seat it will not send. Nothing left the host, so the round returns
      // to drafting with its lines still claimed, re-sendable under the SAME
      // round identity once the cause is fixed.
      await this.prisma.nativeTableRound.update({
        where: { id: roundId },
        data: { state: NativeRoundState.drafting, payloadFrozenAt: null },
      });
      const message = err instanceof Error ? err.message : 'the native writer refused this round';
      this.logger.warn(`round ${roundId} refused before send: ${message}`);
      return { status: 'failedBeforeSend', roundId, message };
    }

    return await this.applyDecision(roundId, result);
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
      await this.setState(roundId, NativeRoundState.drafting, { payloadFrozenAt: null });
      return {
        status: 'failedBeforeSend',
        roundId,
        message:
          'The order was NOT sent - the till could not be reached and nothing left this ' +
          'device. It is safe to send again.',
      };
    }

    const to = decision.transition.to;
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

    if (to === 'rejected') {
      // Reachable only for an outcome with positive evidence of
      // non-acceptance - today that is LOCK, whose check runs before the
      // receiver buffers anything.
      return {
        status: 'rejected',
        roundId,
        message: `IdealPOS did not take this round, and nothing was created. ${decision.reason}`,
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

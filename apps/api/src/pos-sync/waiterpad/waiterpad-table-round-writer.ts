/**
 * The native table-round writer: Order Tablet -> Order2 -> TCP 6983.
 *
 * WHAT THIS IS RESPONSIBLE FOR, IN ORDER, AND WHY THE ORDER MATTERS:
 *
 *   1. refuse unless configuration is complete       (`waiterpad-config.ts`)
 *   2. refuse a round that is not durably persisted  (`assertPersistedBeforeSend`)
 *   3. derive the duplicate token from durable ids   (`waiterpad-token.ts`)
 *   4. build the packet                              (`waiterpad-order2-packet.ts`)
 *   5. hand it to the caller's `recordSendInitiated` hook and WAIT for it
 *   6. send once                                     (`waiterpad-transport.ts`)
 *   7. map the outcome to a licensed transition      (`waiterpad-round-state.ts`)
 *
 * Step 5 is the one that is easy to get wrong. The attempt must be durable
 * BEFORE any byte can leave, or a crash mid-send leaves no record that a send
 * ever happened, and the next start cannot tell "never sent" from "sent, result
 * unknown". Those two need opposite handling, so the writer will not proceed
 * until the hook resolves.
 *
 * WHAT THIS IS NOT RESPONSIBLE FOR: deciding to try again. There is no retry
 * here and no code path that calls `sendOrder2Once` twice. A second attempt is
 * a new attempt id, minted by a caller that made that decision knowingly.
 *
 * WEBORDER IS ABSENT BY CONSTRUCTION. This module imports nothing from the
 * WebOrder / InsertOrders / Doshii / Ecommerce paths and has no fallback branch
 * of any kind. A refusal is a refusal.
 */

import { createHash } from 'node:crypto';

import type { OrderRound } from '../../orders/rounds/order-round.model';
import type { WaiterPadConfig } from './waiterpad-config';
import type { ExpectedNativeItem, NativeTableSnapshot } from './waiterpad-native-evidence';
import {
  serialiseOrder2,
  type Order2Line,
  type Order2Packet,
  type Order2Pricing,
} from './waiterpad-order2-packet';
import {
  decideFromNonResponse,
  decideFromResponse,
  assertPersistedBeforeSend,
  type WaiterPadOutcomeDecision,
} from './waiterpad-round-state';
import { assertValidWaiterPadToken, deriveWaiterPadToken } from './waiterpad-token';
import {
  sendOrder2Once,
  type WaiterPadSendOutcome,
  type WaiterPadSocketFactory,
} from './waiterpad-transport';

/**
 * The native delta this packet asks for, summed by PLU.
 *
 * Quantities are summed rather than listed because the native side splits a
 * quantity across rows - the sealed Table 5 run recorded qty 2 as TWO qty-1
 * rows, not Col3=2 - so a readback is only comparable to this as a multiset.
 * Text/instruction siblings are not lines and contribute nothing.
 */
function expectedItemsFrom(lines: readonly TableRoundLine[]): readonly ExpectedNativeItem[] {
  const byCode = new Map<string, number>();
  for (const line of lines) {
    const code = line.plu.trim();
    byCode.set(code, (byCode.get(code) ?? 0) + line.quantity);
  }
  return [...byCode.entries()].map(([nativeCode, quantity]) => ({ nativeCode, quantity }));
}

export class WaiterPadWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadWriterError';
  }
}

/** A line as the Order Tablet knows it, before protocol concerns. */
export interface TableRoundLine {
  readonly plu: string;
  readonly description: string;
  readonly quantity: number;
  readonly seat?: number;
  /** Only consulted when the configured price policy is `explicit`. */
  readonly explicitAmount?: string;
  /** Kitchen instructions, emitted as sibling `Type=Text` items after the line. */
  readonly instructions?: readonly string[];
}

export interface TableRoundSubmission {
  readonly round: OrderRound;
  readonly attemptId: string;
  readonly table: number;
  readonly guests: number;
  readonly lines: readonly TableRoundLine[];

  /**
   * The native table as it stood BEFORE this send, read by the caller.
   *
   * SUPPLIED RATHER THAN READ HERE, deliberately. This writer holds a socket
   * factory and nothing else; giving it a reader would put a second I/O
   * dependency on the one path that must stay auditable byte-for-byte. The
   * caller owns both reads of the delta, which is also what keeps them in the
   * same table context.
   *
   * Optional because a build with no evidence reader bound has no baseline to
   * offer, and that is a supported configuration - it simply cannot confirm.
   */
  readonly preSendBaseline?: NativeTableSnapshot;
}

/**
 * Durable record of an attempt, written BEFORE any byte leaves.
 *
 * Everything needed to reason about an ambiguous send after a crash is here.
 * `payloadHash` rather than the payload: it is enough to prove that a later
 * attempt is or is not the same bytes, without storing customer order content
 * twice.
 */
export interface SendInitiatedRecord {
  readonly roundId: string;
  readonly attemptId: string;
  readonly externalOrderId: string;
  readonly table: number;
  readonly deviceId: string;
  readonly token: string;
  readonly payloadHash: string;
  readonly sendInitiatedAt: Date;

  /**
   * The pre-send baseline, carried through to persistence. See
   * `TableRoundSubmission.preSendBaseline`.
   */
  readonly preSendBaseline?: NativeTableSnapshot;

  /**
   * What this packet actually asked the till to add, derived from the lines
   * that were built into it rather than from the order.
   *
   * DERIVED FROM THE PACKET ON PURPOSE. This is the term confirmation
   * subtracts the baseline against, so it must describe what LEFT, not what
   * was intended. Reading it back off the order later would let a menu edit
   * change what a historical round is judged against.
   */
  readonly expectedItems: readonly ExpectedNativeItem[];
}

export interface WaiterPadWriterHooks {
  /**
   * Persist the attempt. MUST be durable before it resolves. The writer will
   * not send if this rejects, and treats a rejection as `failedBeforeSend` —
   * the one outcome that is provably safe to retry as a NEW attempt.
   */
  recordSendInitiated(record: SendInitiatedRecord): Promise<void>;
  /** Optional: record the raw outcome for later reconciliation. */
  recordOutcome?(record: SendInitiatedRecord, outcome: WaiterPadSendOutcome): Promise<void>;
  /**
   * Optional: record the LICENSED TRANSITION this writer derived from that
   * outcome. Separate from `recordOutcome` because they are different claims -
   * one is what the transport observed, the other is what we concluded is
   * permitted - and a single column holding both has already been a source of
   * confusion between "the till said NAK" and "we decided this is uncertain".
   *
   * MUST NOT THROW, AND MUST NOT BE AWAITED IN A WAY THAT CHANGES THE RESULT.
   * By the time it is called the bytes have already gone. See the call site.
   */
  recordDecision?(record: SendInitiatedRecord, decision: WaiterPadOutcomeDecision): Promise<void>;
  now?(): Date;
}

export interface WaiterPadWriteResult {
  readonly decision: WaiterPadOutcomeDecision;
  readonly outcome: WaiterPadSendOutcome;
  readonly record: SendInitiatedRecord;
}

/**
 * The seam the application depends on. `DisabledTableRoundWriter` and this
 * implementation are interchangeable, so the feature gate is a wiring decision
 * rather than a branch inside business logic.
 */
export interface ITableRoundWriter {
  writeRound(submission: TableRoundSubmission): Promise<WaiterPadWriteResult>;
}

/**
 * The default. Refuses, loudly, with zero socket activity.
 *
 * Kept as the wired implementation until a legitimate handheld licence seat
 * exists (`WAITERPAD-LICENCE-001`) and the remaining acceptance runs.
 */
export class DisabledTableRoundWriter implements ITableRoundWriter {
  constructor(private readonly reasons: readonly string[] = ['native writer is disabled']) {}

  writeRound(): Promise<WaiterPadWriteResult> {
    return Promise.reject(
      new WaiterPadWriterError(
        `native table-round writer is disabled: ${this.reasons.join('; ')}. ` +
          'No fallback exists by design — there is no WebOrder, InsertOrders, ' +
          'Ecommerce or WB* path from here.',
      ),
    );
  }
}

export class WaiterPadTableRoundWriter implements ITableRoundWriter {
  constructor(
    private readonly config: WaiterPadConfig,
    private readonly hooks: WaiterPadWriterHooks,
    private readonly socketFactory?: WaiterPadSocketFactory,
  ) {}

  async writeRound(submission: TableRoundSubmission): Promise<WaiterPadWriteResult> {
    const { round, attemptId, table, guests, lines } = submission;

    // (2) Nothing leaves for a round that is not durably open and frozen.
    assertPersistedBeforeSend(round);

    // Guard the RAW property: narrowing a `readonly TableRoundLine[]` through
    // Array.isArray widens its elements to `any` and silently disables every
    // type check below.
    if (!Array.isArray(submission.lines)) {
      throw new WaiterPadWriterError('lines must be an array');
    }
    if (lines.length === 0) {
      throw new WaiterPadWriterError('a round must carry at least one line');
    }

    // Seat stays fail-closed until a live acceptance proves it. Never silently
    // downgraded to 0 — that would move a customer's item to another seat.
    if (!this.config.allowNonZeroSeat) {
      const offending = lines.findIndex((l) => (l.seat ?? 0) !== 0);
      if (offending >= 0) {
        throw new WaiterPadWriterError(
          `lines[${offending}] carries seat ${String(lines[offending].seat)}, and non-zero ` +
            'seat is not enabled. All 412 observed genuine items carry Seat 0, so the ' +
            'receiver behaviour for a non-zero seat has never been exercised on this ' +
            'till. See WAITERPAD-SEAT-001. The round is refused rather than sent with ' +
            'the seat silently reset to 0.',
        );
      }
    }

    // (3) Token from durable ids, so a restart recomputes the same value.
    const token = deriveWaiterPadToken({ roundId: round.roundId, attemptId });
    assertValidWaiterPadToken(token);

    // (4) Build.
    const packet = this.buildPacket({ table, guests, lines, token });
    const payload = serialiseOrder2(packet);

    const record: SendInitiatedRecord = {
      roundId: round.roundId,
      attemptId,
      externalOrderId: round.idempotencyKey,
      table,
      deviceId: this.config.identity.deviceId,
      token,
      payloadHash: hashPayload(payload),
      sendInitiatedAt: this.hooks.now?.() ?? new Date(),
      preSendBaseline: submission.preSendBaseline,
      expectedItems: expectedItemsFrom(lines),
    };

    // (5) Durable BEFORE the socket. A rejection here is the only provably
    // safe failure, because no byte has been written.
    try {
      await this.hooks.recordSendInitiated(record);
    } catch (err) {
      const outcome: WaiterPadSendOutcome = {
        kind: 'failedBeforeSend',
        bytesLeftHost: false,
        detail: `could not persist the attempt: ${err instanceof Error ? err.message : 'unknown'}`,
        elapsedMs: 0,
      };
      return {
        decision: decideFromNonResponse({ kind: 'connection_lost' }),
        outcome,
        record,
      };
    }

    // (6) Once.
    const outcome = await sendOrder2Once(
      payload,
      { host: this.config.host, port: this.config.port, timeouts: this.config.timeouts },
      this.socketFactory,
    );
    await this.hooks.recordOutcome?.(record, outcome);

    // (7) Map. Note every non-response maps through decideFromNonResponse,
    // which licenses no resend.
    const decision =
      outcome.kind === 'responded'
        ? decideFromResponse(outcome.response)
        : outcome.kind === 'failedBeforeSend'
          ? decideFromNonResponse({ kind: 'connection_lost' })
          : decideFromNonResponse({ kind: 'timeout', waitedMs: outcome.elapsedMs });

    // (8) THE CONCLUSION, WRITTEN DOWN. Diagnostic only, and deliberately the
    // LAST thing that happens.
    //
    // WHY IT IS AFTER THE CLASSIFICATION AND NOT BEFORE. There is no decision
    // to record until the outcome has been mapped; a column written earlier
    // would be a guess, and a guess in the one field an incident review reads
    // to find out what we thought at the time is worse than an empty column.
    //
    // WHY IT CANNOT AFFECT THE RESULT. `decision` is already computed and is
    // returned whatever happens here. A rejection is swallowed by the hook
    // itself, but this call is ALSO wrapped, because the safety argument must
    // not rest on a hook implementation somebody may replace: by this point
    // the bytes have gone, and an exception escaping here would surface to the
    // caller as a thrown send - which reads as "the send failed", the single
    // conclusion this protocol does not license and the one that gets a second
    // docket onto a customer's bill.
    //
    // NOTHING READS IT BACK TO MAKE A SAFETY DECISION. Restart recovery
    // classifies a round from `bytesLeftHost` and whether an outcome was
    // recorded at all, never from this column - so a decision that failed to
    // persist cannot make a round look settled, and one that persisted cannot
    // make a round look releasable.
    try {
      await this.hooks.recordDecision?.(record, decision);
    } catch {
      /* see above: a diagnostic write may never turn a completed send into a failure */
    }

    return { decision, outcome, record };
  }

  private buildPacket(args: {
    table: number;
    guests: number;
    lines: readonly TableRoundLine[];
    token: string;
  }): Order2Packet {
    const { table, guests, lines, token } = args;
    const out: Order2Line[] = [];

    for (const line of lines) {
      out.push({
        kind: 'stockItem',
        stockItem: line.plu,
        description: line.description,
        quantity: line.quantity,
        pricing: this.pricingFor(line),
        seat: line.seat ?? 0,
      });
      for (const instruction of line.instructions ?? []) {
        // A modifier is the NEXT SIBLING item, never a child. Order is
        // load-bearing: the kitchen docket indents it under the line above.
        out.push({ kind: 'text', description: instruction, seat: line.seat ?? 0 });
      }
    }

    return {
      map: this.config.map,
      location: this.config.location,
      posTerminal: this.config.posTerminal,
      table,
      clerk: this.config.clerk,
      guests,
      // Verdura never suppresses the kitchen in production: a round that the
      // kitchen never sees is a round the customer never receives.
      skipKitchen: false,
      kitchenOnly: false,
      voidMode: false,
      // The till recomputes the bill; Total is informational on this path and
      // is emitted as 0 rather than as a number we would be asserting.
      total: '0',
      device: {
        localAddress: this.config.identity.localAddress,
        deviceId: this.config.identity.deviceId,
        pocketPad: this.config.identity.pocketPad,
        deviceModel: this.config.identity.deviceModel,
        deviceOs: this.config.identity.deviceOs,
      },
      checksum: token,
      lines: out,
    };
  }

  private pricingFor(line: TableRoundLine): Order2Pricing {
    if (this.config.pricePolicy.kind === 'nativeResolved') {
      return { mode: 'nativeResolved', priceLevel: this.config.pricePolicy.priceLevel };
    }
    const amount = line.explicitAmount;
    if (amount === undefined) {
      throw new WaiterPadWriterError(
        'price policy is "explicit" but the line carries no amount. Verdura will ' +
          'not invent a price: the receiver uses a non-sentinel amount verbatim, ' +
          'so a guess is charged to the customer.',
      );
    }
    return { mode: 'explicit', amount };
  }
}

function hashPayload(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

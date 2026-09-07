/**
 * Exactly-once, offline: the scenarios where duplicate food gets made.
 *
 * THE INVARIANT UNDER TEST, IN ONE LINE:
 *   NETWORK SUCCESS IS NOT BUSINESS SUCCESS.
 *
 * And its sharpest corollary on this protocol: an `ACK` alone must never mean
 * the round was durably accepted by IdealPOS. `CheckWPOrder` sets its result
 * to 1 BEFORE it looks for a buffer slot, and the slot-exhausted path exits
 * without touching that result — so an ACK is emitted both for a packet parked
 * in volatile memory and for a packet silently dropped. Neither has touched a
 * database row.
 *
 * WHY THESE TESTS EXIST SEPARATELY FROM `waiterpad-round-state.spec.ts`.
 * That file tests the mapping one outcome at a time. This one walks the
 * SEQUENCES an unlucky night actually produces — send, lose the connection,
 * restart, see the table again, be tempted to resend — using the real
 * `order-round.model` functions rather than the decision objects alone. The
 * bug that duplicates a table's food is never in a single mapping; it is in
 * the second step someone adds later.
 *
 * REQUIRED BEHAVIOUR THROUGHOUT: FAIL CLOSED. An uncertain outcome must never
 * cause an automatic blind resend.
 *
 * Every scenario here is offline. Nothing in this file, or in anything it
 * imports, can open a socket.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginSubmission,
  canOpenNextRound,
  confirmRound,
  IN_FLIGHT_ROUND_STATES,
  linesToSend,
  markDelivered,
  markUnresolved,
  openRound,
  rejectRound,
  RoundInvariantError,
  setRoundLines,
  type OrderRound,
  type RoundLine,
} from '../../orders/rounds/order-round.model';
import {
  UnresolvedChecksumProvider,
  WaiterPadChecksumUnavailableError,
} from './waiterpad-checksum';
import { assertNoTransportAvailable, WaiterPadTransportUnavailableError } from './waiterpad-gate';
import { serialiseOrderPacket } from './waiterpad-order-packet';
import { assertNoSuppliedPrice, WaiterPadPriceInvariantError } from './waiterpad-price';
import { parseWaiterPadResponse } from './waiterpad-response';
import {
  assertPersistedBeforeSend,
  decideFromNonResponse,
  decideFromResponse,
  reconcileRoundAgainstReadback,
  WaiterPadUnresolvedPolicyError,
} from './waiterpad-round-state';
import { parseTableStatusResponse } from './waiterpad-table-status';

const LINE: RoundLine = {
  lineId: 'l1',
  menuItemId: 'm-lemon-slice',
  quantity: 1,
  expectedUnitPriceCents: 150,
};

/** A session's first round, durably opened and frozen, ready to send. */
function submittingRound(sequenceLines: readonly RoundLine[] = [LINE]): OrderRound {
  const opened = openRound({
    rounds: [],
    sessionId: 'table-5-session',
    roundId: 'r1',
    idempotencyKey: 'idem-r1',
  });
  return beginSubmission(setRoundLines(opened, sequenceLines), new Date('2026-09-07T19:00:00Z'));
}

// ---------------------------------------------------------------------------
// A. intent persisted -> send begins -> connection disappears -> unknown
// ---------------------------------------------------------------------------

describe('A. the connection disappears mid-send', () => {
  it('the intent was durable before anything left the process', () => {
    const round = submittingRound();
    // The identity that a retry would present exists BEFORE the send, not
    // after it. This is the whole restart fix: a crash cannot lose the key.
    expect(round.idempotencyKey).toBe('idem-r1');
    expect(round.payloadFrozenAt).not.toBeNull();
    expect(() => assertPersistedBeforeSend(round)).not.toThrow();
  });

  it('refuses to let a packet leave before the payload is frozen', () => {
    const drafting = setRoundLines(
      openRound({ rounds: [], sessionId: 's', roundId: 'r1', idempotencyKey: 'k' }),
      [LINE],
    );
    expect(() => assertPersistedBeforeSend(drafting)).toThrow(/must be in 'submitting'/);
    // And the payload builder refuses too, independently.
    expect(() => linesToSend(drafting)).toThrow(RoundInvariantError);
  });

  it('a lost connection is unresolved, not failed and not rejected', () => {
    const decision = decideFromNonResponse({ kind: 'connection_lost' });
    expect(decision.transition.apply).toBe('markUnresolved');
    expect(decision.nativeEffect).toBe('unknown');
    expect(decision.safeToRepresentToOperator).toBe(false);
    expect(decision.reason).toContain('Do not resend');
  });

  it('leaves the round in a state with no automatic exit', () => {
    const round = markUnresolved(submittingRound());
    expect(round.state).toBe('unresolved');
    expect(IN_FLIGHT_ROUND_STATES.has(round.state)).toBe(true);
    // The only edges out require a caller to make a decision. None of them is
    // reachable by doing nothing.
    expect(() =>
      confirmRound(round, { tier: 'correlated', saleId: 'x', observedAt: new Date() }),
    ).toThrow(/only a causal identity may confirm/);
  });
});

// ---------------------------------------------------------------------------
// B. ACK received, but no native confirmation is available
// ---------------------------------------------------------------------------

describe('B. an ACK with no native confirmation behind it', () => {
  const ack = parseWaiterPadResponse(
    "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>",
  );

  it('parses, and maps only as far as awaiting_native_confirmation', () => {
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error('unreachable');
    const decision = decideFromResponse(ack.response);
    expect(decision.transition.to).toBe('awaiting_native_confirmation');
    expect(decision.nativeEffect).toBe('accepted_or_dropped_unexecuted');
  });

  it('the round reaches awaiting_native_confirmation and stops there', () => {
    const round = markDelivered(submittingRound());
    expect(round.state).toBe('awaiting_native_confirmation');
    expect(round.nativeSaleRef).toBeNull();
    // There is no causal identity to confirm with, because no WaiterPad
    // response carries one -- all six bodies are bare types.
    expect(() =>
      confirmRound(round, { tier: 'correlated', saleId: 'table-5', observedAt: new Date() }),
    ).toThrow(RoundInvariantError);
  });

  it('the ACK reason tells an operator the two things it might mean', () => {
    if (!ack.ok) throw new Error('unreachable');
    const reason = decideFromResponse(ack.response).reason;
    expect(reason).toContain('200-slot buffer was full');
    expect(reason).toContain('Read the table back');
  });

  /**
   * The structural reason no response can confirm: nothing in this module tree
   * constructs a native sale reference at all, so no code path here can hand
   * `confirmRound` the causal identity it demands.
   */
  it('no production module in this tree can mint a native sale reference', () => {
    const dir = __dirname;
    for (const file of [
      'waiterpad-response.ts',
      'waiterpad-round-state.ts',
      'waiterpad-table-status.ts',
      'waiterpad-fixtures.ts',
    ]) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toContain('confirmRound');
      expect(text).not.toContain("tier: 'causal'");
    }
  });
});

// ---------------------------------------------------------------------------
// C / D. crash after send, and restart holding an uncertain round
// ---------------------------------------------------------------------------

describe('C/D. crash after send, restart with an uncertain round', () => {
  it('a restart in flight is unresolved, and says the packet may or may not have landed', () => {
    const decision = decideFromNonResponse({ kind: 'process_restarted_in_flight' });
    expect(decision.transition.apply).toBe('markUnresolved');
    expect(decision.reason).toContain('may or may not have reached the till');
  });

  it('a recovered round never returns to drafting, so its lines cannot be edited', () => {
    const recovered = markUnresolved(submittingRound());
    // `submitting -> drafting` and `unresolved -> drafting` are both absent
    // from the transition table on purpose: returning to draft would let staff
    // edit a payload that may already be in a kitchen.
    expect(() => setRoundLines(recovered, [])).toThrow(/cannot edit lines of a round in state/);
  });

  it('the frozen payload survives the restart byte-for-byte', () => {
    const before = submittingRound();
    const after = markUnresolved(before);
    expect(after.lines).toEqual(before.lines);
    expect(after.payloadFrozenAt).toEqual(before.payloadFrozenAt);
    expect(after.idempotencyKey).toBe(before.idempotencyKey);
  });

  it('and a resend is impossible anyway: no checksum, no transport', () => {
    expect(() =>
      new UnresolvedChecksumProvider().generate({
        deviceId: 'verdura-1',
        roundIdempotencyKey: 'idem-r1',
        serialisedOrderPacket: '<WPPacket/>',
      }),
    ).toThrow(WaiterPadChecksumUnavailableError);
    expect(() => assertNoTransportAvailable()).toThrow(WaiterPadTransportUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// E. a duplicate or repeated response for the same round
// ---------------------------------------------------------------------------

describe('E. a second response arrives for a round that already moved', () => {
  it('the decision function is pure, so a repeated ACK decides identically', () => {
    const first = decideFromResponse({ type: 'ACK' });
    const second = decideFromResponse({ type: 'ACK' });
    expect(second).toEqual(first);
  });

  /**
   * The protection is in the model, not in the caller's discipline: once a
   * round is `awaiting_native_confirmation`, re-applying `markDelivered`
   * throws rather than silently re-entering the state. A late duplicate ACK
   * cannot restart a submission clock or look like fresh progress.
   */
  it('re-applying markDelivered to an already-delivered round is refused', () => {
    const delivered = markDelivered(submittingRound());
    expect(() => markDelivered(delivered)).toThrow(RoundInvariantError);
  });

  it('a DUPLICATE response is not success and does not resolve the round', () => {
    const decision = decideFromResponse({ type: 'DUPLICATE' });
    expect(decision.transition.to).toBe('unresolved');
    expect(decision.nativeEffect).toBe('unknown');
    expect(decision.safeToRepresentToOperator).toBe(false);
    expect(decision.reason).toContain('one deep');
  });

  it('a DUPLICATE after an ACK still cannot confirm the round', () => {
    const delivered = markDelivered(submittingRound());
    const decision = decideFromResponse({ type: 'DUPLICATE' });
    expect(decision.transition.apply).toBe('markUnresolved');
    const after = markUnresolved(delivered);
    expect(after.state).toBe('unresolved');
    expect(after.nativeSaleRef).toBeNull();
  });

  it('a LOCK arriving late cannot un-deliver a round that was already ACKed', () => {
    const delivered = markDelivered(submittingRound());
    // rejectRound IS legal from awaiting_native_confirmation, so the guard that
    // matters is the decision layer refusing to call a late LOCK proof of
    // non-acceptance for a round that already got an ACK. The model cannot know
    // that; the caller must not apply a decision derived from a stale reply.
    expect(delivered.state).toBe('awaiting_native_confirmation');
    const stale = decideFromResponse({ type: 'LOCK', lockCode: 12002, posNumber: 2 });
    expect(stale.nativeEffect).toBe('not_accepted');
    // Recorded here as a known sharp edge: `safeToRepresentToOperator` is true
    // for a LOCK, and that is only sound for the reply to the CURRENT attempt.
    // Correlating a reply to its request is the transport's job, and there is
    // no transport.
    expect(stale.safeToRepresentToOperator).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F / G. malformed XML, and a message that is not a response at all
// ---------------------------------------------------------------------------

describe('F/G. malformed and unexpected replies', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['not xml at all', 'HTTP/1.1 200 OK\r\n\r\n<html>'],
    ['truncated packet', "<?xml version='1.0' ?><WPPacket Type = 'AC"],
    ['unclosed root', "<?xml version='1.0' ?><WPPacket Type = 'ACK'>"],
    ['unknown type', "<?xml version='1.0' ?><WPPacket Type = 'OK'></WPPacket>"],
    ['no type attribute', "<?xml version='1.0' ?><WPPacket></WPPacket>"],
    ['wrong root', "<?xml version='1.0' ?><Response Type = 'ACK'></Response>"],
    ['a request echoed back', "<?xml version='1.0' ?><WPPacket><WPType>ORDER</WPType></WPPacket>"],
    ['empty', ''],
    ['whitespace only', '   \n\t '],
  ];

  it.each(cases)('%s -> parse fails and the round goes unresolved', (_label, body) => {
    const parse = parseWaiterPadResponse(body);
    expect(parse.ok).toBe(false);
    if (parse.ok) throw new Error('unreachable');
    const decision = decideFromNonResponse({ kind: 'unparseable', parse });
    expect(decision.transition.apply).toBe('markUnresolved');
    expect(decision.nativeEffect).toBe('unknown');
    expect(decision.requiresReadback).toBe(true);
    expect(decision.safeToRepresentToOperator).toBe(false);
  });

  it('the failure reason is carried into the operator message, not swallowed', () => {
    const parse = parseWaiterPadResponse("<?xml version='1.0' ?><WPPacket Type = 'OK'></WPPacket>");
    if (parse.ok) throw new Error('unreachable');
    expect(parse.reason).toBe('unknown_type');
    expect(decideFromNonResponse({ kind: 'unparseable', parse }).reason).toContain('unknown_type');
  });

  /**
   * Two traced paths in `wsWaiterPad_DataArrival` accept the connection and
   * answer nothing at all: `EXIT because NOT HandheldLicensed` (VA 0x0281577a)
   * and `EXIT because NoReceiving=TRUE` (VA 0x028157fa). Silence is therefore a
   * real protocol outcome and not only a network fault -- and it is
   * indistinguishable from a lost reply, which is exactly why both land in the
   * same place.
   */
  it('a silent, answerless till is indistinguishable from a lost reply', () => {
    const silence = decideFromNonResponse({ kind: 'timeout', waitedMs: 10_000 });
    const lost = decideFromNonResponse({ kind: 'connection_lost' });
    expect(silence.transition).toEqual(lost.transition);
    expect(silence.nativeEffect).toEqual(lost.nativeEffect);
    expect(silence.requiresReadback).toBe(true);
  });

  it('NAKREGO is unresolved: registration is capped by the handheld licence count', () => {
    const decision = decideFromResponse({ type: 'NAKREGO', body: '' });
    expect(decision.transition.to).toBe('unresolved');
    expect(decision.safeToRepresentToOperator).toBe(false);
  });

  it('NAK is never safe to re-present, even though one NAK condition is transient', () => {
    // WPParsePacket emits NAK when HandheldProcessing is already set -- a busy
    // till, not a rejected order. Other NAK sources are still untraced, so the
    // conservative reading stands and a NAK must not invite an automatic retry.
    const decision = decideFromResponse({ type: 'NAK' });
    expect(decision.safeToRepresentToOperator).toBe(false);
    expect(decision.requiresReadback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. the native table contradicts what the round expected
// ---------------------------------------------------------------------------

describe('H. a readback that contradicts the expected round', () => {
  // The root carries NO Type attribute. The readback response's ENVELOPE is
  // NOT SHOWN: IPS.exe's only `WPPacket Type = '...'` literals are the six
  // order-path bodies, and no 'TABLESTATUS' response type exists in the
  // binary at all. Only the per-row <OrderItem> field set is proven.
  const readback = (items: string): string =>
    `<?xml version='1.0' encoding='utf-8' ?>\n<WPPacket>\n  <Table>5</Table>\n${items}</WPPacket>\n`;

  const item = (index: number, stockItem: string, qty: string, price: string): string =>
    `  <OrderItem>\n    <Index>${index}</Index>\n    <StockItem>${stockItem}</StockItem>\n` +
    `    <Description>x</Description>\n    <Quantity>${qty}</Quantity>\n` +
    `    <Price>${price}</Price>\n    <SeatNumber>0</SeatNumber>\n    <PriceLevel>1</PriceLevel>\n  </OrderItem>\n`;

  const AT = new Date('2026-09-07T19:05:00Z');

  it('an empty table after an ACK is readable, and still resolves nothing automatically', () => {
    const parse = parseTableStatusResponse(readback(''), AT);
    expect(parse.ok).toBe(true);
    if (!parse.ok) throw new Error('unreachable');
    expect(parse.status.lines).toHaveLength(0);
    // Tempting reading: "no lines, so the round did not land, so resend."
    // Refused -- the drain that writes the rows is asynchronous, so an empty
    // readback taken too early looks identical to a dropped packet.
    expect(() => reconcileRoundAgainstReadback()).toThrow(WaiterPadUnresolvedPolicyError);
  });

  it('a table holding MORE than the round expected also resolves nothing', () => {
    const parse = parseTableStatusResponse(
      readback(item(1, '23', '1', '1.5000') + item(2, '23', '1', '1.5000')),
      AT,
    );
    if (!parse.ok) throw new Error('unreachable');
    expect(parse.status.lines).toHaveLength(2);
    expect(parse.status.roundIdentityAvailable).toBe(false);
    expect(() => reconcileRoundAgainstReadback()).toThrow(/ambiguous round is a human decision/);
  });

  it('names all three open questions rather than choosing one', () => {
    let message = '';
    try {
      reconcileRoundAgainstReadback();
    } catch (err) {
      message = (err as Error).message;
      expect((err as WaiterPadUnresolvedPolicyError).blockerId).toBe('WAITERPAD-RECON-001');
    }
    // Updated 2026-09-07: the routing question is ANSWERED, and the message
    // must say so rather than still listing it as open. What replaced it is
    // the causal-token gap, which is the reason a content match proves nothing.
    expect(message).toContain('routing question is now ANSWERED');
    expect(message).toContain('no durable causal token');
    expect(message).toContain('COMPLETE table state');
    expect(message).toContain('no OrderedTime');
  });

  it('a malformed line fails the whole readback rather than understating the table', () => {
    // Understating what is on a table is the direction that causes a duplicate
    // submission, so a line we cannot read must not be skipped.
    const parse = parseTableStatusResponse(
      readback(
        '  <OrderItem>\n    <Index>1</Index>\n    <StockItem>23</StockItem>\n  </OrderItem>\n',
      ),
      AT,
    );
    expect(parse.ok).toBe(false);
    if (parse.ok) throw new Error('unreachable');
    expect(parse.reason).toBe('malformed_line');
  });
});

// ---------------------------------------------------------------------------
// I. a later round exists while the previous outcome is still uncertain
// ---------------------------------------------------------------------------

describe('I. a second round while the first is unresolved', () => {
  it('a new round cannot be opened while one is unresolved', () => {
    const uncertain = markUnresolved(submittingRound());
    expect(canOpenNextRound([uncertain])).toBe(false);
    expect(() =>
      openRound({
        rounds: [uncertain],
        sessionId: 'table-5-session',
        roundId: 'r2',
        idempotencyKey: 'idem-r2',
      }),
    ).toThrow(/cannot open a new round while another round is drafting or unresolved/);
  });

  it('nor while one is merely awaiting native confirmation', () => {
    const delivered = markDelivered(submittingRound());
    expect(canOpenNextRound([delivered])).toBe(false);
  });

  it('a rejected round does not block the session, because it reopens as itself', () => {
    const rejected = rejectRound(submittingRound());
    expect(canOpenNextRound([rejected])).toBe(true);
    // And when it is repaired it keeps its identity, so the POS never sees a
    // second, differently-keyed round for the same food.
    expect(rejected.idempotencyKey).toBe('idem-r1');
    expect(rejected.sequence).toBe(1);
  });

  it('a second round, once legally opened, carries a different identity', () => {
    const first = rejectRound(submittingRound());
    const second = openRound({
      rounds: [first],
      sessionId: 'table-5-session',
      roundId: 'r2',
      idempotencyKey: 'idem-r2',
    });
    expect(second.sequence).toBe(2);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('reusing an idempotency key on the same session is refused', () => {
    const first = rejectRound(submittingRound());
    expect(() =>
      openRound({
        rounds: [first],
        sessionId: 'table-5-session',
        roundId: 'r2',
        idempotencyKey: 'idem-r1',
      }),
    ).toThrow(/already used by another round/);
  });

  it('a submission carries one round’s lines, never the session’s', () => {
    const first = rejectRound(submittingRound());
    const second = beginSubmission(
      setRoundLines(
        openRound({ rounds: [first], sessionId: 's', roundId: 'r2', idempotencyKey: 'idem-r2' }),
        [{ ...LINE, lineId: 'l2', menuItemId: 'm-bread' }],
      ),
      new Date('2026-09-07T19:30:00Z'),
    );
    const payload = linesToSend(second);
    expect(payload).toHaveLength(1);
    expect(payload[0].menuItemId).toBe('m-bread');
  });
});

// ---------------------------------------------------------------------------
// J. the price sentinel is never replaced by a Verdura figure
// ---------------------------------------------------------------------------

describe('J. -9999 is the only price that may ever go on the wire', () => {
  const packet = {
    table: 5,
    clerk: '1',
    guests: 0,
    deviceId: 'verdura-1',
    checksum: 'observed-value' as never,
    lines: [{ stockItem: '23', quantity: 1, description: 'Lemon slice', priceLevel: 1 }],
  };

  it('serialises the sentinel and nothing else', () => {
    const xml = serialiseOrderPacket(packet);
    const prices = xml.match(/<Price>([^<]*)<\/Price>/g) ?? [];
    expect(prices).toEqual(['<Price>-9999</Price>']);
  });

  it('is byte-identical on every serialisation of the same packet', () => {
    expect(serialiseOrderPacket(packet)).toBe(serialiseOrderPacket(packet));
  });

  /**
   * The dangerous case is untyped data crossing a boundary -- a DTO, a queue
   * message, JSON from the tablet -- where the structural guard cannot help.
   * A supplied price is refused loudly rather than dropped, because dropping it
   * would hide a caller who believed they were setting a price.
   */
  it.each([
    'price',
    'unitPriceCents',
    'expectedUnitPriceCents',
    'salePrice',
    'amount',
    'total',
    'lineTotal',
    'pricePaid',
  ])('refuses a line object carrying %s', (key) => {
    const line = { stockItem: '23', quantity: 1, description: 'x', priceLevel: 1, [key]: 999 };
    expect(() => assertNoSuppliedPrice(line, 'lines[0]')).toThrow(WaiterPadPriceInvariantError);
    // Serialisation refuses too, and refuses with the PRICE error rather than a
    // generic packet error -- the boundary guard runs first inside
    // validateOrderPacket, so the message names the offending key.
    expect(() => serialiseOrderPacket({ ...packet, lines: [line] })).toThrow(
      WaiterPadPriceInvariantError,
    );
  });

  it('still accepts priceLevel, which selects the native column and is required', () => {
    expect(() =>
      assertNoSuppliedPrice({ stockItem: '23', quantity: 1, description: 'x', priceLevel: 2 }),
    ).not.toThrow();
  });

  /**
   * The specific accident in the brief: a price learned from a readback being
   * fed back into the next packet. It cannot happen, because a readback price
   * is a `NativeResolvedPrice` object and `WaiterPadOrderLine` has nowhere to
   * put one -- and if it were spread onto a line, the boundary guard catches
   * the `price` key.
   */
  it('a price learned from a readback cannot be routed back into a packet', () => {
    const parsed = parseTableStatusResponse(
      "<?xml version='1.0' ?>\n<WPPacket>\n  <Table>5</Table>\n" +
        '  <OrderItem>\n    <Index>1</Index>\n    <StockItem>23</StockItem>\n' +
        '    <Description>Lemon slice</Description>\n    <Quantity>1</Quantity>\n' +
        '    <Price>1.5000</Price>\n    <SeatNumber>0</SeatNumber>\n    <PriceLevel>1</PriceLevel>\n' +
        '  </OrderItem>\n</WPPacket>\n',
      new Date('2026-09-07T19:05:00Z'),
    );
    if (!parsed.ok) throw new Error('unreachable');
    const learned = parsed.status.lines[0];
    expect(learned.price.resolvedFrom).toBe('readback');
    expect(learned.price.value).toBe(1.5);

    const contaminated = {
      stockItem: learned.stockItem,
      quantity: Number(learned.quantity),
      description: learned.description,
      priceLevel: Number(learned.priceLevel),
      price: learned.price.value,
    };
    expect(() => serialiseOrderPacket({ ...packet, lines: [contaminated] })).toThrow(
      /caller-supplied price/,
    );
  });

  it('an order with no lines is refused, because the receiver discards it silently', () => {
    expect(() => serialiseOrderPacket({ ...packet, lines: [] })).toThrow(
      /silently discards|at least one line/,
    );
  });

  it('an empty checksum is refused, because it disables the receiver’s guard', () => {
    expect(() => serialiseOrderPacket({ ...packet, checksum: '' as never })).toThrow(
      /skip its duplicate guard/,
    );
  });
});

// ---------------------------------------------------------------------------
// The standing conclusion
// ---------------------------------------------------------------------------

describe('the whole path is still incapable of duplicating food', () => {
  it('no sequence of decisions reaches a state that licenses an automatic resend', () => {
    const decisions = [
      decideFromResponse({ type: 'ACK' }),
      decideFromResponse({ type: 'NAK' }),
      decideFromResponse({ type: 'DUPLICATE' }),
      decideFromResponse({ type: 'NAKREGO', body: '' }),
      decideFromResponse({ type: 'NAKPRINT', body: '' }),
      decideFromNonResponse({ kind: 'timeout', waitedMs: 1 }),
      decideFromNonResponse({ kind: 'connection_lost' }),
      decideFromNonResponse({ kind: 'process_restarted_in_flight' }),
    ];
    // LOCK is the sole exception, and it is a HUMAN re-presentation, not a
    // retry: the lock check runs before the packet is buffered.
    for (const d of decisions) {
      expect(d.safeToRepresentToOperator).toBe(false);
    }
    expect(
      decideFromResponse({ type: 'LOCK', lockCode: 12001, posNumber: 1 }).safeToRepresentToOperator,
    ).toBe(true);
  });

  it('and could not resend if it wanted to: the transport does not exist', () => {
    expect(() => assertNoTransportAvailable()).toThrow(
      /No WaiterPad transport exists in this codebase, by design/,
    );
  });
});

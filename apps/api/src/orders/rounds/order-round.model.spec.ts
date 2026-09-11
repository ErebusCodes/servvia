import {
  beginSubmission,
  canOpenNextRound,
  confirmRound,
  failRound,
  IN_FLIGHT_ROUND_STATES,
  isLegalRoundTransition,
  linesToSend,
  markDelivered,
  markUnresolved,
  NativeSaleRef,
  nextRoundSequence,
  openRound,
  OrderRound,
  recordCorroboration,
  rejectRound,
  reopenRejectedRound,
  RoundInvariantError,
  RoundLine,
  RoundState,
  sentLines,
  setRoundLines,
  TERMINAL_ROUND_STATES,
} from './order-round.model';

const ALL_STATES: RoundState[] = [
  'drafting',
  'submitting',
  'awaiting_native_confirmation',
  'confirmed',
  'rejected',
  'failed',
  'unresolved',
  'abandoned',
];

const line = (over: Partial<RoundLine> = {}): RoundLine => ({
  lineId: 'l1',
  menuItemId: 'mi-1',
  quantity: 1,
  expectedUnitPriceCents: 1200,
  ...over,
});

const causal = (over: Partial<NativeSaleRef> = {}): NativeSaleRef => ({
  tier: 'causal',
  saleId: 'PS-4523',
  observedAt: new Date('2026-09-05T00:00:00Z'),
  ...over,
});

const correlated = (): NativeSaleRef => ({
  tier: 'correlated',
  saleId: 'PS-4523',
  observedAt: new Date('2026-09-05T00:00:00Z'),
});

/** A round opened and driven to `state`, for exhaustive transition testing. */
const at = (state: RoundState): OrderRound => ({
  roundId: 'r1',
  sessionId: 's1',
  sequence: 1,
  idempotencyKey: 'k1',
  state,
  lines: [line()],
  payloadFrozenAt: state === 'drafting' ? null : new Date('2026-09-05T00:00:00Z'),
  nativeSaleRef: null,
});

describe('round identity', () => {
  it('mints the idempotency key at OPEN, before any submission exists', () => {
    const r = openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' });

    expect(r.state).toBe('drafting');
    expect(r.idempotencyKey).toBe('k1');
    // The whole point: durable identity exists while the round is still empty.
    expect(r.lines).toEqual([]);
    expect(r.payloadFrozenAt).toBeNull();
  });

  it('numbers rounds 1,2,3 within a session', () => {
    const r1 = openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' });
    const done1 = confirmRound(
      markDelivered(beginSubmission(setRoundLines(r1, [line()]), new Date())),
      causal(),
    );
    const r2 = openRound({ rounds: [done1], sessionId: 's1', roundId: 'r2', idempotencyKey: 'k2' });

    expect(done1.sequence).toBe(1);
    expect(r2.sequence).toBe(2);
  });

  it('never reuses a sequence number after an abandoned round', () => {
    const abandoned: OrderRound = { ...at('abandoned'), sequence: 3 };
    expect(nextRoundSequence([abandoned])).toBe(4);
  });

  it('refuses a duplicate idempotency key within the session', () => {
    const done = { ...at('confirmed'), idempotencyKey: 'k1' };
    expect(() =>
      openRound({ rounds: [done], sessionId: 's1', roundId: 'r2', idempotencyKey: 'k1' }),
    ).toThrow(RoundInvariantError);
  });
});

describe('payload immutability', () => {
  it('lines are editable while drafting', () => {
    const r = openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' });
    expect(setRoundLines(r, [line(), line({ lineId: 'l2' })]).lines).toHaveLength(2);
  });

  it('freezes the payload on the drafting -> submitting edge', () => {
    const frozenAt = new Date('2026-09-05T01:02:03Z');
    const r = beginSubmission(
      setRoundLines(
        openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' }),
        [line()],
      ),
      frozenAt,
    );

    expect(r.state).toBe('submitting');
    expect(r.payloadFrozenAt).toEqual(frozenAt);
  });

  it.each(ALL_STATES.filter((s) => s !== 'drafting'))(
    'refuses to edit lines in state %s',
    (state) => {
      expect(() => setRoundLines(at(state), [line()])).toThrow(RoundInvariantError);
    },
  );

  it('refuses to submit an empty round', () => {
    const r = openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' });
    expect(() => beginSubmission(r, new Date())).toThrow(/no lines/);
  });
});

describe('confirmation is fail-closed', () => {
  it('a causal identity confirms', () => {
    const r = confirmRound(at('awaiting_native_confirmation'), causal());
    expect(r.state).toBe('confirmed');
    expect(r.nativeSaleRef?.tier).toBe('causal');
  });

  it('a CORRELATED identity never confirms, however matching', () => {
    expect(() => confirmRound(at('awaiting_native_confirmation'), correlated())).toThrow(
      /only a causal identity may confirm/,
    );
  });

  it('a correlated observation is recorded without advancing the lifecycle', () => {
    const r = recordCorroboration(at('awaiting_native_confirmation'), correlated());
    expect(r.state).toBe('awaiting_native_confirmation');
    expect(r.nativeSaleRef?.tier).toBe('correlated');
  });

  it('corroboration cannot touch a terminal round', () => {
    const confirmed = { ...at('confirmed'), nativeSaleRef: causal() };
    expect(recordCorroboration(confirmed, correlated())).toBe(confirmed);
  });

  it('property: no state other than awaiting_native_confirmation or unresolved reaches confirmed', () => {
    for (const state of ALL_STATES) {
      const reachable = isLegalRoundTransition(state, 'confirmed');
      expect(reachable).toBe(state === 'awaiting_native_confirmation' || state === 'unresolved');
    }
  });

  it('property: no causal-less path exists -- confirmRound is the sole writer of confirmed', () => {
    // Every other exported transition must refuse to produce `confirmed`.
    for (const state of ALL_STATES) {
      for (const fn of [markDelivered, rejectRound, failRound, markUnresolved]) {
        let out: OrderRound | null = null;
        try {
          out = fn(at(state));
        } catch {
          // Illegal transitions throw -- also fine.
        }
        if (out) expect(out.state).not.toBe('confirmed');
      }
    }
  });
});

describe('ambiguity is conservative', () => {
  it('an unknown-outcome send becomes unresolved, never drafting', () => {
    expect(markUnresolved(at('submitting')).state).toBe('unresolved');
    expect(isLegalRoundTransition('submitting', 'drafting')).toBe(false);
  });

  it('unresolved has no automatic exit -- every exit is a decided outcome', () => {
    const exits = ALL_STATES.filter((s) => isLegalRoundTransition('unresolved', s));
    expect(exits.sort()).toEqual(
      ['abandoned', 'awaiting_native_confirmation', 'confirmed', 'failed', 'rejected'].sort(),
    );
  });

  it('a new round may NOT be opened while one is unresolved', () => {
    expect(canOpenNextRound([at('unresolved')])).toBe(false);
    expect(() =>
      openRound({
        rounds: [at('unresolved')],
        sessionId: 's1',
        roundId: 'r2',
        idempotencyKey: 'k2',
      }),
    ).toThrow(/unresolved/);
  });

  it.each([...IN_FLIGHT_ROUND_STATES])('blocks opening a round while one is %s', (state) => {
    expect(canOpenNextRound([at(state)])).toBe(false);
  });

  it.each([...TERMINAL_ROUND_STATES])('allows opening a round once the previous is %s', (state) => {
    expect(canOpenNextRound([at(state)])).toBe(true);
  });

  it('a still-drafting round also blocks opening another', () => {
    expect(canOpenNextRound([at('drafting')])).toBe(false);
  });
});

describe('a rejected round returns to editable WITHOUT changing identity', () => {
  it('keeps roundId, sequence and idempotencyKey; clears the freeze', () => {
    const rejected: OrderRound = { ...at('rejected'), sequence: 2, idempotencyKey: 'k2' };
    const reopened = reopenRejectedRound(rejected);

    expect(reopened.state).toBe('drafting');
    expect(reopened.payloadFrozenAt).toBeNull();
    expect(reopened.roundId).toBe(rejected.roundId);
    expect(reopened.sequence).toBe(2);
    expect(reopened.idempotencyKey).toBe('k2');
  });

  it('the reopened round is editable again', () => {
    const reopened = reopenRejectedRound(at('rejected'));
    expect(setRoundLines(reopened, [line({ lineId: 'fixed' })]).lines[0].lineId).toBe('fixed');
  });

  it('resubmitting a reopened round presents the SAME key -- no second native round', () => {
    const reopened = reopenRejectedRound(at('rejected'));
    const resubmitted = beginSubmission(setRoundLines(reopened, [line()]), new Date());
    expect(resubmitted.idempotencyKey).toBe('k1');
  });

  it('a FAILED round is terminal and cannot be reopened', () => {
    expect(() => reopenRejectedRound(at('failed'))).toThrow(RoundInvariantError);
  });
});

describe('prior rounds are never re-sent', () => {
  it('a payload is built from ONE round, not the session', () => {
    const r2 = beginSubmission(
      setRoundLines(
        openRound({
          rounds: [at('confirmed')],
          sessionId: 's1',
          roundId: 'r2',
          idempotencyKey: 'k2',
        }),
        [line({ lineId: 'round2-line' })],
      ),
      new Date(),
    );

    const payload = linesToSend(r2);
    expect(payload.map((l) => l.lineId)).toEqual(['round2-line']);
  });

  it.each(ALL_STATES.filter((s) => s !== 'submitting'))(
    'refuses to build a payload for a round in state %s',
    (state) => {
      expect(() => linesToSend(at(state))).toThrow(RoundInvariantError);
    },
  );

  it('sentLines reports everything already with the kitchen, and nothing still drafting', () => {
    const confirmed: OrderRound = { ...at('confirmed'), lines: [line({ lineId: 'a' })] };
    const awaiting: OrderRound = {
      ...at('awaiting_native_confirmation'),
      lines: [line({ lineId: 'b' })],
    };
    const drafting: OrderRound = { ...at('drafting'), lines: [line({ lineId: 'c' })] };
    const abandoned: OrderRound = { ...at('abandoned'), lines: [line({ lineId: 'd' })] };

    expect(sentLines([confirmed, awaiting, drafting, abandoned]).map((l) => l.lineId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('an unresolved round counts as SENT -- the kitchen may already have it', () => {
    const unresolved: OrderRound = { ...at('unresolved'), lines: [line({ lineId: 'x' })] };
    expect(sentLines([unresolved]).map((l) => l.lineId)).toEqual(['x']);
  });
});

describe('the full two-round arc the product requires', () => {
  it('session -> round 1 -> confirm -> round 2 -> confirm', () => {
    let rounds: OrderRound[] = [];

    const r1open = openRound({ rounds, sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' });
    const r1drafted = setRoundLines(r1open, [line({ lineId: 'a1' })]);
    const r1sub = beginSubmission(r1drafted, new Date('2026-09-05T00:00:00Z'));
    expect(linesToSend(r1sub).map((l) => l.lineId)).toEqual(['a1']);
    const r1done = confirmRound(markDelivered(r1sub), causal({ saleId: 'PS-1' }));
    rounds = [r1done];

    // Round 2 may only open now that round 1 is terminal.
    expect(canOpenNextRound(rounds)).toBe(true);
    const r2open = openRound({ rounds, sessionId: 's1', roundId: 'r2', idempotencyKey: 'k2' });
    const r2sub = beginSubmission(setRoundLines(r2open, [line({ lineId: 'b1' })]), new Date());
    // Round 2's payload carries ONLY round 2's line.
    expect(linesToSend(r2sub).map((l) => l.lineId)).toEqual(['b1']);
    const r2done = confirmRound(markDelivered(r2sub), causal({ saleId: 'PS-1' }));
    rounds = [r1done, r2done];

    expect(rounds.map((r) => r.sequence)).toEqual([1, 2]);
    expect(sentLines(rounds).map((l) => l.lineId)).toEqual(['a1', 'b1']);
    // One session, one native sale -- not two unrelated customer orders.
    expect(new Set(rounds.map((r) => r.nativeSaleRef?.saleId))).toEqual(new Set(['PS-1']));
  });

  it('an ambiguous round 1 blocks round 2 until a human resolves it', () => {
    const r1 = markUnresolved(
      beginSubmission(
        setRoundLines(
          openRound({ rounds: [], sessionId: 's1', roundId: 'r1', idempotencyKey: 'k1' }),
          [line()],
        ),
        new Date(),
      ),
    );

    expect(() =>
      openRound({ rounds: [r1], sessionId: 's1', roundId: 'r2', idempotencyKey: 'k2' }),
    ).toThrow(RoundInvariantError);

    // The human checked the kitchen: it did arrive, but with no causal id.
    const resolved = markDelivered(r1);
    expect(resolved.state).toBe('awaiting_native_confirmation');
    // Still blocked -- awaiting is in-flight, not terminal.
    expect(canOpenNextRound([resolved])).toBe(false);
  });
});

describe('the transition table itself', () => {
  it('terminal states have no outgoing edges', () => {
    for (const state of TERMINAL_ROUND_STATES) {
      for (const to of ALL_STATES) {
        expect(isLegalRoundTransition(state, to)).toBe(false);
      }
    }
  });

  it('no state transitions to itself', () => {
    for (const state of ALL_STATES) {
      expect(isLegalRoundTransition(state, state)).toBe(false);
    }
  });

  it('every non-terminal state can reach unresolved or abandoned -- nothing can wedge', () => {
    for (const state of ALL_STATES.filter((s) => !TERMINAL_ROUND_STATES.has(s))) {
      const canEscape =
        isLegalRoundTransition(state, 'unresolved') ||
        isLegalRoundTransition(state, 'abandoned') ||
        isLegalRoundTransition(state, 'failed');
      expect(canEscape).toBe(true);
    }
  });
});

/**
 * The safety-critical mapping: protocol outcome -> licensed round transition.
 *
 * The assertions that matter most are negative ones. No path may confirm a
 * round, no path may license a resend, and the reconciliation policy must stay
 * unimplemented while append-vs-relay semantics are open.
 */
import {
  isLegalRoundTransition,
  type OrderRound,
  type RoundState,
} from '../../orders/rounds/order-round.model';
import { parseWaiterPadResponse } from './waiterpad-response';
import {
  assertPersistedBeforeSend,
  decideFromNonResponse,
  decideFromResponse,
  reconcileRoundAgainstReadback,
  UNRESOLVED_PRODUCTION_BLOCKERS,
  WaiterPadRoundStateError,
  WaiterPadUnresolvedPolicyError,
  type NonResponseOutcome,
  type WaiterPadOutcomeDecision,
} from './waiterpad-round-state';

const round = (over: Partial<OrderRound> = {}): OrderRound => ({
  roundId: 'r1',
  sessionId: 's1',
  sequence: 1,
  idempotencyKey: 'idem-1',
  state: 'submitting',
  lines: [
    {
      lineId: 'l1',
      menuItemId: 'm1',
      quantity: 1,
      expectedUnitPriceCents: 150,
    },
  ],
  payloadFrozenAt: new Date('2026-09-07T00:00:00Z'),
  nativeSaleRef: null,
  ...over,
});

const ALL_DECISIONS = (): WaiterPadOutcomeDecision[] => [
  decideFromResponse({ type: 'ACK' }),
  decideFromResponse({ type: 'NAK' }),
  decideFromResponse({ type: 'DUPLICATE' }),
  decideFromResponse({ type: 'NAKREGO', body: '' }),
  decideFromResponse({ type: 'NAKPRINT', body: '' }),
  decideFromResponse({ type: 'LOCK', lockCode: 12002, posNumber: 2 }),
  decideFromNonResponse({ kind: 'timeout', waitedMs: 5000 }),
  decideFromNonResponse({ kind: 'connection_lost' }),
  decideFromNonResponse({ kind: 'process_restarted_in_flight' }),
];

describe('the persist-before-send boundary', () => {
  it('accepts a round that was durably opened and frozen', () => {
    expect(() => assertPersistedBeforeSend(round())).not.toThrow();
  });

  it('refuses a round that is still drafting', () => {
    expect(() => assertPersistedBeforeSend(round({ state: 'drafting' }))).toThrow(
      WaiterPadRoundStateError,
    );
  });

  it('refuses a round whose payload was never frozen', () => {
    expect(() => assertPersistedBeforeSend(round({ payloadFrozenAt: null }))).toThrow(
      /payloadFrozenAt is null/,
    );
  });

  it('refuses a round with no durable idempotency key', () => {
    expect(() => assertPersistedBeforeSend(round({ idempotencyKey: '' }))).toThrow(
      /idempotency key/,
    );
  });

  it('refuses an empty round', () => {
    expect(() => assertPersistedBeforeSend(round({ lines: [] }))).toThrow(/no lines/);
  });

  it.each<RoundState>(['awaiting_native_confirmation', 'unresolved', 'confirmed', 'rejected'])(
    'refuses to send from state %s',
    (state) => {
      expect(() => assertPersistedBeforeSend(round({ state }))).toThrow(WaiterPadRoundStateError);
    },
  );
});

describe('ACK means submitted, never executed', () => {
  const decision = decideFromResponse({ type: 'ACK' });

  it('licenses only markDelivered -> awaiting_native_confirmation', () => {
    expect(decision.transition).toEqual({
      apply: 'markDelivered',
      to: 'awaiting_native_confirmation',
    });
  });

  it('never reaches confirmed', () => {
    expect(decision.transition.to).not.toBe('confirmed');
  });

  it('records the effect as accepted-or-dropped, not executed', () => {
    expect(decision.nativeEffect).toBe('accepted_or_dropped_unexecuted');
  });

  it('demands a readback before the round may be treated as settled', () => {
    expect(decision.requiresReadback).toBe(true);
  });

  it('explains the buffer-exhaustion hazard to the operator', () => {
    expect(decision.reason).toMatch(/buffer was full|silently dropped/i);
  });

  it('is a legal edge in the existing round model', () => {
    expect(isLegalRoundTransition('submitting', decision.transition.to)).toBe(true);
  });
});

describe('DUPLICATE is not success', () => {
  const decision = decideFromResponse({ type: 'DUPLICATE' });

  it('goes to unresolved, not confirmed and not rejected', () => {
    expect(decision.transition).toEqual({ apply: 'markUnresolved', to: 'unresolved' });
  });

  it('requires a readback before anything is concluded', () => {
    expect(decision.requiresReadback).toBe(true);
  });

  it('does not present the round as safe to resend', () => {
    expect(decision.safeToRepresentToOperator).toBe(false);
  });

  it('says why one-deep matching is not confirmation', () => {
    expect(decision.reason).toMatch(/one deep/i);
  });
});

describe('LOCK is the one outcome with positive non-acceptance evidence', () => {
  const decision = decideFromResponse({ type: 'LOCK', lockCode: 12002, posNumber: 2 });

  it('records not_accepted', () => {
    expect(decision.nativeEffect).toBe('not_accepted');
  });

  it('needs no readback', () => {
    expect(decision.requiresReadback).toBe(false);
  });

  it('may be presented to an operator, and names the holding terminal', () => {
    expect(decision.safeToRepresentToOperator).toBe(true);
    expect(decision.reason).toContain('POS 2');
  });

  it('goes to rejected, which the model allows to reopen as a draft', () => {
    expect(decision.transition.to).toBe('rejected');
    expect(isLegalRoundTransition('rejected', 'drafting')).toBe(true);
  });
});

describe('NAK, NAKREGO and NAKPRINT', () => {
  it('NAK rejects but still demands a readback, because its conditions are untraced', () => {
    const d = decideFromResponse({ type: 'NAK' });
    expect(d.transition.to).toBe('rejected');
    expect(d.nativeEffect).toBe('unknown');
    expect(d.requiresReadback).toBe(true);
    expect(d.safeToRepresentToOperator).toBe(false);
  });

  it('NAKREGO is unresolved, not a clean rejection', () => {
    const d = decideFromResponse({ type: 'NAKREGO', body: '' });
    expect(d.transition.to).toBe('unresolved');
    expect(d.reason).toMatch(/not traced/i);
  });

  it('NAKPRINT on an order is treated as unexpected, not as a print problem', () => {
    const d = decideFromResponse({ type: 'NAKPRINT', body: '' });
    expect(d.transition.to).toBe('unresolved');
    expect(d.reason).toMatch(/unreachable here/i);
  });
});

describe('crash, timeout and restart never imply a resend', () => {
  const outcomes: NonResponseOutcome[] = [
    { kind: 'timeout', waitedMs: 5000 },
    { kind: 'connection_lost' },
    { kind: 'process_restarted_in_flight' },
    {
      kind: 'unparseable',
      parse: parseWaiterPadResponse('garbage') as Extract<
        ReturnType<typeof parseWaiterPadResponse>,
        { ok: false }
      >,
    },
  ];

  it.each(outcomes.map((o) => [o.kind, o] as const))('%s -> unresolved', (_kind, outcome) => {
    const d = decideFromNonResponse(outcome);
    expect(d.transition).toEqual({ apply: 'markUnresolved', to: 'unresolved' });
    expect(d.nativeEffect).toBe('unknown');
    expect(d.requiresReadback).toBe(true);
    expect(d.safeToRepresentToOperator).toBe(false);
    expect(d.reason).toMatch(/Do not resend/);
  });

  it('a restart mid-flight is not treated as a fresh draft', () => {
    const d = decideFromNonResponse({ kind: 'process_restarted_in_flight' });
    expect(d.transition.to).not.toBe('drafting');
    expect(isLegalRoundTransition('submitting', 'drafting')).toBe(false);
  });

  it('unresolved has no automatic exit in the underlying model', () => {
    expect(isLegalRoundTransition('unresolved', 'confirmed')).toBe(true);
    // ...but only via an explicit caller decision; the point is that nothing in
    // this module ever licenses that edge.
    const licensed = ALL_DECISIONS().map((d) => d.transition.to);
    expect(licensed).not.toContain('confirmed');
  });
});

describe('global invariants across every outcome', () => {
  it('no outcome ever licenses confirmed or failed', () => {
    for (const d of ALL_DECISIONS()) {
      expect(['awaiting_native_confirmation', 'rejected', 'unresolved']).toContain(d.transition.to);
    }
  });

  it('only LOCK is ever safe to present back to an operator', () => {
    const safe = ALL_DECISIONS().filter((d) => d.safeToRepresentToOperator);
    expect(safe).toHaveLength(1);
    expect(safe[0].nativeEffect).toBe('not_accepted');
  });

  it('every outcome that is not proven non-accepted requires a readback', () => {
    for (const d of ALL_DECISIONS()) {
      if (d.nativeEffect !== 'not_accepted') {
        expect(d.requiresReadback).toBe(true);
      }
    }
  });

  it('no outcome claims native execution', () => {
    for (const d of ALL_DECISIONS()) {
      expect(d.nativeEffect).not.toBe('executed');
    }
  });

  it('every licensed transition is legal from submitting in the real model', () => {
    for (const d of ALL_DECISIONS()) {
      expect(isLegalRoundTransition('submitting', d.transition.to)).toBe(true);
    }
  });

  it('every decision carries an operator-readable reason', () => {
    for (const d of ALL_DECISIONS()) {
      expect(d.reason.length).toBeGreaterThan(40);
    }
  });
});

describe('reconciliation policy is deliberately unimplemented', () => {
  it('throws rather than guessing', () => {
    expect(() => reconcileRoundAgainstReadback()).toThrow(WaiterPadUnresolvedPolicyError);
  });

  it('names the blocker and all three reasons', () => {
    try {
      reconcileRoundAgainstReadback();
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WaiterPadUnresolvedPolicyError);
      const e = err as WaiterPadUnresolvedPolicyError;
      expect(e.blockerId).toBe('WAITERPAD-RECON-001');
      expect(e.message).toMatch(/no durable causal token/);
      expect(e.message).toMatch(/COMPLETE table state/);
      expect(e.message).toMatch(/OrderedTime/);
    }
  });
});

describe('the production blocker register', () => {
  it('lists every blocker that must be closed before certification', () => {
    expect(UNRESOLVED_PRODUCTION_BLOCKERS.map((b) => b.id).sort()).toEqual([
      'WAITERPAD-ACKLOSS-001',
      'WAITERPAD-BIND-001',
      'WAITERPAD-CHECKSUM-001',
      'WAITERPAD-DUPGATE-001',
      'WAITERPAD-RECON-001',
      'WAITERPAD-REGO-001',
      'WAITERPAD-SUPPORT-001',
    ]);
  });

  it('gives every blocker a reason', () => {
    for (const b of UNRESOLVED_PRODUCTION_BLOCKERS) {
      expect(b.why.length).toBeGreaterThan(20);
    }
  });
});

/**
 * THE PREDICATE THAT DECIDES WHETHER FOOD IS ON A CUSTOMER'S BILL.
 *
 * Two properties are asserted here more insistently than anything else, because
 * they are the two that can hurt a real table:
 *
 *   1. TOKEN EQUALITY ALONE NEVER CONFIRMS. The till writes our token BEFORE it
 *      writes a single sale line, so a stored token proves receipt and not
 *      application. Every test that reaches `confirmedCausalDurable` is
 *      accompanied by one that removes the durable half and asserts it does not.
 *
 *   2. CONTENT AGREEMENT ALONE NEVER CONFIRMS. A waiter keying the same items
 *      on the terminal produces a byte-identical delta. Every content-matching
 *      test is accompanied by one that removes the token and asserts it does not
 *      confirm.
 *
 * The suite is arranged so that removing either check from the implementation
 * fails tests. That is checked explicitly at the bottom, in MUTATION SENTINELS.
 */

import {
  evaluateStrongNativeEvidence,
  mayConfirm,
  mayReleaseLines,
  type EvidenceSubject,
  type NativeTableSnapshot,
  type StrongNativeEvidence,
} from './waiterpad-native-evidence';

const TOKEN = 'a'.repeat(32);
const OTHER_TOKEN = 'b'.repeat(32);

const SUBJECT: EvidenceSubject = {
  roundId: 'round-1',
  attemptId: 'attempt-1',
  table: '5',
  token: TOKEN,
};

/** A native table read that resolved, with the given lines. */
function observed(
  lines: readonly { code: string; qty: number }[],
  overrides: Partial<NativeTableSnapshot> = {},
): NativeTableSnapshot {
  return {
    status: 'observed',
    tableCode: '5',
    pos: 1,
    map: '1',
    lines: lines.map((l) => ({ nativeCode: l.code, quantity: l.qty })),
    ...overrides,
  };
}

const FREE_TABLE: NativeTableSnapshot = { status: 'noOpenSale', reason: 'table is free' };

function evaluate(evidence: StrongNativeEvidence, subject: EvidenceSubject = SUBJECT) {
  return evaluateStrongNativeEvidence(subject, evidence);
}

describe('the causal half — the till holding our token', () => {
  it('confirms when the token matches AND the table gained exactly this round', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
    expect(v.causal).toBe(true);
    expect(v.durable).toBe(true);
    expect(mayConfirm(v)).toBe(true);
  });

  it('REFUSES to confirm on token equality alone, with no readback at all', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(v.causal).toBe(true);
    expect(v.durable).toBe(false);
    expect(mayConfirm(v)).toBe(false);
  });

  it('REFUSES to confirm when the lines match but the token does not', () => {
    const v = evaluate({
      storedTokenForDevice: OTHER_TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).not.toBe('confirmedCausalDurable');
    expect(v.causal).toBe(false);
    expect(mayConfirm(v)).toBe(false);
  });

  it('REFUSES to confirm when the lines match and the token was never read', () => {
    const v = evaluate({
      storedTokenForDevice: undefined,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('unavailable');
    expect(mayConfirm(v)).toBe(false);
    expect(mayReleaseLines(v)).toBe(false);
  });

  it('treats an absent token row with no processing as positive proof it did not land', () => {
    const v = evaluate({
      storedTokenForDevice: null,
      processedForTableAfterSend: false,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('notProven');
    expect(mayReleaseLines(v)).toBe(true);
  });

  it('does NOT treat an absent token row as proof when processing is unknown', () => {
    const v = evaluate({
      storedTokenForDevice: null,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(mayReleaseLines(v)).toBe(false);
  });

  it('does NOT treat a different token as proof when processing is unknown — the row is one-deep', () => {
    const v = evaluate({
      storedTokenForDevice: OTHER_TOKEN,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(mayReleaseLines(v)).toBe(false);
  });

  it('treats a different token AND nothing processed as proof it did not land', () => {
    const v = evaluate({
      storedTokenForDevice: OTHER_TOKEN,
      processedForTableAfterSend: false,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('notProven');
    expect(mayReleaseLines(v)).toBe(true);
  });
});

describe('the durable half — the delta against a pre-send baseline', () => {
  it('will not confirm without a pre-send baseline, however well the content agrees', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: undefined,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(v.durable).toBe(false);
    expect(v.basis).toMatch(/no pre-send baseline/i);
  });

  it('refuses when the sale is not durable yet — the expected line has not appeared', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(mayConfirm(v)).toBe(false);
  });

  it('flags the crash window: token written, pending sale deleted, no sale at all', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU9', qty: 1 }]),
      currentTable: FREE_TABLE,
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(v.basis).toMatch(/may have LOST an earlier order/i);
  });

  it('refuses when the table read back is a different table', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }], { tableCode: '15' }),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(mayConfirm(v)).toBe(false);
  });

  it('does not let table 5 confirm against table 50 by prefix', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }], { tableCode: '50' }),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
  });

  it('refuses when the map partition changed — a web ticket must not confirm a dine-in round', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([], { map: '1' }),
      currentTable: observed([{ code: 'PLU1', qty: 1 }], { map: '0' }),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(v.basis).toMatch(/map/i);
  });

  it('refuses when the POS context changed across the round', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([], { pos: 1 }),
      currentTable: observed([{ code: 'PLU1', qty: 1 }], { pos: 2 }),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
  });

  it('refuses when a prior line was voided underneath us', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([
        { code: 'PLU9', qty: 2 },
        { code: 'PLU8', qty: 1 },
      ]),
      currentTable: observed([
        { code: 'PLU9', qty: 1 },
        { code: 'PLU8', qty: 1 },
        { code: 'PLU1', qty: 1 },
      ]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(v.basis).toMatch(/dropped from 2 to 1/);
  });

  it('refuses when somebody else added an unrelated line in the window', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([
        { code: 'PLU1', qty: 1 },
        { code: 'PLU7', qty: 1 },
      ]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(v.basis).toMatch(/PLU7/);
  });

  it('refuses when our own item appeared twice — a duplicate', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 2 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('conflicting');
    expect(v.basis).toMatch(/duplicate|beyond our round/i);
  });

  it('refuses a round that declares no native items at all', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [],
    });

    expect(v.outcome).toBe('conflicting');
    expect(mayConfirm(v)).toBe(false);
  });
});

describe('the coincidence cases — the whole reason content cannot confirm', () => {
  it('does NOT mistake a pre-existing identical PLU for this round', () => {
    // The table already had one PLU1 before we sent. Nothing new appeared.
    // A count-based check ("1 line present >= 1 line expected") would confirm.
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU1', qty: 1 }]),
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('pending');
    expect(mayConfirm(v)).toBe(false);
  });

  it('confirms qty 1 then qty 1 of the same PLU as a genuine second occurrence', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU1', qty: 1 }]),
      currentTable: observed([{ code: 'PLU1', qty: 2 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it('distinguishes a qty-2 round from two earlier qty-1 lines', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU1', qty: 2 }]),
      currentTable: observed([{ code: 'PLU1', qty: 4 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 2 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it('refuses a qty-2 round when only one of the two appeared', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU1', qty: 2 }]),
      currentTable: observed([{ code: 'PLU1', qty: 3 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 2 }],
    });

    expect(v.outcome).toBe('pending');
  });

  it('treats a stale baseline from a PRIOR round as the baseline it is', () => {
    // Round 2's baseline legitimately contains round 1's lines. The delta is
    // round 2's items only, and round 1's A must not be counted again.
    const v = evaluate(
      {
        storedTokenForDevice: TOKEN,
        preSendTable: observed([
          { code: 'A', qty: 1 },
          { code: 'B', qty: 1 },
        ]),
        currentTable: observed([
          { code: 'A', qty: 1 },
          { code: 'B', qty: 1 },
          { code: 'C', qty: 1 },
        ]),
        expectedItems: [{ nativeCode: 'C', quantity: 1 }],
      },
      { ...SUBJECT, roundId: 'round-2', attemptId: 'attempt-2' },
    );

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it("confirms round 3 re-ordering round 1's item as a NEW occurrence", () => {
    const v = evaluate(
      {
        storedTokenForDevice: TOKEN,
        preSendTable: observed([
          { code: 'A', qty: 1 },
          { code: 'B', qty: 1 },
          { code: 'C', qty: 1 },
        ]),
        currentTable: observed([
          { code: 'A', qty: 2 },
          { code: 'B', qty: 1 },
          { code: 'C', qty: 1 },
        ]),
        expectedItems: [{ nativeCode: 'A', quantity: 1 }],
      },
      { ...SUBJECT, roundId: 'round-3', attemptId: 'attempt-3' },
    );

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it("refuses round 3 when round 1's A is present but no NEW A appeared", () => {
    const v = evaluate(
      {
        storedTokenForDevice: TOKEN,
        preSendTable: observed([{ code: 'A', qty: 1 }]),
        currentTable: observed([{ code: 'A', qty: 1 }]),
        expectedItems: [{ nativeCode: 'A', quantity: 1 }],
      },
      { ...SUBJECT, roundId: 'round-3', attemptId: 'attempt-3' },
    );

    expect(v.outcome).toBe('pending');
  });
});

describe('unavailable sources say nothing, in either direction', () => {
  it.each(['unavailable', 'ambiguous'] as const)(
    'a %s CURRENT read never confirms and never releases lines',
    (status) => {
      const v = evaluate({
        storedTokenForDevice: TOKEN,
        preSendTable: FREE_TABLE,
        currentTable: { status, reason: `read was ${status}` },
        expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
      });

      expect(v.outcome).toBe('unavailable');
      expect(mayConfirm(v)).toBe(false);
      expect(mayReleaseLines(v)).toBe(false);
    },
  );

  it.each(['unavailable', 'ambiguous'] as const)(
    'a %s BASELINE never confirms and never releases lines',
    (status) => {
      const v = evaluate({
        storedTokenForDevice: TOKEN,
        preSendTable: { status, reason: `baseline was ${status}` },
        currentTable: observed([{ code: 'PLU1', qty: 1 }]),
        expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
      });

      expect(v.outcome).toBe('unavailable');
      expect(mayConfirm(v)).toBe(false);
      expect(mayReleaseLines(v)).toBe(false);
    },
  );

  it('an entirely empty evidence bag is unavailable, never notProven', () => {
    const v = evaluate({});
    expect(v.outcome).toBe('unavailable');
    expect(mayReleaseLines(v)).toBe(false);
  });

  it('a missing attempt token is unavailable rather than a match against undefined', () => {
    const v = evaluate(
      {
        storedTokenForDevice: undefined,
        preSendTable: FREE_TABLE,
        currentTable: observed([{ code: 'PLU1', qty: 1 }]),
        expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
      },
      { ...SUBJECT, token: undefined },
    );

    expect(v.outcome).toBe('unavailable');
    expect(mayConfirm(v)).toBe(false);
  });
});

describe('canonicalisation', () => {
  it('matches native codes case-insensitively and ignores padding', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: '  plu1  ', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it('sums split rows of the same code — qty 2 arrives as two qty-1 rows', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([
        { code: 'PLU1', qty: 1 },
        { code: 'PLU1', qty: 1 },
      ]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 2 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
  });

  it('matches a trimmed table code against a padded native one', () => {
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }], { tableCode: ' 5 ' }),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(v.outcome).toBe('confirmedCausalDurable');
  });
});

/**
 * MUTATION SENTINELS.
 *
 * The directive is explicit: if removing token matching does not fail a test,
 * the tests are insufficient; likewise for the durable match. These two cases
 * are the ones that would still pass under those mutations if the rest of the
 * suite were the only thing standing, so they are stated as their own claims
 * rather than left implied.
 */
describe('MUTATION SENTINELS', () => {
  /** Identical in every respect EXCEPT the token. Only the causal check separates them. */
  it('two evidence bags differing only in the token must reach different outcomes', () => {
    const shared = {
      preSendTable: FREE_TABLE,
      currentTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    } satisfies Omit<StrongNativeEvidence, 'storedTokenForDevice'>;

    const withOurToken = evaluate({ ...shared, storedTokenForDevice: TOKEN });
    const withTheirs = evaluate({ ...shared, storedTokenForDevice: OTHER_TOKEN });

    expect(withOurToken.outcome).toBe('confirmedCausalDurable');
    expect(withTheirs.outcome).not.toBe('confirmedCausalDurable');
    // Deleting the token comparison would collapse these two into one answer.
    expect(withOurToken.outcome).not.toBe(withTheirs.outcome);
  });

  /** Identical in every respect EXCEPT the delta. Only the durable check separates them. */
  it('two evidence bags differing only in the native delta must reach different outcomes', () => {
    const shared = {
      storedTokenForDevice: TOKEN,
      preSendTable: observed([{ code: 'PLU1', qty: 1 }]),
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    } satisfies Omit<StrongNativeEvidence, 'currentTable'>;

    const lineAppeared = evaluate({
      ...shared,
      currentTable: observed([{ code: 'PLU1', qty: 2 }]),
    });
    const lineDidNot = evaluate({ ...shared, currentTable: observed([{ code: 'PLU1', qty: 1 }]) });

    expect(lineAppeared.outcome).toBe('confirmedCausalDurable');
    expect(lineDidNot.outcome).not.toBe('confirmedCausalDurable');
    // Deleting the delta comparison — or reverting it to `observed >= expected`
    // — would make both of these confirm.
    expect(lineAppeared.outcome).not.toBe(lineDidNot.outcome);
  });

  it('the old count-based rule would have confirmed a round that never landed', () => {
    // Five lines on the tab, two expected. `observed >= expected` is true.
    // The delta is zero, and the honest answer is that nothing arrived.
    const v = evaluate({
      storedTokenForDevice: TOKEN,
      preSendTable: observed([
        { code: 'X1', qty: 1 },
        { code: 'X2', qty: 1 },
        { code: 'X3', qty: 1 },
        { code: 'X4', qty: 1 },
        { code: 'X5', qty: 1 },
      ]),
      currentTable: observed([
        { code: 'X1', qty: 1 },
        { code: 'X2', qty: 1 },
        { code: 'X3', qty: 1 },
        { code: 'X4', qty: 1 },
        { code: 'X5', qty: 1 },
      ]),
      expectedItems: [
        { nativeCode: 'A', quantity: 1 },
        { nativeCode: 'B', quantity: 1 },
      ],
    });

    expect(v.outcome).toBe('pending');
    expect(mayConfirm(v)).toBe(false);
  });

  it('mayConfirm is false for every outcome except confirmedCausalDurable', () => {
    const outcomes = [
      evaluate({}),
      evaluate({ storedTokenForDevice: null, processedForTableAfterSend: false }),
      evaluate({ storedTokenForDevice: TOKEN, expectedItems: [{ nativeCode: 'A', quantity: 1 }] }),
      evaluate({
        storedTokenForDevice: TOKEN,
        preSendTable: FREE_TABLE,
        currentTable: FREE_TABLE,
        expectedItems: [{ nativeCode: 'A', quantity: 1 }],
      }),
    ];

    for (const v of outcomes) {
      expect(v.outcome).not.toBe('confirmedCausalDurable');
      expect(mayConfirm(v)).toBe(false);
    }
  });

  it('mayConfirm demands both flags, not just the outcome label', () => {
    // A hand-built verdict that claims the outcome but not the working. The
    // guard exists so a future edit cannot reach `confirmed` by setting a
    // string without satisfying either half.
    expect(
      mayConfirm({
        outcome: 'confirmedCausalDurable',
        basis: 'hand-built',
        causal: true,
        durable: false,
      }),
    ).toBe(false);
    expect(
      mayConfirm({
        outcome: 'confirmedCausalDurable',
        basis: 'hand-built',
        causal: false,
        durable: true,
      }),
    ).toBe(false);
  });
});

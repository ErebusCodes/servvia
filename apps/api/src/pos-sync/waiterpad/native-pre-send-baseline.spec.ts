/**
 * WHICH OBSERVATIONS MAY STAND AS A BASELINE.
 *
 * This rule decides what the confirmation delta subtracts against, so it has
 * exactly two ways to be wrong, and they are not symmetric:
 *
 *   TOO STRICT  costs confirmations. Every refused baseline is a round that
 *               goes to a human instead of going green. Annoying, never unsafe.
 *
 *   TOO LOOSE   would let an observation that no longer describes the table
 *               stand as the "before" of a subtraction. Even that fails closed
 *               downstream — a wrong baseline produces unexplained growth or
 *               missing prior lines, both of which are `conflicting` — so the
 *               real cost is again confirmations, not correctness.
 *
 * The clock-skew case below is the one that has already gone wrong once, in a
 * way that looked exactly like a capability nobody had configured.
 */

import {
  DEFAULT_BASELINE_MAX_AGE_MS,
  MAX_BASELINE_CLOCK_SKEW_MS,
  NoPreSendBaselineSource,
  isUsableBaseline,
} from './native-pre-send-baseline';
import type { NativeTableSnapshot } from './waiterpad-native-evidence';

const NOW = new Date('2026-09-12T19:30:00.000Z');

function at(offsetMs: number, over: Partial<NativeTableSnapshot> = {}): NativeTableSnapshot {
  return {
    status: 'observed',
    tableCode: '5',
    pos: 1,
    map: '1',
    lines: [],
    observedAt: new Date(NOW.getTime() - offsetMs).toISOString(),
    ...over,
  };
}

describe('a resolved, fresh observation is a baseline', () => {
  it('accepts an observation taken just now', () => {
    expect(isUsableBaseline(at(0), NOW)).toBe(true);
  });

  it('accepts a free table, which is a perfectly good "before"', () => {
    expect(isUsableBaseline({ status: 'noOpenSale', observedAt: NOW.toISOString() }, NOW)).toBe(
      true,
    );
  });

  it('accepts one right at the age bound and refuses one just past it', () => {
    expect(isUsableBaseline(at(DEFAULT_BASELINE_MAX_AGE_MS), NOW)).toBe(true);
    expect(isUsableBaseline(at(DEFAULT_BASELINE_MAX_AGE_MS + 1), NOW)).toBe(false);
  });
});

describe('what is refused, and why each refusal is the safe direction', () => {
  it('refuses nothing at all', () => {
    expect(isUsableBaseline(undefined, NOW)).toBe(false);
  });

  it.each(['ambiguous', 'unavailable'] as const)(
    'refuses a %s read — that describes our ignorance, not the table',
    (status) => {
      // Subtracting ignorance from an observation is not a delta.
      expect(isUsableBaseline({ status, observedAt: NOW.toISOString() }, NOW)).toBe(false);
    },
  );

  it('refuses an observation with no timestamp', () => {
    // Unknown age could be this second or last Tuesday, and "unknown" is
    // exactly the input that must not be trusted to describe a table now.
    expect(isUsableBaseline(at(0, { observedAt: undefined }), NOW)).toBe(false);
  });

  it('refuses an unparseable timestamp rather than treating it as now', () => {
    expect(isUsableBaseline(at(0, { observedAt: 'yesterday afternoon' }), NOW)).toBe(false);
  });

  it('refuses an observation from before the service started', () => {
    expect(isUsableBaseline(at(6 * 60 * 60_000), NOW)).toBe(false);
  });
});

/**
 * THE CASE THAT HAS ALREADY BITTEN.
 *
 * The observation is stamped by whatever read the table — another process, and
 * in production another MACHINE — while the age is measured against this
 * process's clock. Two clocks are never identical, so the FRESHEST observation
 * available is the one most likely to land a few milliseconds in the future.
 *
 * Refusing those outright discarded exactly the evidence that was most worth
 * having, and on a venue whose connector clock ran slightly fast it would have
 * refused every baseline while looking indistinguishable from a capability
 * nobody had configured.
 */
describe('clock skew between two machines', () => {
  it('accepts an observation a few milliseconds in the future', () => {
    expect(isUsableBaseline(at(-5), NOW)).toBe(true);
  });

  it('accepts one right at the skew bound and refuses one past it', () => {
    expect(isUsableBaseline(at(-MAX_BASELINE_CLOCK_SKEW_MS), NOW)).toBe(true);
    expect(isUsableBaseline(at(-MAX_BASELINE_CLOCK_SKEW_MS - 1), NOW)).toBe(false);
  });

  it('refuses an observation an hour ahead — that is a wrong clock, not a fast one', () => {
    // Without a bound, an observation from the future would stay "fresh"
    // forever and would be the most trusted evidence we ever held.
    expect(isUsableBaseline(at(-60 * 60_000), NOW)).toBe(false);
  });
});

describe('the default source', () => {
  it('never offers a baseline, which is every build until one is configured', async () => {
    await expect(new NoPreSendBaselineSource().readBaseline()).resolves.toBeUndefined();
  });
});

/**
 * PROVING A PRICE LEVEL, AND — MUCH MORE OFTEN — REFUSING TO.
 *
 * Wrong price level = wrong price on a real customer's bill, silently, with
 * nothing on the wire to notice. So the property this file asserts hardest is
 * not that a proof succeeds. It is that every way of NOT knowing produces a
 * result with no `priceLevel` in it at all, which a caller cannot misread.
 *
 * The last describe block runs the real 42-capture evidence through it, so the
 * documented conclusion about this venue is a test rather than a claim.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  describePriceLevelProof,
  MIN_DISCRIMINATING_OBSERVATIONS,
  provePriceLevel,
  TESTABLE_PRICE_LEVELS,
  type CataloguePrices,
  type ObservedPrice,
} from './waiterpad-price-level-proof';

/** `n` PLUs whose venue price is `10 + i`, so every row discriminates. */
function observations(n: number): ObservedPrice[] {
  return Array.from({ length: n }, (_, i) => ({
    nativeCode: String(100 + i),
    price: (10 + i).toFixed(2),
  }));
}

/**
 * A catalogue where `level` reproduces the venue price and every other level in
 * `others` is offset by a dollar — so exactly one level can survive.
 */
function catalogue(
  obs: readonly ObservedPrice[],
  level: number,
  others: readonly number[] = [],
): CataloguePrices[] {
  return obs.map((o) => {
    const pricesByLevel: Record<number, string | null> = { [level]: o.price };
    for (const other of others) pricesByLevel[other] = (Number(o.price) + 1).toFixed(2);
    return { nativeCode: o.nativeCode, pricesByLevel };
  });
}

describe('a level is proven only when it is the only one that fits', () => {
  it('proves the level that reproduces every venue price', () => {
    const obs = observations(20);
    const proof = provePriceLevel(obs, catalogue(obs, 2, [1, 3, 4]));

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(2);
    expect(proof.basis).toMatch(/no other level does/);
  });

  it('REFUSES when two levels are equally consistent', () => {
    const obs = observations(20);
    // Both 1 and 3 carry the venue price. Nothing here distinguishes them.
    const rows = obs.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: { 1: o.price, 3: o.price },
    }));

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).toBe('ambiguous');
    expect(proof).not.toHaveProperty('priceLevel');
    if (proof.kind !== 'ambiguous') throw new Error('unreachable');
    expect(proof.candidates).toEqual([1, 3]);
    expect(proof.basis).toMatch(/not a tie to break/i);
  });

  it('REFUSES when no level reproduces what the venue charged', () => {
    const obs = observations(20);
    const rows = obs.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: { 1: '999.00', 2: '998.00' },
    }));

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).toBe('noLevelExplainsTheVenue');
    expect(proof).not.toHaveProperty('priceLevel');
    expect(proof.basis).toMatch(/must not be activated/i);
  });

  it('disqualifies a level on a SINGLE mismatch, however many it matched', () => {
    const obs = observations(30);
    const rows = catalogue(obs, 2, [1, 3, 4]);
    // One row where level 2 is a cent out. That is a different price.
    rows[7] = {
      nativeCode: rows[7].nativeCode,
      pricesByLevel: { ...rows[7].pricesByLevel, 2: (Number(obs[7].price) + 0.01).toFixed(2) },
    };

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).not.toBe('proven');
  });

  it('does not treat a level whose column is absent everywhere as a candidate', () => {
    const obs = observations(20);
    // Level 2 fits; level 5 contradicts nothing because it explains nothing.
    const proof = provePriceLevel(obs, catalogue(obs, 2), [2, 5]);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(2);
  });

  it('does not count an absent catalogue price as either a match or a mismatch', () => {
    const obs = observations(20);
    const rows = catalogue(obs, 2, [1]);
    rows[3] = { nativeCode: rows[3].nativeCode, pricesByLevel: { 2: null } };

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    const level2 = proof.assessments.find((a) => a.level === 2);
    expect(level2?.absent).toBe(1);
    expect(level2?.matched).toBe(19);
    expect(level2?.mismatched).toBe(0);
  });
});

describe('what is excluded, and why', () => {
  it('excludes zero-priced lines from the discrimination', () => {
    // 20 real prices plus 10 zero-priced sides whose catalogue price is NOT
    // zero. If zeroes voted, they would disqualify the correct level.
    const real = observations(20);
    const zeroes: ObservedPrice[] = Array.from({ length: 10 }, (_, i) => ({
      nativeCode: String(900 + i),
      price: '0.00',
    }));
    const rows = [
      ...catalogue(real, 2, [1]),
      ...zeroes.map((z) => ({ nativeCode: z.nativeCode, pricesByLevel: { 1: '5.00', 2: '5.00' } })),
    ];

    const proof = provePriceLevel([...real, ...zeroes], rows);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(2);
    // The zeroes did not inflate the match count either.
    expect(proof.assessments.find((a) => a.level === 2)?.matched).toBe(20);
  });

  it('refuses outright when too few discriminating observations exist', () => {
    const obs = observations(MIN_DISCRIMINATING_OBSERVATIONS - 1);

    const proof = provePriceLevel(obs, catalogue(obs, 2));

    expect(proof.kind).toBe('insufficientEvidence');
    expect(proof).not.toHaveProperty('priceLevel');
  });

  it('ignores observations the catalogue has no row for', () => {
    const obs = observations(20);
    const proof = provePriceLevel(
      [...obs, { nativeCode: 'NOT-IN-CATALOGUE', price: '42.00' }],
      catalogue(obs, 2, [1]),
    );

    expect(proof.kind).toBe('proven');
  });

  it('compares money numerically, so "18" and "18.00" agree', () => {
    const obs: ObservedPrice[] = Array.from({ length: 12 }, (_, i) => ({
      nativeCode: String(200 + i),
      price: String(10 + i),
    }));
    const rows = obs.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: { 1: Number(o.price).toFixed(2), 2: (Number(o.price) + 1).toFixed(2) },
    }));

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(1);
  });

  it('treats an unparseable catalogue price as a mismatch, never as a match', () => {
    const obs = observations(20);
    const rows = obs.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: { 1: 'POA', 2: o.price },
    }));

    const proof = provePriceLevel(obs, rows);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(2);
  });

  it('tests level 0 only if a caller explicitly asks — it is not a column', () => {
    // `Price0` was not found in the image. It is not in the default set, so a
    // venue cannot be "proven" to trade on a column that does not exist.
    expect(TESTABLE_PRICE_LEVELS).not.toContain(0);
    expect(TESTABLE_PRICE_LEVELS[0]).toBe(1);
  });
});

describe('the refusal is legible', () => {
  it('names concrete disagreements so a refusal can be acted on', () => {
    const obs = observations(20);
    const rows = obs.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: { 1: '999.00' },
    }));

    const proof = provePriceLevel(obs, rows);

    if (proof.kind !== 'noLevelExplainsTheVenue') throw new Error('unreachable');
    const level1 = proof.assessments.find((a) => a.level === 1);
    expect(level1?.examples[0]).toMatch(/venue charged .*, Price1 is 999\.00/);
  });

  it.each(['ambiguous', 'noLevelExplainsTheVenue', 'insufficientEvidence'])(
    'describes a %s outcome as NOT PROVEN',
    (kind) => {
      const obs = observations(20);
      const rows =
        kind === 'ambiguous'
          ? obs.map((o) => ({
              nativeCode: o.nativeCode,
              pricesByLevel: { 1: o.price, 2: o.price },
            }))
          : obs.map((o) => ({ nativeCode: o.nativeCode, pricesByLevel: { 1: '999.00' } }));
      const proof = provePriceLevel(
        kind === 'insufficientEvidence' ? obs.slice(0, 3) : obs,
        kind === 'insufficientEvidence' ? catalogue(obs.slice(0, 3), 1) : rows,
      );

      expect(describePriceLevelProof(proof)).toMatch(/NOT PROVEN/);
    },
  );

  it('describes a proof as PROVEN, with the level', () => {
    const obs = observations(20);
    expect(describePriceLevelProof(provePriceLevel(obs, catalogue(obs, 4, [1])))).toMatch(
      /PRICE LEVEL PROVEN: 4/,
    );
  });
});

/**
 * THE REAL VENUE EVIDENCE.
 *
 * These assertions document, as executable fact, exactly how far the 42
 * captures get us — which is: a long way on everything except the one value
 * that decides what a customer is charged.
 */
describe('the 42 real captures, run through the prover', () => {
  const evidence = JSON.parse(
    readFileSync(
      join(__dirname, '../../../../../scripts/site-config/site-config-evidence.json'),
      'utf8',
    ),
  ) as {
    source: { packets: number; stockItemLines: number; distinctStockItems: number };
    packetFields: Record<string, { status: string; value: string | null }>;
    lineFields: Record<string, { status: string; value: string | null }>;
    stockItems: { nativeCode: string; observedPrices: string[]; priceStable: boolean }[];
  };

  it('carries the whole captured corpus', () => {
    expect(evidence.source.packets).toBe(42);
    expect(evidence.source.stockItemLines).toBe(314);
    expect(evidence.source.distinctStockItems).toBe(115);
  });

  it('settles the table context unanimously: Map 1, Location 1', () => {
    expect(evidence.packetFields.Map).toMatchObject({ status: 'UNANIMOUS', value: '1' });
    expect(evidence.packetFields.Location).toMatchObject({ status: 'UNANIMOUS', value: '1' });
  });

  it("records the iPad POSTerminal and Clerk — which are the iPad's, not Verdura's", () => {
    expect(evidence.packetFields.POSTerminal).toMatchObject({ status: 'UNANIMOUS', value: '901' });
    expect(evidence.packetFields.Clerk).toMatchObject({ status: 'UNANIMOUS', value: '108' });
  });

  it('confirms every genuine line carried Seat 0', () => {
    // The reason ALLOW_NON_ZERO_SEAT stays false: the receiver's behaviour for
    // a non-zero seat has never been exercised on this till.
    expect(evidence.lineFields.Seat).toMatchObject({ status: 'UNANIMOUS', value: '0' });
  });

  it('CANNOT prove a price level from the captures alone, and says so', () => {
    // Every captured line says PriceLevel 0...
    expect(evidence.lineFields.PriceLevel).toMatchObject({ status: 'UNANIMOUS', value: '0' });

    // ...and it is inert. The iPad sends a REAL price, a real price is not
    // -9999, so the receiver skips the `StockItems."Price" & PriceLevel`
    // lookup and never reads that field. Proving this the only honest way:
    // with no catalogue to compare against, the prover refuses.
    const observed = evidence.stockItems
      .filter((s) => s.priceStable)
      .map((s) => ({ nativeCode: s.nativeCode, price: s.observedPrices[0] }));

    const proof = provePriceLevel(observed, []);

    expect(proof.kind).toBe('insufficientEvidence');
    expect(proof).not.toHaveProperty('priceLevel');
  });

  it('has enough discriminating PLUs to settle it the moment a catalogue is readable', () => {
    // The captures are not short of evidence — they are short of the OTHER
    // half. 80+ non-zero, stable prices is ample once StockItems can be read.
    const discriminating = evidence.stockItems.filter(
      (s) => s.priceStable && Number(s.observedPrices[0]) > 0,
    );

    expect(discriminating.length).toBeGreaterThanOrEqual(MIN_DISCRIMINATING_OBSERVATIONS);
    expect(discriminating.length).toBeGreaterThan(70);
  });

  it('proves the level once a catalogue is supplied — the end-to-end rehearsal', () => {
    // Stand in for the read-only StockItems query with a catalogue that prices
    // at level 2 and offsets the others. This is the shape the real query
    // returns, so the day it can be run, this is the answer it produces.
    const observed = evidence.stockItems
      .filter((s) => s.priceStable && Number(s.observedPrices[0]) > 0)
      .map((s) => ({ nativeCode: s.nativeCode, price: s.observedPrices[0] }));

    const rows = observed.map((o) => ({
      nativeCode: o.nativeCode,
      pricesByLevel: {
        1: (Number(o.price) + 2).toFixed(2),
        2: o.price,
        3: (Number(o.price) - 1).toFixed(2),
      },
    }));

    const proof = provePriceLevel(observed, rows);

    expect(proof.kind).toBe('proven');
    if (proof.kind !== 'proven') throw new Error('unreachable');
    expect(proof.priceLevel).toBe(2);
    expect(proof.assessments.find((a) => a.level === 2)?.matched).toBe(observed.length);
  });
});

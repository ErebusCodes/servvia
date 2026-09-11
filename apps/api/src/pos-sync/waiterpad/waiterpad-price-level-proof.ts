/**
 * PROVING THE VENUE'S PRICE LEVEL, OR REFUSING TO.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE MOST DANGEROUS UNKNOWN LEFT.
 *
 * Verdura sends `<Price>-9999</Price>`, which makes the receiver look the price
 * up for itself rather than believing a figure we computed. That is the whole
 * pricing invariant and it is right. But the lookup is
 *
 *     StockItems."Price" & PriceLevel
 *
 * built as a LITERAL COLUMN NAME (`__vbaStrI2`), so the level we send chooses
 * which of the venue's price columns becomes the customer's price. Send 1 where
 * the venue prices at 2 and every bill is wrong, silently, with no warning on
 * the wire and nothing to notice until the day's reconciliation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE 42 CAPTURES DO AND DO NOT SETTLE. READ THIS BEFORE "JUST USING 0".
 *
 * Every one of the 314 captured lines carries `<PriceLevel>0</PriceLevel>`. It
 * is tempting to read that as "the venue's price level is 0". It is not, and
 * the reason is the same static fact the sentinel rests on:
 *
 *   the venue iPad sends a REAL price (18.00, 27.50, ...), never -9999;
 *   a real price is NOT equal to -9999;
 *   so the receiver's `jne` SKIPS the lookup entirely;
 *   so the `PriceLevel` in those packets is never read by anything.
 *
 * The captures prove that this venue has never once exercised the path Verdura
 * will take. `PriceLevel=0` is the iPad's inert filler, not a venue setting —
 * and `Price0` is not even a column found in the image (Price1..Price4 and
 * Price8 are). Copying 0 across would be reading a field that was never used as
 * though it were configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT CAN ACTUALLY PROVE IT, OFFLINE, WITH NO GUESSING.
 *
 * The captures give us something better than a setting: 115 distinct PLUs and,
 * for each, the price the venue's own handheld actually charged a customer. So
 * the question becomes arithmetic rather than archaeology —
 *
 *     which price column, if any, reproduces what the venue actually charged?
 *
 * Read `StockItems.Price1..Price8` for those PLUs (read-only), and a level is a
 * candidate only if it matches EVERY discriminating observation. One survivor
 * is a proof. Two survivors is not a tie to break — it is a refusal, because
 * the evidence genuinely does not distinguish them.
 *
 * ZERO-PRICED LINES ARE EXCLUDED FROM THE DISCRIMINATION, and that is the
 * subtle part. 33 of the observed PLUs were charged 0.00 — sides, sauces,
 * "SIDES", "Chicken", "Lamb". A zero on the wire is at least as likely to be a
 * staff override or a modifier with no price of its own as it is a catalogue
 * value, so letting a zero eliminate a level would let an operator's habit
 * decide a money invariant. They are counted and reported, never voted with.
 *
 * PURE. A function of its arguments. The catalogue comes from a read-only query
 * the connector performs; nothing here opens a connection, and nothing here
 * writes a config value — it returns a proof or a refusal, and a human acts.
 */

/** One price the venue's own handheld actually charged for a PLU. */
export interface ObservedPrice {
  readonly nativeCode: string;
  /** Exactly as it appeared on the wire, e.g. "18.00". */
  readonly price: string;
}

/**
 * One catalogue row, read from `StockItems`.
 *
 * `pricesByLevel` is keyed by the LEVEL NUMBER, because the level is what
 * becomes the column-name suffix. A level the query did not return, or returned
 * NULL for, is simply absent — which is different from a level priced at zero.
 */
export interface CataloguePrices {
  readonly nativeCode: string;
  readonly pricesByLevel: Readonly<Record<number, string | null | undefined>>;
}

export interface LevelAssessment {
  readonly level: number;
  /** Observations this level reproduced exactly. */
  readonly matched: number;
  /** Observations this level contradicted. Any mismatch disqualifies the level. */
  readonly mismatched: number;
  /** Observations the catalogue had no price for at this level. */
  readonly absent: number;
  /** A few concrete disagreements, so a refusal can be acted on rather than argued with. */
  readonly examples: readonly string[];
}

export type PriceLevelProof =
  /** Exactly one level reproduces every discriminating observation. */
  | {
      readonly kind: 'proven';
      readonly priceLevel: number;
      readonly basis: string;
      readonly assessments: readonly LevelAssessment[];
    }
  /** Several levels are equally consistent. Not a tie to break. */
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly number[];
      readonly basis: string;
      readonly assessments: readonly LevelAssessment[];
    }
  /** No level reproduces what the venue charged. */
  | {
      readonly kind: 'noLevelExplainsTheVenue';
      readonly basis: string;
      readonly assessments: readonly LevelAssessment[];
    }
  /** Not enough discriminating evidence to ask the question. */
  | { readonly kind: 'insufficientEvidence'; readonly basis: string };

/**
 * The levels worth testing.
 *
 * `Price1..Price4` and `Price8` are the column names found in `IPS.exe`;
 * 5, 6 and 7 are included because the receiver builds the name by string
 * concatenation and would happily ask for a column this codebase has not seen.
 * A level whose column does not exist simply returns nothing for every row and
 * is eliminated as unsupported rather than assumed away.
 */
export const TESTABLE_PRICE_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Minimum discriminating observations before a proof is even attempted.
 *
 * Not a statistical threshold — it is a guard against a proof resting on one
 * lucky row. With 115 PLUs available, needing ten is not a constraint in
 * practice; it is a refusal to answer from a sample that cannot answer.
 */
export const MIN_DISCRIMINATING_OBSERVATIONS = 10;

/** Money compared as a NUMBER, so "18" and "18.00" agree and "18.0x" does not. */
function sameMoney(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // Cents, rounded, so floating point cannot make two equal prices disagree.
  return Math.round(x * 100) === Math.round(y * 100);
}

function isDiscriminating(price: string): boolean {
  const n = Number(price);
  // A zero is not evidence about a price column — see the header.
  return Number.isFinite(n) && Math.round(n * 100) !== 0;
}

/**
 * Assess every level against the venue's own charges and return a proof or a
 * refusal.
 *
 * THE DEFAULT IS REFUSAL. Every branch that is not "exactly one level survived"
 * returns something a caller cannot mistake for a level, and the return type has
 * no `priceLevel` field on those branches, so a caller cannot read one out by
 * accident.
 */
export function provePriceLevel(
  observed: readonly ObservedPrice[],
  catalogue: readonly CataloguePrices[],
  levels: readonly number[] = TESTABLE_PRICE_LEVELS,
): PriceLevelProof {
  const byCode = new Map<string, CataloguePrices>();
  for (const row of catalogue) byCode.set(row.nativeCode.trim(), row);

  // Only observations we can actually test: a non-zero price, and a catalogue
  // row to test it against.
  const testable = observed.filter(
    (o) => isDiscriminating(o.price) && byCode.has(o.nativeCode.trim()),
  );

  if (testable.length < MIN_DISCRIMINATING_OBSERVATIONS) {
    return {
      kind: 'insufficientEvidence',
      basis:
        `only ${testable.length} discriminating observation(s) are available ` +
        `(non-zero price, and present in the catalogue), and at least ` +
        `${MIN_DISCRIMINATING_OBSERVATIONS} are required. Zero-priced lines are excluded ` +
        'deliberately: a zero on the wire is as likely to be a staff override or a ' +
        'modifier as a catalogue price, and a money invariant must not be decided by one.',
    };
  }

  const assessments: LevelAssessment[] = [];
  for (const level of levels) {
    let matched = 0;
    let mismatched = 0;
    let absent = 0;
    const examples: string[] = [];

    for (const o of testable) {
      const row = byCode.get(o.nativeCode.trim());
      const candidate = row?.pricesByLevel[level];
      if (candidate === null || candidate === undefined) {
        absent += 1;
        continue;
      }
      if (sameMoney(candidate, o.price)) {
        matched += 1;
        continue;
      }
      mismatched += 1;
      if (examples.length < 5) {
        examples.push(
          `PLU ${o.nativeCode}: venue charged ${o.price}, Price${level} is ${candidate}`,
        );
      }
    }

    assessments.push({ level, matched, mismatched, absent, examples });
  }

  // A candidate must contradict NOTHING and must have explained something. A
  // level whose column is absent for every row explains nothing and is not a
  // candidate, however few mismatches it technically has.
  const candidates = assessments.filter((a) => a.mismatched === 0 && a.matched > 0);

  if (candidates.length === 1) {
    const winner = candidates[0];
    return {
      kind: 'proven',
      priceLevel: winner.level,
      basis:
        `Price${winner.level} reproduces every one of the ${winner.matched} discriminating ` +
        `price(s) the venue's own handheld actually charged, and no other level does. ` +
        `${winner.absent} observation(s) had no Price${winner.level} in the catalogue and were ` +
        'not counted either way. Zero-priced lines were excluded from the discrimination.',
      assessments,
    };
  }

  if (candidates.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: candidates.map((c) => c.level),
      basis:
        `levels ${candidates.map((c) => c.level).join(', ')} are each consistent with every ` +
        'discriminating observation, so this evidence does not distinguish them. This is not a ' +
        'tie to break — sending the wrong one of several equally consistent levels puts a wrong ' +
        'price on a customer’s bill exactly as surely as guessing at random. The venue must ' +
        'state which price level it trades on, or a PLU must be found whose price differs ' +
        'between them.',
      assessments,
    };
  }

  return {
    kind: 'noLevelExplainsTheVenue',
    basis:
      'no price level reproduces what the venue actually charged. Either the catalogue has ' +
      'moved since these captures were taken, or this venue does not price through a ' +
      '`StockItems.PriceN` column at all — in which case the `-9999` sentinel would resolve to ' +
      'something nobody has predicted, and the native route must not be activated on it.',
    assessments,
  };
}

/**
 * The single sentence a runbook or a startup check should print.
 *
 * Deliberately says what is NOT known as loudly as what is: a refusal that
 * reads like a shrug gets ignored.
 */
export function describePriceLevelProof(proof: PriceLevelProof): string {
  switch (proof.kind) {
    case 'proven':
      return `PRICE LEVEL PROVEN: ${proof.priceLevel}. ${proof.basis}`;
    case 'ambiguous':
      return `PRICE LEVEL NOT PROVEN (ambiguous between ${proof.candidates.join(', ')}). ${proof.basis}`;
    case 'noLevelExplainsTheVenue':
      return `PRICE LEVEL NOT PROVEN (no level fits). ${proof.basis}`;
    case 'insufficientEvidence':
      return `PRICE LEVEL NOT PROVEN (insufficient evidence). ${proof.basis}`;
  }
}

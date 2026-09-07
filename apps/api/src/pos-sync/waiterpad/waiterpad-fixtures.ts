/**
 * The offline protocol fixture harness.
 *
 * WHAT IT IS. A way to run a WaiterPad byte stream — a response body, a
 * readback document, a malformed reply — through the real parser and the real
 * round-state mapping, from a file or from memory, and get back what the
 * production code would have decided. It is the replay half of a protocol
 * implementation whose sending half does not exist and must not.
 *
 * WHY IT EXISTS NOW, BEFORE ANY REAL PACKET. Tomorrow's Front session may come
 * back with genuine captured bytes: a `Checksum=` line with the packet it
 * belonged to, a real `NAKREGO` body, a real `REQUESTTABLESTATUS` response.
 * The moment those arrive, the only honest thing to do with them is run them
 * through this code and see what it concludes. Building the harness afterwards
 * would mean building it around whatever the capture happened to contain.
 *
 * THE ONE DISTINCTION THIS MODULE EXISTS TO ENFORCE:
 *
 *   provenance: 'synthetic'  — a document WE wrote, from the contract. It is
 *                              a statement of what we believe the protocol
 *                              looks like. It can never corroborate itself.
 *   provenance: 'captured'   — bytes observed coming out of a real IdealPOS,
 *                              with the machine, file and timestamp they came
 *                              from recorded alongside.
 *
 * A synthetic fixture may prove that our parser handles a shape. It may never
 * be cited as evidence that IdealPOS produces that shape. The type makes the
 * difference unavoidable: `CapturedFixture` requires an `origin` naming the
 * machine and source file, and there is no way to construct one without it.
 *
 * TRANSPORT. There is none, here or anywhere in this tree. This module reads
 * files and strings. It has no notion of a host, a port or a socket, and the
 * standing source scan in `waiterpad-safety.spec.ts` fails the build if that
 * ever changes.
 *
 * UNKNOWN STAYS UNKNOWN. Nothing here invents a field. A fixture that carries
 * an element we have not traced is replayed as-is and reported as carrying an
 * untraced element — not normalised, not dropped, not guessed at.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseWaiterPadResponse, type WaiterPadResponseParse } from './waiterpad-response';
import {
  decideFromNonResponse,
  decideFromResponse,
  type WaiterPadOutcomeDecision,
} from './waiterpad-round-state';
import { parseTableStatusResponse, type TableStatusParse } from './waiterpad-table-status';

export class WaiterPadFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadFixtureError';
  }
}

/**
 * Where a fixture's bytes came from. There is no third value, and there never
 * will be a `'derived'` or `'reconstructed'` one — a document assembled from a
 * log line plus our assumptions is synthetic, however real its inspiration.
 */
export type FixtureProvenance = 'synthetic' | 'captured';

/** What the fixture is meant to be replayed through. */
export type FixtureKind =
  /** A response to an ORDER / ORDER2 submission. */
  | 'order_response'
  /** A REQUESTTABLESTATUS response document. */
  | 'table_status_response'
  /** Bytes that are not a valid response at all, kept to prove we refuse them. */
  | 'malformed';

/** The provenance of bytes we wrote ourselves. */
export interface SyntheticOrigin {
  readonly provenance: 'synthetic';
  /**
   * The contract section the shape was taken from, e.g. `'§6 response bodies'`.
   * Required, so a synthetic fixture always says what belief it encodes.
   */
  readonly derivedFrom: string;
}

/**
 * The provenance of bytes a real IdealPOS produced.
 *
 * Every field is required. A capture whose machine or source file is unknown
 * is not a capture — it is a synthetic fixture with a good story, and the type
 * system should say so.
 */
export interface CapturedOrigin {
  readonly provenance: 'captured';
  /** The machine the bytes were observed on, e.g. `'DESKTOP-70DQTGJ'`. */
  readonly machine: string;
  /** The file or capture artefact they were read out of. */
  readonly sourceFile: string;
  /** ISO-8601. When the bytes were produced, not when we copied them. */
  readonly observedAt: string;
  /** How they were obtained. Free text, but it must be written down. */
  readonly method: string;
}

export type FixtureOrigin = SyntheticOrigin | CapturedOrigin;

export interface WaiterPadFixture {
  /** Stable id, unique within a set. The file basename, for on-disk fixtures. */
  readonly id: string;
  readonly kind: FixtureKind;
  readonly origin: FixtureOrigin;
  /** The bytes, exactly as they were written or observed. Never reformatted. */
  readonly body: string;
  /** Why this fixture is in the set. */
  readonly note: string;
}

export function isCaptured(f: WaiterPadFixture): boolean {
  return f.origin.provenance === 'captured';
}

/**
 * Assert a fixture is real evidence.
 *
 * Call this from anything that is about to treat a fixture as a fact about
 * IdealPOS — a checksum test vector, a claim that a response shape exists.
 */
export function assertCapturedEvidence(
  f: WaiterPadFixture,
  purpose: string,
): asserts f is WaiterPadFixture & { origin: CapturedOrigin } {
  if (f.origin.provenance !== 'captured') {
    throw new WaiterPadFixtureError(
      `fixture '${f.id}' is synthetic (derived from ${f.origin.derivedFrom}) and cannot ` +
        `be used for ${purpose}. A document we wrote from the contract is a statement ` +
        'of what we believe, not an observation of what IdealPOS does.',
    );
  }
}

/**
 * The result of running one fixture through the production code.
 *
 * `decision` is present only for `order_response` fixtures, because only an
 * order response maps to a round transition. A readback is data, not an
 * outcome — deciding what a readback means about a round is exactly the
 * question `reconcileRoundAgainstReadback` refuses to answer.
 */
export interface FixtureReplay {
  readonly fixture: WaiterPadFixture;
  readonly responseParse?: WaiterPadResponseParse;
  readonly tableStatusParse?: TableStatusParse;
  readonly decision?: WaiterPadOutcomeDecision;
  /**
   * Element names present in the document that the contract does not record
   * the receiver reading. Reported, never stripped.
   */
  readonly untracedElements: readonly string[];
}

/**
 * Elements the contract records as read or emitted on the traced paths.
 * Anything else in a fixture is surfaced by `untracedElements` so that a real
 * capture carrying a field we have never seen is loud rather than silent.
 *
 * Sourced from the protocol contract §5.2 (request), §6 (responses) and §13
 * (readback). Deliberately NOT a validation whitelist — an untraced element is
 * a finding, not an error.
 */
const TRACED_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  'WPPacket',
  'Order',
  'OrderItem',
  'WPType',
  'Table',
  'Clerk',
  'Guests',
  'DeviceID',
  'Checksum',
  'StockItem',
  'Description',
  'Quantity',
  'Price',
  'Seat',
  'SeatNumber',
  'PriceLevel',
  'Instruction',
  'Index',
]);

function collectElementNames(xml: string): string[] {
  const names = new Set<string>();
  const tagPattern = /<\s*([A-Za-z_][\w.-]*)/g;
  let m: RegExpExecArray | null = tagPattern.exec(xml);
  while (m !== null) {
    names.add(m[1]);
    m = tagPattern.exec(xml);
  }
  return [...names];
}

/**
 * Run one fixture through the real parser and, for order responses, the real
 * round-state mapping.
 *
 * Never throws on fixture content: a fixture that does not parse is the point
 * of a `malformed` fixture, and a captured one that unexpectedly fails to
 * parse is a finding we want recorded rather than an exception that stops a
 * suite.
 */
export function replayFixture(fixture: WaiterPadFixture): FixtureReplay {
  const untraced = collectElementNames(fixture.body).filter((n) => !TRACED_ELEMENT_NAMES.has(n));

  if (fixture.kind === 'table_status_response') {
    return {
      fixture,
      tableStatusParse: parseTableStatusResponse(fixture.body, new Date(0)),
      untracedElements: untraced,
    };
  }

  const responseParse = parseWaiterPadResponse(fixture.body);
  if (responseParse.ok) {
    return {
      fixture,
      responseParse,
      decision: decideFromResponse(responseParse.response),
      untracedElements: untraced,
    };
  }

  // An unparseable reply is not a parse failure to be logged and forgotten. It
  // is an outcome, and the production mapping already has exactly one answer
  // for it. Routing it through that mapping here is what makes the harness a
  // test of the real behaviour rather than of the parser alone.
  return {
    fixture,
    responseParse,
    decision: decideFromNonResponse({ kind: 'unparseable', parse: responseParse }),
    untracedElements: untraced,
  };
}

export function replayAll(fixtures: readonly WaiterPadFixture[]): FixtureReplay[] {
  return fixtures.map(replayFixture);
}

/**
 * The on-disk fixture format.
 *
 * One JSON file per fixture, so a genuine capture can be dropped in beside the
 * synthetic ones without editing any TypeScript, and so the provenance travels
 * with the bytes in the same file rather than in a registry someone can forget
 * to update.
 */
interface FixtureFile {
  readonly kind?: unknown;
  readonly origin?: unknown;
  readonly body?: unknown;
  readonly note?: unknown;
}

const VALID_KINDS: ReadonlySet<string> = new Set<FixtureKind>([
  'order_response',
  'table_status_response',
  'malformed',
]);

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WaiterPadFixtureError(`${where} must be a non-empty string`);
  }
  return value;
}

function parseOrigin(raw: unknown, where: string): FixtureOrigin {
  if (raw === null || typeof raw !== 'object') {
    throw new WaiterPadFixtureError(`${where}.origin must be an object`);
  }
  const o = raw as Record<string, unknown>;
  if (o.provenance === 'synthetic') {
    return {
      provenance: 'synthetic',
      derivedFrom: requireString(o.derivedFrom, `${where}.derivedFrom`),
    };
  }
  if (o.provenance === 'captured') {
    // Every field is mandatory. A capture missing its machine is the exact
    // failure this project has already made twice in prose — a Back-scoped
    // observation filed as a venue fact.
    return {
      provenance: 'captured',
      machine: requireString(o.machine, `${where}.machine`),
      sourceFile: requireString(o.sourceFile, `${where}.sourceFile`),
      observedAt: requireString(o.observedAt, `${where}.observedAt`),
      method: requireString(o.method, `${where}.method`),
    };
  }
  throw new WaiterPadFixtureError(
    `${where}.origin.provenance must be 'synthetic' or 'captured'; got ${JSON.stringify(o.provenance)}`,
  );
}

export function parseFixtureFile(id: string, json: string): WaiterPadFixture {
  let raw: FixtureFile;
  try {
    raw = JSON.parse(json) as FixtureFile;
  } catch (err) {
    throw new WaiterPadFixtureError(
      `fixture '${id}' is not valid JSON: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  const kind = requireString(raw.kind, `fixture '${id}'.kind`);
  if (!VALID_KINDS.has(kind)) {
    throw new WaiterPadFixtureError(`fixture '${id}'.kind '${kind}' is not a known fixture kind`);
  }
  return {
    id,
    kind: kind as FixtureKind,
    origin: parseOrigin(raw.origin, `fixture '${id}'`),
    // `body` may legitimately contain anything, including bytes that are not
    // XML, so it is required to be a string but is otherwise untouched.
    body:
      typeof raw.body === 'string'
        ? raw.body
        : (() => {
            throw new WaiterPadFixtureError(`fixture '${id}'.body must be a string`);
          })(),
    note: requireString(raw.note, `fixture '${id}'.note`),
  };
}

/**
 * Default location of the fixture corpus, relative to this module.
 *
 * TEST-TIME ONLY. `nest build` compiles `.ts` and copies no assets, so this
 * directory does not exist under `dist/`. `loadFixtures` returns an empty array
 * rather than throwing when the directory is absent — which is right for a
 * harness and would be wrong for anything that depended on the corpus at
 * runtime. Nothing does: this module has no importer outside its own spec, and
 * the whole WaiterPad tree has no importer at all.
 */
export const FIXTURE_ROOT = join(__dirname, 'fixtures');

/**
 * Load every fixture under a directory.
 *
 * Subdirectories are traversed one level: `synthetic/` and `captured/` are the
 * conventional two, and the directory a fixture sits in is NOT what determines
 * its provenance — the file's own `origin` is. The directories are for humans;
 * `assertFixtureDirectoryMatchesProvenance` checks they have not drifted.
 */
export function loadFixtures(root: string = FIXTURE_ROOT): WaiterPadFixture[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: WaiterPadFixture[] = [];
  for (const entry of entries.sort()) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      for (const inner of readdirSync(full).sort()) {
        if (!inner.endsWith('.json')) continue;
        out.push(parseFixtureFile(`${entry}/${inner}`, readFileSync(join(full, inner), 'utf8')));
      }
      continue;
    }
    if (!entry.endsWith('.json')) continue;
    out.push(parseFixtureFile(entry, readFileSync(full, 'utf8')));
  }
  return out;
}

/**
 * Refuse a corpus whose directory layout disagrees with its declared
 * provenance.
 *
 * The directory is the thing a human sees first. If a captured fixture is
 * sitting in `synthetic/`, someone will eventually read it as synthetic, or
 * worse, read a synthetic one in `captured/` as evidence.
 */
export function assertFixtureDirectoryMatchesProvenance(
  fixtures: readonly WaiterPadFixture[],
): void {
  for (const f of fixtures) {
    const dir = f.id.includes('/') ? f.id.split('/')[0] : '';
    if (dir === 'synthetic' && f.origin.provenance !== 'synthetic') {
      throw new WaiterPadFixtureError(
        `fixture '${f.id}' sits in synthetic/ but declares provenance '${f.origin.provenance}'`,
      );
    }
    if (dir === 'captured' && f.origin.provenance !== 'captured') {
      throw new WaiterPadFixtureError(
        `fixture '${f.id}' sits in captured/ but declares provenance '${f.origin.provenance}'`,
      );
    }
  }
}

/** A short report of what a corpus contains, for a session write-up. */
export function summariseCorpus(fixtures: readonly WaiterPadFixture[]): string {
  const captured = fixtures.filter(isCaptured);
  const synthetic = fixtures.filter((f) => !isCaptured(f));
  const lines: string[] = [];
  lines.push(
    `${fixtures.length} fixture(s): ${synthetic.length} synthetic, ${captured.length} captured`,
  );
  if (captured.length === 0) {
    lines.push(
      'NO CAPTURED FIXTURES. Every fixture in this corpus is a document we wrote ' +
        'from the contract. Nothing here corroborates the contract; it only checks ' +
        'that our code handles what we already believe.',
    );
  }
  for (const f of fixtures) {
    const prov =
      f.origin.provenance === 'captured'
        ? `captured on ${f.origin.machine} from ${f.origin.sourceFile} at ${f.origin.observedAt}`
        : `synthetic, from ${f.origin.derivedFrom}`;
    lines.push(`  ${f.id}  [${f.kind}]  ${prov}`);
  }
  return lines.join('\n');
}

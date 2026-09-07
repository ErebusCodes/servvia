/**
 * The offline fixture harness, and the line it draws between what we wrote and
 * what we observed.
 *
 * The most important assertion in this file is the one that fails when the
 * corpus contains no captured fixtures — because today it contains none, and a
 * suite that passed silently would let "our parser handles this shape" drift
 * into "IdealPOS produces this shape".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertCapturedEvidence,
  assertFixtureDirectoryMatchesProvenance,
  FIXTURE_ROOT,
  isCaptured,
  loadFixtures,
  parseFixtureFile,
  replayAll,
  replayFixture,
  summariseCorpus,
  WaiterPadFixtureError,
  type WaiterPadFixture,
} from './waiterpad-fixtures';

const corpus = loadFixtures();
const synthetic = corpus.filter((f) => !isCaptured(f));
const captured = corpus.filter(isCaptured);

const byId = (id: string): WaiterPadFixture => {
  const f = corpus.find((c) => c.id === id);
  if (!f) throw new Error(`fixture '${id}' missing from the corpus`);
  return f;
};

describe('the fixture corpus', () => {
  it('loads, and every fixture declares where its bytes came from', () => {
    expect(corpus.length).toBeGreaterThan(10);
    for (const f of corpus) {
      expect(['synthetic', 'captured']).toContain(f.origin.provenance);
      expect(f.note.length).toBeGreaterThan(20);
      expect(typeof f.body).toBe('string');
    }
  });

  it('keeps the directory layout honest about provenance', () => {
    expect(() => assertFixtureDirectoryMatchesProvenance(corpus)).not.toThrow();
  });

  it('has a captured/ directory that explains what may be put in it', () => {
    const readme = readFileSync(join(FIXTURE_ROOT, 'captured', 'README.md'), 'utf8');
    expect(readme).toContain('genuine WaiterPad bytes only');
    expect(readme).toContain('WAITERPAD-CHECKSUM-001');
  });

  /**
   * The standing statement of where the evidence actually is.
   *
   * When Front's `Ideal Handheld.log` finally yields a real packet, this test
   * is the one to change — deliberately, in the same commit that adds the
   * fixture, so the corpus and the claims about it move together.
   */
  it('contains NO captured fixtures today, and says so out loud', () => {
    expect(captured).toHaveLength(0);
    expect(summariseCorpus(corpus)).toContain('NO CAPTURED FIXTURES');
  });

  it('summarises what it holds', () => {
    const summary = summariseCorpus(corpus);
    expect(summary).toContain(`${corpus.length} fixture(s)`);
    for (const f of synthetic) {
      expect(summary).toContain(f.id);
    }
  });
});

describe('synthetic fixtures may never be cited as observations', () => {
  it('assertCapturedEvidence refuses every fixture in the corpus today', () => {
    for (const f of corpus) {
      expect(() => assertCapturedEvidence(f, 'a checksum test vector')).toThrow(
        WaiterPadFixtureError,
      );
    }
  });

  it('explains why, rather than just failing', () => {
    let message = '';
    try {
      assertCapturedEvidence(byId('synthetic/ack.json'), 'a checksum test vector');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('synthetic');
    expect(message).toContain('not an observation of what IdealPOS does');
  });

  it('would accept a fixture that names its machine, file and time', () => {
    const real = parseFixtureFile(
      'captured/example.json',
      JSON.stringify({
        kind: 'order_response',
        origin: {
          provenance: 'captured',
          machine: 'DESKTOP-70DQTGJ',
          sourceFile: 'Ideal Handheld.log',
          observedAt: '2026-09-08T09:14:03+12:00',
          method: 'read-only copy',
        },
        body: "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>",
        note: 'the response to the 09:14 order on table 5, taken from the handheld log',
      }),
    );
    expect(() => assertCapturedEvidence(real, 'a test vector')).not.toThrow();
    expect(isCaptured(real)).toBe(true);
  });

  it('refuses a capture that does not say which machine it came from', () => {
    expect(() =>
      parseFixtureFile(
        'captured/bad.json',
        JSON.stringify({
          kind: 'order_response',
          origin: {
            provenance: 'captured',
            sourceFile: 'x.log',
            observedAt: 'now',
            method: 'copy',
          },
          body: 'x',
          note: 'a capture with no machine is a Back-scoped fact waiting to happen',
        }),
      ),
    ).toThrow(/machine must be a non-empty string/);
  });

  it('refuses a provenance it does not recognise', () => {
    expect(() =>
      parseFixtureFile(
        'x.json',
        JSON.stringify({
          kind: 'order_response',
          origin: { provenance: 'reconstructed', derivedFrom: 'a log line and some reasoning' },
          body: 'x',
          note: 'reconstructed is synthetic wearing a better coat',
        }),
      ),
    ).toThrow(/must be 'synthetic' or 'captured'/);
  });

  it('refuses an unknown fixture kind and malformed JSON', () => {
    expect(() =>
      parseFixtureFile('x.json', JSON.stringify({ kind: 'guess', origin: {}, body: '', note: '' })),
    ).toThrow(WaiterPadFixtureError);
    expect(() => parseFixtureFile('x.json', '{not json')).toThrow(/not valid JSON/);
  });
});

describe('replaying fixtures through the production code', () => {
  it('replays every fixture without throwing', () => {
    const replays = replayAll(corpus);
    expect(replays).toHaveLength(corpus.length);
    for (const r of replays) {
      // Every fixture reaches a decision or a readback parse. Nothing is
      // silently unhandled.
      expect(Boolean(r.decision) || Boolean(r.tableStatusParse)).toBe(true);
    }
  });

  it('ACK replays to submitted-unconfirmed, never to confirmed', () => {
    const r = replayFixture(byId('synthetic/ack.json'));
    expect(r.responseParse?.ok).toBe(true);
    expect(r.decision?.transition.to).toBe('awaiting_native_confirmation');
    expect(r.decision?.requiresReadback).toBe(true);
    expect(r.decision?.safeToRepresentToOperator).toBe(false);
  });

  it('LOCK12002 replays to POS 2 and is the only outcome safe to re-present', () => {
    const r = replayFixture(byId('synthetic/lock-pos2.json'));
    expect(r.responseParse).toEqual(
      expect.objectContaining({
        ok: true,
        response: { type: 'LOCK', lockCode: 12002, posNumber: 2 },
      }),
    );
    expect(r.decision?.safeToRepresentToOperator).toBe(true);
  });

  it('LOCK12000 is refused rather than read as POS 0', () => {
    const r = replayFixture(byId('synthetic/lock-boundary-12000.json'));
    expect(r.responseParse?.ok).toBe(false);
    expect(r.decision?.transition.to).toBe('unresolved');
  });

  /**
   * The malformed cases matter more than the well-formed ones. Each of them
   * has exactly one safe reading and it is "we do not know".
   */
  it.each([
    ['synthetic/unknown-type.json', 'a seventh response type'],
    ['synthetic/empty-body.json', 'a silent connection'],
    ['synthetic/truncated-packet.json', 'a partial read'],
    ['synthetic/wrong-root.json', 'the wrong root element'],
  ])('%s (%s) lands in unresolved and never confirms', (id) => {
    const r = replayFixture(byId(id));
    expect(r.responseParse?.ok).toBe(false);
    expect(r.decision?.transition.apply).toBe('markUnresolved');
    expect(r.decision?.nativeEffect).toBe('unknown');
    expect(r.decision?.requiresReadback).toBe(true);
    expect(r.decision?.safeToRepresentToOperator).toBe(false);
  });

  it('no fixture in the corpus produces a decision that claims execution', () => {
    for (const r of replayAll(corpus)) {
      if (!r.decision) continue;
      expect(r.decision.nativeEffect).not.toBe('executed');
      expect(r.decision.transition.to).not.toBe('confirmed');
      expect(r.decision.transition.to).not.toBe('failed');
    }
  });
});

describe('readback fixtures', () => {
  it('parses two identical lines and still cannot attribute either to a round', () => {
    const r = replayFixture(byId('synthetic/table-status-two-identical-lines.json'));
    expect(r.tableStatusParse?.ok).toBe(true);
    if (r.tableStatusParse?.ok !== true) throw new Error('unreachable');
    const status = r.tableStatusParse.status;
    expect(status.table).toBe(5);
    expect(status.lines).toHaveLength(2);
    expect(status.roundIdentityAvailable).toBe(false);
    expect(status.absentFields).toEqual(['OrderedTime', 'Printed']);
    // The two lines are byte-identical apart from their ordinal. Nothing in the
    // document says which round produced which.
    const [a, b] = status.lines;
    expect(a.stockItem).toBe(b.stockItem);
    expect(a.quantity).toBe(b.quantity);
    expect(a.price.value).toBe(b.price.value);
    expect(a.index).not.toBe(b.index);
  });

  it('trims the space padding the real capture showed is present', () => {
    const r = replayFixture(byId('synthetic/table-status-two-identical-lines.json'));
    if (r.tableStatusParse?.ok !== true) throw new Error('unreachable');
    expect(r.tableStatusParse.status.lines[0].stockItem).toBe('23');
    expect(r.tableStatusParse.status.lines[0].description).toBe('Lemon slice');
  });

  it('surfaces a price the POS never resolved', () => {
    const r = replayFixture(byId('synthetic/table-status-unresolved-price.json'));
    if (r.tableStatusParse?.ok !== true) throw new Error('unreachable');
    expect(r.tableStatusParse.status.lines[0].price.value).toBe(-9999);
  });

  /**
   * The harness must be able to be SURPRISED. A capture carrying a field the
   * contract says is absent would overturn the reconciliation argument, so it
   * has to be reported rather than parsed past.
   */
  it('reports an element the contract does not record the receiver emitting', () => {
    const r = replayFixture(byId('synthetic/table-status-untraced-element.json'));
    expect(r.untracedElements).toContain('OrderedTime');
    // And it does not invent a meaning for it: the parsed status still says no
    // round identity is available.
    if (r.tableStatusParse?.ok !== true) throw new Error('unreachable');
    expect(r.tableStatusParse.status.roundIdentityAvailable).toBe(false);
  });

  it('reports no untraced elements for the fixtures built from the contract', () => {
    for (const id of ['synthetic/ack.json', 'synthetic/table-status-two-identical-lines.json']) {
      expect(replayFixture(byId(id)).untracedElements).toEqual([]);
    }
  });
});

/**
 * THE CLOSED-SET GUARD, added after a real slip.
 *
 * The first version of this corpus wrapped the readback fixtures in
 * `<WPPacket Type = 'TABLESTATUS'>`. There is no such response type. IPS.exe's
 * only `WPPacket Type = '...'` literals are the six order-path bodies, and the
 * REQUESTTABLESTATUS response ENVELOPE was never decoded at all — only the
 * per-row `<OrderItem>` field set was. So the attribute was an invented
 * protocol fact sitting inside a file whose whole purpose is to keep invented
 * facts out.
 *
 * These tests exist so that cannot happen twice. They are deliberately
 * mechanical: enumerate every Type attribute in the corpus and check it
 * against the set the binary actually contains.
 */
describe('no fixture may invent a protocol value', () => {
  /** The complete set of response types in IPS.exe. There is no seventh. */
  const PROVEN_TYPES = /^(ACK|NAK|DUPLICATE|NAKREGO|NAKPRINT|LOCK\d+)$/;

  const typesIn = (body: string): string[] =>
    [...body.matchAll(/<WPPacket[^>]*\sType\s*=\s*'([^']*)'/g)].map((m) => m[1]);

  it('a table_status_response carries NO Type attribute, because the envelope is NOT SHOWN', () => {
    const readbacks = corpus.filter((f) => f.kind === 'table_status_response');
    expect(readbacks.length).toBeGreaterThan(0);
    for (const f of readbacks) {
      expect(typesIn(f.body)).toEqual([]);
      expect(f.body).not.toContain('TABLESTATUS');
    }
  });

  it('an order_response carries only a type the binary actually emits', () => {
    const responses = corpus.filter((f) => f.kind === 'order_response');
    expect(responses.length).toBeGreaterThan(0);
    for (const f of responses) {
      for (const ty of typesIn(f.body)) {
        expect(ty).toMatch(PROVEN_TYPES);
      }
    }
  });

  /**
   * `malformed` is the ONLY kind allowed to carry an unrecognised type, and
   * that is its job — proving we refuse them. The rule is that an invented
   * value may never hide inside a fixture claiming to be a real response.
   */
  it('an unproven type may appear only in a fixture labelled malformed', () => {
    for (const f of corpus) {
      const invented = typesIn(f.body).filter((ty) => !PROVEN_TYPES.test(ty));
      if (invented.length > 0) {
        expect(f.kind).toBe('malformed');
      }
    }
  });

  it('the readback fixtures say in their own text that the envelope is unknown', () => {
    for (const f of corpus.filter((c) => c.kind === 'table_status_response')) {
      expect(f.note).toContain('NOT SHOWN');
      if (f.origin.provenance === 'synthetic') {
        expect(f.origin.derivedFrom).toContain('envelope NOT SHOWN');
      }
    }
  });
});

describe('the harness cannot reach a till', () => {
  it('the fixture module opens nothing', () => {
    const text = readFileSync(join(__dirname, 'waiterpad-fixtures.ts'), 'utf8');
    for (const forbidden of ['node:net', 'node:tls', 'node:http', 'node:dgram', 'Socket']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('every fixture file on disk is inert data, not code', () => {
    const dirs = ['synthetic', 'captured'];
    for (const d of dirs) {
      for (const f of readdirSync(join(FIXTURE_ROOT, d))) {
        expect(f).toMatch(/\.(json|md)$/);
      }
    }
  });
});

// Tests of the Phase 2 bounded correction controller. Run: node --test 'tooling/evaluator/test/*.test.mjs'
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { errorClass, failureSignature, normalizeText } from '../lib/signature.mjs';
import { locationOf } from '../lib/packet.mjs';
import { readLedger } from '../lib/controller.mjs';
import { pruneEvidence } from '../lib/cleanup.mjs';
import { EVALUATOR_ROOT } from '../lib/evaluate.mjs';
import { MULTIPLY_TEST, OBJECTIVE_PATH, VALID, git, makeFixture, objectiveFor } from './fixture.mjs';

const BAD_MULTIPLY = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a + b;\n' };
const BAD_ADD = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a * b;\n' };
const BOTH_BAD = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a + b;\n' };
const flakyNetwork = (port, path) => ({
  ...VALID,
  'sample/multiply.test.mjs': `${MULTIPLY_TEST}test('reaches the service', () => { throw new Error('connect ECONNREFUSED 127.0.0.1:${port} reading ${path} at 2026-10-04T10:${port % 60}:00Z'); });\n`,
});

describe('failure signatures', () => {
  test('normalization removes volatile values', () => {
    const a = normalizeText('connect ECONNREFUSED 127.0.0.1:41234 /private/var/folders/_z/abc123/T/servvia-eval-x1/candidate/apps/api/x.ts:12:5 id 2f1c4c8e-1b9a-4c1e-9d3e-1a2b3c4d5e6f pid 4711 at 2026-10-04T10:01:02.123Z sha 9e0ddd9a1b');
    const b = normalizeText('connect ECONNREFUSED 127.0.0.1:52345 /tmp/servvia-eval-y9/candidate/apps/api/x.ts:98:1 id 7a6b5c4d-1111-4222-8333-444455556666 pid 99 at 2026-11-30T23:59:59Z sha deadbeef42');
    assert.equal(a, b);
    assert.ok(!/41234|4711|2026|2f1c|9e0ddd9/.test(a));
  });

  test('the error class is the first meaningful line, normalized', () => {
    assert.equal(errorClass('\n  ---\n  Expected values to be strictly equal:\n\n5 !== 6'), 'expected values to be strictly equal:');
  });

  test('equal failures share a signature, different ones do not', () => {
    const rec = (test, message) => ({
      findings: [{ severity: 'FAIL', code: 'check-failed', check: 'unit' }],
      excerpts: [{ source: 'check:unit', test, text: message }],
    });
    const one = failureSignature(rec('reaches the service', 'connect ECONNREFUSED 127.0.0.1:41234 (/tmp/a/x)'));
    const two = failureSignature(rec('reaches the service', 'connect ECONNREFUSED 127.0.0.1:59999 (/private/tmp/b/y)'));
    const other = failureSignature(rec('adds numbers', 'connect ECONNREFUSED 127.0.0.1:41234'));
    assert.equal(one.signature, two.signature);
    assert.notEqual(one.signature, other.signature);
  });

  test('a packet location is read from a workspace stack frame', () => {
    assert.equal(locationOf('at foo (/private/var/folders/x/T/servvia-eval-1/candidate/apps/api/src/a.ts:42:7)'), 'apps/api/src/a.ts:42');
    assert.equal(locationOf('no location here'), null);
  });

  test('cleanup removes only evidence older than the limit', () => {
    const fx = makeFixture();
    try {
      for (const [name, at] of [['old', '2026-01-01T00:00:00Z'], ['new', '2026-10-01T00:00:00Z']]) {
        mkdirSync(join(fx.evidenceRoot, 'obj', 'v1', name), { recursive: true });
        writeFileSync(join(fx.evidenceRoot, 'obj', 'v1', name, 'record.json'), JSON.stringify({ evaluatedAt: at }));
      }
      const removed = pruneEvidence(fx.evidenceRoot, { olderThanDays: 30, now: new Date('2026-10-04T00:00:00Z') });
      assert.deepEqual(removed.map((p) => p.split('/').at(-1)), ['old']);
      assert.ok(existsSync(join(fx.evidenceRoot, 'obj', 'v1', 'new')));
    } finally {
      fx.cleanup();
    }
  });
});

describe('the bounded correction loop', () => {
  let fx;
  before(() => { fx = makeFixture(); });
  after(() => fx.cleanup());
  const fresh = (t, overrides) => { const f = makeFixture(overrides); t.after(() => f.cleanup()); return f; };

  test('an initial candidate that passes is ready for acceptance, and the loop closes', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(VALID);
    const r = await f.advance(c1);
    assert.equal(r.decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
    const again = await f.advance(f.candidate({ 'sample/notes.txt': 'more' }, c1));
    assert.deepEqual([again.decision, again.reason], ['STOP', 'LOOP_TERMINAL']);
  });

  test('FAIL, then a correction that passes', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    const r1 = await f.advance(c1);
    assert.equal(r1.decision, 'CORRECT');
    assert.equal(r1.packet.iteration, 1);
    assert.equal(r1.packet.remainingCorrections, 2);
    assert.ok(r1.packet.failures.some((x) => x.test === 'multiplies numbers'));
    const c2 = f.candidate(VALID, c1);
    const r2 = await f.advance(c2);
    assert.equal(r2.decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
    const ledger = readLedger(f.stateRoot, 'demo-multiply');
    assert.deepEqual(ledger.versions[0].iterations.map((i) => [i.n, i.verdict, i.parentCandidate]), [[1, 'FAIL', null], [2, 'PASS', c1]]);
    git(f.repo, 'cat-file', '-e', `${c1}^{commit}`); // the failed candidate is preserved
  });

  test('FAIL, FAIL (a different failure), then PASS', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    const c2 = f.candidate(BAD_ADD, c1);
    const c3 = f.candidate(VALID, c2);
    assert.equal((await f.advance(c1)).decision, 'CORRECT');
    const r2 = await f.advance(c2);
    assert.equal(r2.decision, 'CORRECT');
    assert.equal(r2.packet.remainingCorrections, 1);
    assert.equal((await f.advance(c3)).decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
  });

  test('three failing candidates reach the correction limit; a fourth is refused', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    const c2 = f.candidate(BAD_ADD, c1);
    const c3 = f.candidate(BOTH_BAD, c2);
    assert.equal((await f.advance(c1)).decision, 'CORRECT');
    assert.equal((await f.advance(c2)).decision, 'CORRECT');
    const r3 = await f.advance(c3);
    assert.deepEqual([r3.decision, r3.reason], ['STOP', 'CORRECTION_LIMIT_REACHED']);
    const r4 = await f.advance(f.candidate(VALID, c3));
    assert.deepEqual([r4.decision, r4.reason], ['STOP', 'LOOP_TERMINAL']);
  });

  test('the same failure twice, with different ports, paths and times, stops early and records a lesson candidate', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(flakyNetwork(41234, '/tmp/servvia-a1/data'));
    const c2 = f.candidate(flakyNetwork(52345, '/private/var/folders/zz/T/servvia-b2/data'), c1);
    assert.equal((await f.advance(c1)).decision, 'CORRECT');
    const r2 = await f.advance(c2);
    assert.deepEqual([r2.decision, r2.reason], ['STOP', 'REPEATED_FAILURE_SIGNATURE']);
    const ledger = readLedger(f.stateRoot, 'demo-multiply');
    assert.equal(ledger.lessonCandidates.length, 1);
    assert.deepEqual([ledger.lessonCandidates[0].kind, ledger.lessonCandidates[0].status, ledger.lessonCandidates[0].iterations], ['LESSON CANDIDATE', 'unreviewed', [1, 2]]);
  });

  test('NEEDS_REVIEW, INTEGRITY_VIOLATION and HARNESS_ERROR stop without a correction', async (t) => {
    const modified = readFileSync(join(fx.repo, 'sample/math.test.mjs'), 'utf8').replace('add(-2, -3), -5', 'add(-2, -2), -4');
    for (const [files, verdict] of [
      [{ ...VALID, 'sample/math.test.mjs': modified }, 'NEEDS_REVIEW'],
      [{ ...VALID, 'sample/multiply.test.mjs': `${MULTIPLY_TEST}test.only('x', () => {});\n` }, 'INTEGRITY_VIOLATION'],
    ]) {
      const f = fresh(t);
      const r = await f.advance(f.candidate(files));
      assert.deepEqual([r.decision, r.reason, r.verdict], ['STOP', verdict, verdict]);
      assert.equal(r.packet, undefined);
      assert.ok(!existsSync(join(f.stateRoot, 'demo-multiply', 'v1', 'packet-1.json')));
    }
    const h = fresh(t, { checks: [{ id: 'unit', category: 'unit', runner: 'go-test', args: ['./...'] }], requiredTests: [] });
    const r = await h.advance(h.candidate(VALID), { tools: { goRoot: '/nonexistent/go' } });
    assert.deepEqual([r.decision, r.reason], ['STOP', 'HARNESS_ERROR']);
  });

  test('a correction that edits the objective or a forbidden path is stopped, not corrected again', async (t) => {
    for (const [files, code] of [
      [{ [OBJECTIVE_PATH]: '{"acceptanceCriteria":"relaxed"}' }, 'objective-modified'],
      [{ 'restricted/area.txt': 'x' }, 'forbidden-surface'],
    ]) {
      const f = fresh(t);
      const c1 = f.candidate(BAD_MULTIPLY);
      assert.equal((await f.advance(c1)).decision, 'CORRECT');
      const r2 = await f.advance(f.candidate({ ...VALID, ...files }, c1));
      assert.deepEqual([r2.decision, r2.reason], ['STOP', 'INTEGRITY_VIOLATION']);
      assert.ok(r2.record.findings.some((x) => x.code === code));
    }
  });

  test('an amended (non-descendant) correction is refused; failed candidates stay in history', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    assert.equal((await f.advance(c1)).decision, 'CORRECT');
    const amended = f.candidate(VALID); // from the anchor, not from c1
    const r = await f.advance(amended);
    assert.deepEqual([r.decision, r.reason], ['STOP', 'CANDIDATE_HISTORY_VIOLATION']);
    git(f.repo, 'cat-file', '-e', `${c1}^{commit}`);
    assert.equal(readLedger(f.stateRoot, 'demo-multiply').versions[0].iterations[0].candidate, c1);
  });

  test('objective version 2 supersedes version 1 and restarts the count; v1 is refused afterwards', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    assert.equal((await f.advance(c1)).decision, 'CORRECT');
    const v2 = f.freeze({ version: 2, title: 'Multiply two numbers (v2: restated)' }, f.anchor.commit);
    const d1 = f.candidate(VALID, v2.commit);
    const r = await f.advance(d1, { anchor: v2 });
    assert.equal(r.decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
    assert.equal(r.iteration.n, 1);
    const ledger = readLedger(f.stateRoot, 'demo-multiply');
    assert.deepEqual(ledger.versions.map((v) => [v.version, v.status, v.iterations.length]), [[1, 'superseded', 1], [2, 'passed', 1]]);
    const stale = await f.advance(f.candidate(VALID, c1));
    assert.deepEqual([stale.decision, stale.reason], ['STOP', 'OBJECTIVE_SUPERSEDED']);
  });

  test('a second, different freeze of the same version is refused', async (t) => {
    const f = fresh(t);
    assert.equal((await f.advance(f.candidate(BAD_MULTIPLY))).decision, 'CORRECT');
    const rival = f.freeze({ version: 1, title: 'Multiply two numbers, quietly relaxed' }, f.anchor.commit, OBJECTIVE_PATH.replace('demo', 'demo-rival'));
    const r = await f.advance(f.candidate(VALID, rival.commit), { anchor: rival });
    assert.deepEqual([r.decision, r.reason], ['STOP', 'OBJECTIVE_VERSION_CONFLICT']);
  });

  test('a tampered ledger stops the loop', async (t) => {
    const f = fresh(t);
    const c1 = f.candidate(BAD_MULTIPLY);
    await f.advance(c1);
    const path = join(f.stateRoot, 'demo-multiply', 'ledger.json');
    const ledger = JSON.parse(readFileSync(path, 'utf8'));
    ledger.versions[0].iterations[0].verdict = 'PASS';
    writeFileSync(path, JSON.stringify(ledger));
    const r = await f.advance(f.candidate(VALID, c1));
    assert.deepEqual([r.decision, r.reason], ['STOP', 'LEDGER_TAMPERED']);

    // Re-opening a stopped loop to get around the limit is caught the same way.
    const g = fresh(t);
    const d1 = g.candidate(flakyNetwork(41234, '/tmp/x'));
    const d2 = g.candidate(flakyNetwork(41235, '/tmp/y'), d1);
    await g.advance(d1);
    assert.equal((await g.advance(d2)).reason, 'REPEATED_FAILURE_SIGNATURE');
    const gpath = join(g.stateRoot, 'demo-multiply', 'ledger.json');
    const reopened = JSON.parse(readFileSync(gpath, 'utf8'));
    reopened.versions[0].status = 'open';
    writeFileSync(gpath, JSON.stringify(reopened));
    const r3 = await g.advance(g.candidate(VALID, d2));
    assert.deepEqual([r3.decision, r3.reason], ['STOP', 'LEDGER_TAMPERED']);
  });

  test('the failure packet is minimal and redacted, and its hash is in the ledger', async (t) => {
    const f = fresh(t);
    const leaky = { ...VALID, 'sample/multiply.test.mjs': `${MULTIPLY_TEST}test('leaks', () => { throw new Error('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl password=hunter2222 owner@example.com ' + process.env.JWT_ACCESS_SECRET); });\n` };
    const r = await f.advance(f.candidate(leaky));
    assert.equal(r.decision, 'CORRECT');
    const text = readFileSync(r.packetPath, 'utf8');
    for (const leaked of ['eyJhbGciOiJIUzI1NiJ9', 'hunter2222', 'owner@example.com', 'ci-only-access-secret-at-least-32-characters']) {
      assert.ok(!text.includes(leaked), `packet leaked ${leaked}`);
    }
    const packet = JSON.parse(text);
    assert.deepEqual(Object.keys(packet).sort(), ['candidate', 'failures', 'iteration', 'objective', 'remainingCorrections', 'requiredTests', 'rules', 'schema', 'signature', 'surfaces', 'verdict']);
    assert.ok(!/skipPatterns|governance|policy\.json|evaluation\.json/.test(text), 'no evaluator internals');
    const it = readLedger(f.stateRoot, 'demo-multiply').versions[0].iterations[0];
    assert.equal(it.packetSha256, createHash('sha256').update(text).digest('hex'));
  });
});

describe('the loop command line', () => {
  let fx;
  before(() => { fx = makeFixture(); });
  after(() => fx.cleanup());
  const cli = (...args) => spawnSync(process.execPath, [join(EVALUATOR_ROOT, 'bin', 'loop.mjs'), ...args, '--state-dir', fx.stateRoot, '--evidence-dir', fx.evidenceRoot], { encoding: 'utf8' });

  test('validate reports a draft ready for freeze, with its hash, and rejects an invalid draft', () => {
    const draft = join(fx.stateRoot, 'draft.json');
    const text = `${JSON.stringify(objectiveFor(fx.baseline), null, 2)}\n`;
    writeFileSync(draft, text);
    const ok = cli('validate', '--objective-file', draft, '--repo', fx.repo);
    assert.equal(ok.status, 0);
    const out = JSON.parse(ok.stdout);
    assert.equal(out.status, 'OBJECTIVE READY FOR FREEZE');
    assert.equal(out.sha256, createHash('sha256').update(text).digest('hex'));
    writeFileSync(draft, JSON.stringify({ ...objectiveFor(fx.baseline), acceptanceCriteria: [] }));
    assert.equal(cli('validate', '--objective-file', draft).status, 20);
  });

  test('the gate opens only for the approved anchor, and closes once the loop ends', () => {
    const anchorArgs = (sha) => ['--repo', fx.repo, '--anchor-commit', fx.anchor.commit, '--objective', fx.anchor.objectivePath, '--objective-sha256', sha];
    assert.equal(JSON.parse(cli('gate', ...anchorArgs(fx.anchor.objectiveSha256)).stdout).gate, 'OPEN');
    const wrong = cli('gate', ...anchorArgs('0'.repeat(64)));
    assert.equal(wrong.status, 20);
    assert.equal(JSON.parse(wrong.stdout).gate, 'CLOSED');
    const c1 = fx.candidate(VALID);
    const adv = cli('advance', ...anchorArgs(fx.anchor.objectiveSha256), '--candidate', c1);
    assert.equal(adv.status, 0, adv.stdout + adv.stderr);
    assert.equal(JSON.parse(adv.stdout).decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
    const closed = cli('gate', ...anchorArgs(fx.anchor.objectiveSha256));
    assert.equal(JSON.parse(closed.stdout).gate, 'CLOSED');
  });
});


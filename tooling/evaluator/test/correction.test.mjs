// The correction path: which commit each run of the loop may start from.
// The initial candidate (C1) starts from exactly the anchor; a correction
// (C2, C3) from exactly the failed candidate the sealed ledger records, with
// the packet issued for it; nothing opens after a STOP. The gate is driven
// through bin/loop.mjs, as the BMAD workflow runs it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EVALUATOR_ROOT } from '../lib/evaluate.mjs';
import { readLedger, sealOf } from '../lib/controller.mjs';
import { intentContractSha256 } from '../lib/objective.mjs';
import { VALID, commit, git, makeFixture, objectiveFor } from './fixture.mjs';

const BAD_MULTIPLY = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a + b;\n' };
const BAD_ADD = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a * b;\n' };
const BOTH_BAD = { ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a + b;\n' };
const sha = (text) => createHash('sha256').update(text).digest('hex');

function fixture(t, overrides, options) {
  const f = makeFixture(overrides, options);
  t.after(() => f.cleanup());
  const cli = (...args) => spawnSync(process.execPath, [join(EVALUATOR_ROOT, 'bin', 'loop.mjs'), ...args, '--state-dir', f.stateRoot, '--evidence-dir', f.evidenceRoot], { encoding: 'utf8' });
  /** The gate as the workflow runs it, on the repository's current checkout. */
  const gate = ({ anchor = f.anchor, packet } = {}) => {
    const r = cli('gate', '--repo', f.repo, '--anchor-commit', anchor.commit, '--objective', anchor.objectivePath, '--objective-sha256', anchor.objectiveSha256, ...(packet ? ['--failure-packet', packet] : []));
    return { status: r.status, ...JSON.parse(r.stdout) };
  };
  const at = (rev) => git(f.repo, 'checkout', '-q', '--detach', rev);
  const ledgerFile = () => join(f.stateRoot, 'demo-multiply', 'ledger.json');
  return { ...f, cli, gate, at, ledgerFile };
}

/** C1 failed and the controller decided CORRECT: returns C1 and its packet path. */
async function failedC1(f, files = BAD_MULTIPLY) {
  const c1 = f.candidate(files);
  const r = await f.advance(c1);
  assert.equal(r.decision, 'CORRECT', JSON.stringify(r.record?.verdictReasons));
  return { c1, packet: r.packetPath };
}

describe('initial candidate (C1)', () => {
  test('1. opens from exactly the anchor', (t) => {
    const f = fixture(t);
    f.at(f.anchor.commit);
    const g = f.gate();
    assert.equal(g.gate, 'OPEN', g.reason);
    assert.deepEqual([g.run, g.iteration, g.startCommit], ['initial', 1, f.anchor.commit]);
  });

  test('2. is refused from a descendant of the anchor', (t) => {
    const f = fixture(t);
    f.candidate({ 'sample/notes.txt': 'work in progress\n' });
    const g = f.gate();
    assert.equal(g.gate, 'CLOSED');
    assert.match(g.reason, /initial candidate starts from the objective anchor/);
  });

  test('3. is refused from a sibling of the anchor', (t) => {
    const f = fixture(t);
    f.at(f.baseline);
    commit(f.repo, { 'sample/notes.txt': 'sibling\n' }, 'sibling of the anchor');
    assert.match(f.gate().reason, /initial candidate starts from the objective anchor/);
  });

  test('4. is refused under a wrong anchor', (t) => {
    const f = fixture(t);
    f.at(f.anchor.commit);
    const wrong = f.gate({ anchor: { ...f.anchor, commit: f.baseline } });
    assert.equal(wrong.gate, 'CLOSED');
    assert.match(wrong.reason, /does not exist at the anchor commit/);
    const otherAnchor = f.freeze({ version: 1, title: 'another freeze' }, f.baseline, 'x/v1.objective.json');
    f.at(f.anchor.commit);
    assert.match(f.gate({ anchor: otherAnchor }).reason, /initial candidate starts from the objective anchor/);
  });

  test('is refused with a failure packet, or from an unclean checkout', (t) => {
    const f = fixture(t);
    f.at(f.anchor.commit);
    assert.match(f.gate({ packet: join(f.stateRoot, 'invented.json') }).reason, /initial run takes no failure packet/);
    writeFileSync(join(f.repo, 'sample', 'scratch.txt'), 'untracked\n');
    assert.match(f.gate().reason, /checkout is not clean/);
  });
});

describe('correction candidates (C2, C3)', () => {
  test('5. FAIL C1 + CORRECT + HEAD exactly C1: C2 opens, with the packet issued for C1', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(c1);
    const g = f.gate({ packet });
    assert.equal(g.gate, 'OPEN', g.reason);
    assert.deepEqual([g.run, g.iteration, g.startCommit, g.correctsCandidate], ['correction', 2, c1, c1]);
    assert.equal(g.packetSha256, sha(readFileSync(packet)));
  });

  test('a correction needs the packet issued for C1, unchanged', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(c1);
    assert.match(f.gate().reason, /names the failure packet issued for/);
    const copy = join(f.stateRoot, 'copy.json');
    writeFileSync(copy, readFileSync(packet));
    assert.match(f.gate({ packet: copy }).reason, /is not the one issued for/);
    const p = JSON.parse(readFileSync(packet, 'utf8'));
    writeFileSync(packet, JSON.stringify({ ...p, failures: [] }, null, 2));
    assert.match(f.gate({ packet }).reason, /differs from the one the controller issued/);
  });

  test('6. FAIL C1 + HEAD the anchor: C2 refused', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(f.anchor.commit);
    const g = f.gate({ packet });
    assert.equal(g.gate, 'CLOSED');
    assert.match(g.reason, new RegExp(`starts from the failed candidate ${c1}`));
  });

  test('7. FAIL C1 + HEAD a sibling descendant of the anchor: refused', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.candidate(VALID); // from the anchor, beside C1
    assert.match(f.gate({ packet }).reason, new RegExp(`starts from the failed candidate ${c1}`));
  });

  test('8. FAIL C1 + HEAD an unrecorded descendant of C1: refused', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.candidate(VALID, c1); // a correction committed before the gate ran
    assert.match(f.gate({ packet }).reason, new RegExp(`starts from the failed candidate ${c1}`));
  });

  test('9. C2 FAIL + CORRECT + HEAD exactly C2: C3 opens', async (t) => {
    const f = fixture(t);
    const { c1 } = await failedC1(f);
    const c2 = f.candidate(BAD_ADD, c1);
    const r2 = await f.advance(c2);
    assert.equal(r2.decision, 'CORRECT');
    f.at(c2);
    const g = f.gate({ packet: r2.packetPath });
    assert.equal(g.gate, 'OPEN', g.reason);
    assert.deepEqual([g.run, g.iteration, g.correctsCandidate], ['correction', 3, c2]);
    f.at(c1);
    assert.match(f.gate({ packet: r2.packetPath }).reason, new RegExp(`starts from the failed candidate ${c2}`));
  });

  test('10. C4 is refused: C3 failing ends the loop', async (t) => {
    const f = fixture(t);
    const { c1 } = await failedC1(f);
    const c2 = f.candidate(BAD_ADD, c1);
    assert.equal((await f.advance(c2)).decision, 'CORRECT');
    const c3 = f.candidate(BOTH_BAD, c2);
    const r3 = await f.advance(c3);
    assert.deepEqual([r3.decision, r3.reason], ['STOP', 'CORRECTION_LIMIT_REACHED']);
    f.at(c3);
    const g = f.gate();
    assert.equal(g.gate, 'CLOSED');
    assert.match(g.reason, /loop is stopped: CORRECTION_LIMIT_REACHED/);
    const c4 = f.candidate(VALID, c3);
    assert.deepEqual([(await f.advance(c4)).reason], ['LOOP_TERMINAL']);
  });

  test('11. after a repeated failure signature, no correction opens', async (t) => {
    const f = fixture(t);
    const { c1 } = await failedC1(f);
    const c2 = f.candidate({ ...BAD_MULTIPLY, 'sample/math.mjs': `// cosmetic\n${BAD_MULTIPLY['sample/math.mjs']}` }, c1);
    const r2 = await f.advance(c2);
    assert.deepEqual([r2.decision, r2.reason], ['STOP', 'REPEATED_FAILURE_SIGNATURE']);
    f.at(c2);
    assert.match(f.gate().reason, /loop is stopped: REPEATED_FAILURE_SIGNATURE/);
  });

  test('12-14. after NEEDS_REVIEW, INTEGRITY_VIOLATION or HARNESS_ERROR, no correction opens', async (t) => {
    const cases = [
      ['NEEDS_REVIEW', (f) => f.candidate({ ...VALID, 'elsewhere/notes.txt': 'outside the allowed surfaces\n' }), {}],
      ['INTEGRITY_VIOLATION', (f) => f.candidate({ ...VALID, 'sample/check.config.json': '{}\n' }), {}],
      ['HARNESS_ERROR', (f) => f.candidate(VALID), { evaluatorRoot: join(EVALUATOR_ROOT, 'lib') }],
    ];
    for (const [verdict, make, extra] of cases) {
      const f = fixture(t);
      const c1 = make(f);
      const r = await f.advance(c1, extra);
      assert.deepEqual([r.decision, r.reason], ['STOP', verdict]);
      f.at(c1);
      assert.match(f.gate().reason, new RegExp(`loop is stopped: ${verdict}`));
      f.at(f.anchor.commit);
      assert.match(f.gate().reason, new RegExp(`loop is stopped: ${verdict}`), 'nor a fresh start from the anchor');
    }
  });

  test('15. a changed objective or hash between candidates is refused', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(c1);
    const otherHash = f.gate({ anchor: { ...f.anchor, objectiveSha256: sha('another objective') }, packet });
    assert.equal(otherHash.gate, 'CLOSED');
    assert.match(otherHash.reason, /does not match the approved anchor/);
    // The same version frozen again with different content: a conflict.
    const refrozen = f.freeze({ version: 1, title: 'Multiply, reinterpreted' }, f.baseline, 'y/v1.objective.json');
    f.at(c1);
    assert.match(f.gate({ anchor: refrozen, packet }).reason, /a different anchor is already frozen for this version/);
    // A newer version restarts at its own anchor: never a correction from v1's candidate.
    const v2 = f.freeze({ version: 2 }, f.baseline);
    f.at(c1);
    assert.match(f.gate({ anchor: v2, packet }).reason, /initial run takes no failure packet/);
    assert.match(f.gate({ anchor: v2 }).reason, /initial candidate starts from the objective anchor/);
  });

  test('17. a tampered ledger closes the gate', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(c1);
    const original = readFileSync(f.ledgerFile(), 'utf8');
    const ledger = JSON.parse(original);
    ledger.versions[0].iterations[0].verdict = 'PASS';
    writeFileSync(f.ledgerFile(), JSON.stringify(ledger, null, 2));
    assert.match(f.gate({ packet }).reason, /LEDGER_TAMPERED/);
    // Emptying the history of a sealed ledger does not reset the loop.
    writeFileSync(f.ledgerFile(), JSON.stringify({ ...JSON.parse(original), versions: [] }, null, 2));
    f.at(f.anchor.commit);
    assert.match(f.gate().reason, /LEDGER_TAMPERED/);
  });

  test('18. a ledger of another objective is refused', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    f.at(c1);
    const ledger = JSON.parse(readFileSync(f.ledgerFile(), 'utf8'));
    ledger.objectiveId = 'story-9-9-something-else';
    ledger.integrity = sealOf(ledger);
    writeFileSync(f.ledgerFile(), JSON.stringify(ledger, null, 2));
    assert.match(f.gate({ packet }).reason, /LEDGER_MISMATCH/);
    const r = await f.advance(f.candidate(VALID, c1));
    assert.deepEqual([r.decision, r.reason], ['STOP', 'LEDGER_MISMATCH']);
  });

  test('18b. a different objective version is refused: a superseded one cannot correct', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    const v2 = f.freeze({ version: 2 }, f.baseline);
    f.at(v2.commit);
    assert.equal(f.gate({ anchor: v2 }).gate, 'OPEN');
    assert.equal((await f.advance(f.candidate(BAD_ADD, v2.commit), { anchor: v2 })).decision, 'CORRECT');
    f.at(c1);
    assert.match(f.gate({ packet }).reason, /objective version 2 supersedes 1/);
  });
});

describe('a ledger forged and resealed by hand (same-account tampering) still cannot open a correction', () => {
  /** Rewrites the ledger with `edit` and reseals it, as someone with write access could. */
  const forge = (f, edit) => {
    const ledger = JSON.parse(readFileSync(f.ledgerFile(), 'utf8'));
    edit(ledger, ledger.versions[0], ledger.versions[0].iterations.at(-1));
    ledger.integrity = sealOf(ledger);
    writeFileSync(f.ledgerFile(), JSON.stringify(ledger, null, 2));
  };

  test('when the last decision is not CORRECT', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    forge(f, (l, v, it) => { it.decision = 'STOP'; });
    f.at(c1);
    assert.match(f.gate({ packet }).reason, /decision is STOP, not CORRECT/);
  });

  test('beyond the correction limit', async (t) => {
    const f = fixture(t);
    const { c1 } = await failedC1(f);
    const c2 = f.candidate(BAD_ADD, c1);
    const r2 = await f.advance(c2);
    const c3 = f.candidate(BOTH_BAD, c2);
    await f.advance(c3);
    forge(f, (l, v, it) => Object.assign(v, { status: 'open', stopReason: null }) && Object.assign(it, { decision: 'CORRECT', packetPath: r2.packetPath, packetSha256: sha(readFileSync(r2.packetPath)) }));
    f.at(c3);
    assert.match(f.gate({ packet: r2.packetPath }).reason, /CORRECTION_LIMIT_REACHED/);
  });

  test('with a packet written for another candidate', async (t) => {
    const f = fixture(t);
    const { c1, packet } = await failedC1(f);
    const bytes = `${JSON.stringify({ ...JSON.parse(readFileSync(packet, 'utf8')), candidate: f.anchor.commit }, null, 2)}\n`;
    writeFileSync(packet, bytes);
    forge(f, (l, v, it) => { it.packetSha256 = sha(bytes); });
    f.at(c1);
    assert.match(f.gate({ packet }).reason, /packet is for another candidate or objective/);
  });
});

describe('16. the canonical inputs between candidates (schema v2)', () => {
  const CONTEXT = '_bmad-output/implementation-artifacts/epic-7-context.md';
  const SPEC = '_bmad-output/implementation-artifacts/spec-7-1-multiply.md';
  const CONTEXT_TEXT = '# Epic 7 Context: arithmetic\n';
  const SPEC_TEXT = (intent = 'Multiply two numbers.') => `---\nstatus: 'ready-for-dev'\n---\n\n<intent-contract>\n\n**Problem:** ${intent}\n\n</intent-contract>\n`;

  function v2(t) {
    const f = fixture(t, {}, { baselineFiles: { [CONTEXT]: CONTEXT_TEXT } });
    const head = git(f.repo, 'rev-parse', 'HEAD');
    const { approval, ...legacy } = objectiveFor(head);
    void approval;
    const objective = {
      ...legacy, schema: 'servvia.objective/v2', objectiveId: 'story-7-1-multiply', storyId: '7.1',
      inputs: { storySpec: { path: SPEC, intentContractSha256: intentContractSha256(SPEC_TEXT()) }, epicContext: { path: CONTEXT, sha256: sha(CONTEXT_TEXT) } },
    };
    const path = '_bmad-output/implementation-artifacts/objectives/story-7-1-multiply/v1.objective.json';
    const text = `${JSON.stringify(objective, null, 2)}\n`;
    git(f.repo, 'checkout', '-q', '--detach', head);
    const anchorCommit = commit(f.repo, { [path]: text, [SPEC]: SPEC_TEXT() }, 'freeze');
    const anchor = { commit: anchorCommit, objectivePath: path, objectiveSha256: sha(text) };
    return { ...f, anchor, ledgerFile: () => join(f.stateRoot, 'story-7-1-multiply', 'ledger.json'), gate: (o = {}) => f.gate({ anchor, ...o }) };
  }

  test('an edited intent contract or epic context, uncommitted or committed on C1, is refused', async (t) => {
    const f = v2(t);
    const c1 = f.candidate(BAD_MULTIPLY, f.anchor.commit);
    const r = await f.advance(c1, { anchor: f.anchor });
    assert.equal(r.decision, 'CORRECT', JSON.stringify(r.record?.verdictReasons));
    f.at(c1);
    assert.equal(f.gate({ packet: r.packetPath }).gate, 'OPEN');
    writeFileSync(join(f.repo, SPEC), SPEC_TEXT('Multiply, or add when easier.'));
    assert.match(f.gate({ packet: r.packetPath }).reason, /checkout is not clean/);
    git(f.repo, 'checkout', '-q', '--', SPEC);
    commit(f.repo, { [CONTEXT]: `${CONTEXT_TEXT}Also division.\n` }, 'edit context');
    assert.match(f.gate({ packet: r.packetPath }).reason, /starts from the failed candidate/);
  });

  test('even a ledger forged to CORRECT cannot open a correction from a candidate holding other inputs or another objective', async (t) => {
    const f = v2(t);
    const c1 = f.candidate(BAD_MULTIPLY, f.anchor.commit);
    const r = await f.advance(c1, { anchor: f.anchor });
    const forge = (candidate) => {
      const ledger = JSON.parse(readFileSync(f.ledgerFile(), 'utf8'));
      ledger.versions[0].iterations[0].candidate = candidate; // the last entry: no later hash covers it
      ledger.integrity = sealOf(ledger);
      writeFileSync(f.ledgerFile(), JSON.stringify(ledger, null, 2));
      const p = JSON.parse(readFileSync(r.packetPath, 'utf8'));
      const bytes = `${JSON.stringify({ ...p, candidate }, null, 2)}\n`;
      writeFileSync(r.packetPath, bytes);
      ledger.versions[0].iterations[0].packetSha256 = sha(bytes);
      ledger.integrity = sealOf(ledger);
      writeFileSync(f.ledgerFile(), JSON.stringify(ledger, null, 2));
    };
    const intent = f.candidate({ ...BAD_MULTIPLY, [SPEC]: SPEC_TEXT('Multiply three numbers.') }, f.anchor.commit);
    forge(intent);
    f.at(intent);
    assert.match(f.gate({ packet: r.packetPath }).reason, /does not hold the approved inputs: story spec .* different intent contract/);
    const context = f.candidate({ ...BAD_MULTIPLY, [CONTEXT]: 'other\n' }, f.anchor.commit);
    forge(context);
    f.at(context);
    assert.match(f.gate({ packet: r.packetPath }).reason, /does not hold the approved inputs: epic context/);
    const objective = f.candidate({ ...BAD_MULTIPLY, [f.anchor.objectivePath]: '{}\n' }, f.anchor.commit);
    forge(objective);
    f.at(objective);
    assert.match(f.gate({ packet: r.packetPath }).reason, /does not hold the frozen objective unchanged/);
    const outside = f.candidate(BAD_MULTIPLY, f.baseline);
    forge(outside);
    f.at(outside);
    assert.match(f.gate({ packet: r.packetPath }).reason, /does not descend from the anchor/);
  });
});

describe('the evaluated checkout stays the candidate', () => {
  test('advance with --worktree refuses a checkout that is not the clean candidate, and records nothing', async (t) => {
    const f = fixture(t);
    const c1 = f.candidate(VALID);
    f.at(f.anchor.commit);
    const moved = await f.advance(c1, { worktree: f.repo });
    assert.deepEqual([moved.decision, moved.reason], ['STOP', 'WORKTREE_NOT_QUIESCENT']);
    f.at(c1);
    writeFileSync(join(f.repo, 'sample', 'late-write.txt'), 'a subagent still writing\n');
    const dirty = await f.advance(c1, { worktree: f.repo });
    assert.deepEqual([dirty.decision, dirty.reason], ['STOP', 'WORKTREE_NOT_QUIESCENT']);
    assert.equal(readLedger(f.stateRoot, 'demo-multiply').versions.length, 0, 'nothing recorded');
    git(f.repo, 'clean', '-fdq');
    assert.equal((await f.advance(c1, { worktree: f.repo })).decision, 'CANDIDATE_READY_FOR_ACCEPTANCE');
  });

  test('a checkout that changes during the evaluation stops the loop', async (t) => {
    const f = fixture(t);
    const c1 = f.candidate(VALID);
    // A writer that lands while the checks run: the candidate's own test touches the run's checkout.
    const late = f.candidate({ ...VALID, 'sample/multiply.test.mjs': `${VALID['sample/multiply.test.mjs']}import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(f.repo, 'sample', 'late.txt'))}, 'x');\n` }, f.anchor.commit);
    void c1;
    const r = await f.advance(late, { worktree: f.repo });
    assert.deepEqual([r.decision, r.reason], ['STOP', 'CANDIDATE_CHANGED_DURING_EVALUATION']);
    assert.equal(readLedger(f.stateRoot, 'demo-multiply').versions[0].status, 'stopped');
  });
});

describe('the failure packet a correction receives', () => {
  test('carries the failed assertion whole: actual and expected values, with workspace paths removed', async (t) => {
    const f = fixture(t);
    const { packet } = await failedC1(f);
    const p = JSON.parse(readFileSync(packet, 'utf8'));
    const failure = p.failures.find((x) => x.test === 'multiplies numbers');
    assert.equal(failure.error, 'expected values to be strictly equal:');
    assert.equal(failure.location, 'sample/multiply.test.mjs:4');
    assert.match(failure.excerpt, /actual: 5/);
    assert.match(failure.excerpt, /expected: 6/);
    assert.doesNotMatch(failure.excerpt, /servvia-eval-|\/private\/|\/var\/folders|\/candidate\//);
    assert.deepEqual(Object.keys(p).sort(), ['candidate', 'failures', 'iteration', 'objective', 'remainingCorrections', 'requiredTests', 'rules', 'schema', 'signature', 'surfaces', 'verdict']);
  });
});

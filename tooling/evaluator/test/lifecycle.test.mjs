// The objective lifecycle (schema v2): a draft is planned on the current
// commit from a committed epic context and a story spec, validated with no
// authority, frozen only by the orchestrator (the draft committed unchanged
// with its spec: the anchor), and the gate and the evaluation hold the anchor
// and every candidate to those inputs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { EVALUATOR_ROOT } from '../lib/evaluate.mjs';
import { intentContractSha256, objectiveIdPrefix, validateObjective } from '../lib/objective.mjs';
import { MULTIPLY_TEST, VALID, commit, git, makeFixture, objectiveFor } from './fixture.mjs';

const CONTEXT = '_bmad-output/implementation-artifacts/epic-7-context.md';
const SPEC = '_bmad-output/implementation-artifacts/spec-7-1-multiply.md';
const CONTEXT_TEXT = '# Epic 7 Context: arithmetic\n\nStories multiply numbers.\n';
const SPEC_TEXT = (intent = 'Multiply two numbers.') => `---\ntitle: 'Multiply'\nstatus: 'ready-for-dev'\n---\n\n<intent-contract>\n\n## Intent\n\n**Problem:** ${intent}\n\n</intent-contract>\n\n## Code Map\n\n- \`sample/math.mjs\` -- the module\n`;
const DRAFT_PATH = '_bmad-output/implementation-artifacts/objective-drafts/story-7-1-multiply/v1.objective.json';
const FROZEN_PATH = '_bmad-output/implementation-artifacts/objectives/story-7-1-multiply/v1.objective.json';
const sha = (text) => createHash('sha256').update(text).digest('hex');

function draftFor(baseline, overrides = {}) {
  const { approval, ...legacy } = objectiveFor(baseline);
  void approval;
  return {
    ...legacy,
    schema: 'servvia.objective/v2',
    objectiveId: 'story-7-1-multiply',
    storyId: '7.1',
    inputs: { storySpec: { path: SPEC, intentContractSha256: intentContractSha256(SPEC_TEXT()) }, epicContext: { path: CONTEXT, sha256: sha(CONTEXT_TEXT) } },
    surfaces: { allowed: ['sample/**', SPEC], forbidden: ['restricted/**'] },
    ...overrides,
  };
}

/** A repository whose HEAD holds the committed epic context, with the planned spec on disk (as a no-anchor run leaves it). */
function planned(t) {
  const f = makeFixture({}, { baselineFiles: { [CONTEXT]: CONTEXT_TEXT } });
  t.after(() => f.cleanup());
  const head = git(f.repo, 'rev-parse', 'HEAD');
  writeFileSync(join(f.repo, SPEC), SPEC_TEXT());
  const cli = (...args) => spawnSync(process.execPath, [join(EVALUATOR_ROOT, 'bin', 'loop.mjs'), ...args, '--state-dir', f.stateRoot, '--evidence-dir', f.evidenceRoot], { encoding: 'utf8' });
  const writeDraft = (o) => {
    const text = `${JSON.stringify(o, null, 2)}\n`;
    mkdirSync(dirname(join(f.repo, DRAFT_PATH)), { recursive: true });
    writeFileSync(join(f.repo, DRAFT_PATH), text);
    return text;
  };
  const validate = (o) => { writeDraft(o); const r = cli('validate', '--objective-file', join(f.repo, DRAFT_PATH), '--repo', f.repo); return { status: r.status, out: JSON.parse(r.stdout) }; };
  /** What the orchestrator does to freeze: the draft unchanged, with its spec, committed on the baseline. */
  const freeze = (text, { withSpec = true } = {}) => {
    git(f.repo, 'checkout', '-q', '--detach', head);
    git(f.repo, 'clean', '-fdq', '_bmad-output/implementation-artifacts/objective-drafts');
    const files = { [FROZEN_PATH]: text, [SPEC]: withSpec ? SPEC_TEXT() : null };
    const anchorCommit = commit(f.repo, files, 'freeze');
    if (!withSpec) writeFileSync(join(f.repo, SPEC), SPEC_TEXT());
    return { commit: anchorCommit, objectivePath: FROZEN_PATH, objectiveSha256: sha(text) };
  };
  return { ...f, head, cli, writeDraft, validate, freeze };
}

describe('objective schema v2', () => {
  test('the id convention ties the objective to its story', () => {
    assert.equal(objectiveIdPrefix('12.3a'), 'story-12-3a-');
    assert.equal(objectiveIdPrefix('1.3'), 'story-1-3-');
    assert.equal(objectiveIdPrefix('DEMO-1'), null);
    const base = draftFor('a'.repeat(40));
    assert.deepEqual(validateObjective(base), []);
    assert.match(validateObjective({ ...base, objectiveId: '7-1-multiply' }).join(), /must start with story-7-1-/);
    assert.match(validateObjective({ ...base, approval: { approvedBy: 'orchestrator (pending)', reference: 'x' } }).join(), /no approval field/);
    assert.match(validateObjective({ ...base, inputs: { storySpec: { path: SPEC } } }).join(), /inputs\.storySpec/);
    assert.match(validateObjective({ ...base, inputs: { ...base.inputs, epicContext: { path: 'docs/x.md', sha256: sha('x') } } }).join(), /inputs\.epicContext/);
  });

  test('the intent contract is hashed alone: frontmatter and logs may change, the contract may not', () => {
    const h = intentContractSha256(SPEC_TEXT());
    assert.equal(intentContractSha256(SPEC_TEXT().replace("status: 'ready-for-dev'", "status: 'done'") + '\n## Auto Run Result\n'), h);
    assert.notEqual(intentContractSha256(SPEC_TEXT('Multiply three numbers.')), h);
    assert.equal(intentContractSha256('no contract'), null);
  });
});

describe('draft, freeze, gate and evaluation', () => {
  test('a valid draft is READY FOR FREEZE as a draft with no authority, and names how it is frozen', (t) => {
    const p = planned(t);
    const text = p.writeDraft(draftFor(p.head));
    const r = p.validate(draftFor(p.head));
    assert.equal(r.status, 0, JSON.stringify(r.out));
    assert.equal(r.out.status, 'OBJECTIVE READY FOR FREEZE');
    assert.match(r.out.state, /DRAFT: no authority/);
    assert.equal(r.out.sha256, sha(text));
    assert.match(r.out.freeze, /orchestrator only/);
    const inputs = JSON.parse(p.cli('inputs', '--repo', p.repo, '--spec', SPEC, '--epic-context', CONTEXT).stdout).inputs;
    assert.deepEqual(inputs, draftFor(p.head).inputs);
  });

  test('a draft is not ready on another commit, from an uncommitted or edited epic context, or from a different spec', (t) => {
    const p = planned(t);
    assert.match(p.validate(draftFor(git(p.repo, 'rev-parse', 'HEAD^'))).out.errors.join(), /is not the repository's HEAD/);
    writeFileSync(join(p.repo, CONTEXT), `${CONTEXT_TEXT}edited\n`);
    assert.match(p.validate(draftFor(p.head)).out.errors.join(), /differs from its committed version/);
    writeFileSync(join(p.repo, CONTEXT), CONTEXT_TEXT);
    const other = '_bmad-output/implementation-artifacts/epic-8-context.md';
    writeFileSync(join(p.repo, other), CONTEXT_TEXT);
    assert.match(p.validate(draftFor(p.head, { inputs: { ...draftFor(p.head).inputs, epicContext: { path: other, sha256: sha(CONTEXT_TEXT) } } })).out.errors.join(), /is not committed/);
    writeFileSync(join(p.repo, SPEC), SPEC_TEXT('Multiply three numbers.'));
    assert.match(p.validate(draftFor(p.head)).out.errors.join(), /different intent contract/);
  });

  test('the gate opens, and an evaluation proceeds, only on an anchor holding the approved inputs', async (t) => {
    const p = planned(t);
    const text = p.writeDraft(draftFor(p.head));
    const gate = (a) => JSON.parse(p.cli('gate', '--repo', p.repo, '--anchor-commit', a.commit, '--objective', a.objectivePath, '--objective-sha256', a.objectiveSha256).stdout);
    const noSpec = p.freeze(text, { withSpec: false });
    assert.equal(gate(noSpec).gate, 'CLOSED');
    assert.match(gate(noSpec).reason, /story spec .* is missing/);
    const judged = await p.run(p.candidate(VALID, noSpec.commit), { anchor: noSpec });
    assert.equal(judged.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(judged.findings.some((x) => x.code === 'anchor-inputs-mismatch'));
    const anchor = p.freeze(text);
    assert.equal(gate(anchor).gate, 'OPEN');
    assert.equal(git(p.repo, 'status', '--porcelain'), '', 'an anchored run starts from a clean tree');
  });

  test('the objective\'s own story spec is always an allowed surface: the workflow records its progress there', async (t) => {
    const p = planned(t);
    const anchor = p.freeze(p.writeDraft(draftFor(p.head, { surfaces: { allowed: ['sample/**'], forbidden: ['restricted/**'] } })));
    const r = await p.run(p.candidate({ ...VALID, [SPEC]: SPEC_TEXT().replace("status: 'ready-for-dev'", "status: 'in-review'") }, anchor.commit), { anchor });
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.verdictReasons));
    const other = await p.run(p.candidate({ ...VALID, '_bmad-output/implementation-artifacts/spec-9-9-other.md': 'x\n' }, anchor.commit), { anchor });
    assert.equal(other.verdict, 'NEEDS_REVIEW');
    assert.ok(other.findings.some((x) => x.code === 'outside-allowed-surfaces'));
  });

  test('a candidate may update the spec\'s status, but not its intent contract or the epic context', async (t) => {
    const p = planned(t);
    const anchor = p.freeze(p.writeDraft(draftFor(p.head)));
    const run = (files) => p.run(p.candidate(files, anchor.commit), { anchor });
    const done = await run({ ...VALID, [SPEC]: SPEC_TEXT().replace("status: 'ready-for-dev'", "status: 'done'") + '\n## Auto Run Result\n\nStatus: done\n' });
    assert.equal(done.verdict, 'PASS', JSON.stringify(done.verdictReasons));
    const intent = await run({ ...VALID, [SPEC]: SPEC_TEXT('Multiply, or add when easier.') });
    assert.equal(intent.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(intent.findings.some((x) => x.code === 'intent-contract-modified'));
    const context = await run({ ...VALID, [CONTEXT]: `${CONTEXT_TEXT}Also division.\n` });
    assert.equal(context.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(context.findings.some((x) => x.code === 'governance-modified' && x.path === CONTEXT));
    void MULTIPLY_TEST;
  });
});

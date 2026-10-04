// A new test or expectation-surface file is evidence the checks may pick up.
// It is an INTEGRITY_VIOLATION unless the frozen objective allows it (its
// allowed surfaces, or an approved expectation change); being new never
// exempts it. Authorized additions, and every existing rule, are unchanged.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { staticIntegrity } from '../lib/integrity.mjs';
import { VALID, makeFixture, objectiveFor } from './fixture.mjs';

function fixture(t, overrides) {
  const f = makeFixture(overrides);
  t.after(() => f.cleanup());
  const policy = JSON.parse(readFileSync(join(f.repo, 'tooling/evaluator/policy.json'), 'utf8'));
  /** The static findings for a candidate made of VALID plus `files`, against the objective (with `overrides`). */
  const judge = (files, objectiveOverrides = overrides) => {
    const candidate = f.candidate({ ...VALID, ...files });
    const objective = objectiveFor(f.baseline, objectiveOverrides);
    return staticIntegrity({ repo: f.repo, anchorCommit: f.anchor.commit, candidateCommit: candidate, objective, objectivePath: f.anchor.objectivePath, policy })
      .map((x) => `${x.severity}:${x.code}:${x.path}`);
  };
  return { ...f, judge };
}

const IV_ADDED = (path) => `INTEGRITY_VIOLATION:unauthorized-surface-added:${path}`;

describe('unauthorized new test or expectation-surface files', () => {
  test('1. a new top-level apps/api/test/*.ts file', (t) => {
    assert.deepEqual(fixture(t).judge({ 'apps/api/test/zz-evidence.integration-spec.ts': "it('x', () => {});\n" }), [IV_ADDED('apps/api/test/zz-evidence.integration-spec.ts')]);
    assert.deepEqual(fixture(t).judge({ 'apps/api/test/zz-helper.ts': 'export const x = 1;\n' }), [IV_ADDED('apps/api/test/zz-helper.ts')]);
  });

  test('2. a new nested test file', (t) => {
    assert.deepEqual(fixture(t).judge({ 'apps/api/test/sub/zz.integration-spec.ts': "it('x', () => {});\n" }), [IV_ADDED('apps/api/test/sub/zz.integration-spec.ts')]);
  });

  test('3. a new scripts/*.test.mjs', (t) => {
    assert.deepEqual(fixture(t).judge({ 'scripts/zz-evidence.test.mjs': "import test from 'node:test';\ntest('x', () => {});\n" }), [IV_ADDED('scripts/zz-evidence.test.mjs')]);
  });

  test('4. a new expectation-surface file (fixture, test configuration, CI)', (t) => {
    const f = fixture(t);
    assert.deepEqual(f.judge({ 'apps/api/fixtures/orders.json': '{}\n' }), [IV_ADDED('apps/api/fixtures/orders.json')]);
    assert.deepEqual(f.judge({ 'apps/api/jest-extra.json': '{}\n' }), [IV_ADDED('apps/api/jest-extra.json')]);
    assert.deepEqual(f.judge({ '.github/workflows/extra.yml': 'name: x\n' }), [IV_ADDED('.github/workflows/extra.yml')]);
  });
});

describe('authorized additions and the existing rules are unchanged', () => {
  test('5. a new test file inside the allowed surfaces', (t) => {
    assert.deepEqual(fixture(t).judge({ 'sample/extra.test.mjs': "import test from 'node:test';\ntest('extra', () => {});\n" }), []);
  });

  test('6. a new expectation file inside the allowed surfaces, or authorized as an expectation change', (t) => {
    const f = fixture(t);
    assert.deepEqual(f.judge({ 'sample/fixtures/data.json': '{}\n' }), []);
    const approved = { expectationChanges: [{ path: 'apps/api/test/zz-helper.ts', reason: 'approved new helper' }] };
    assert.deepEqual(f.judge({ 'apps/api/test/zz-helper.ts': 'export const x = 1;\n' }, approved), []);
  });

  test('7. a modified test file keeps its semantics: unauthorized is NEEDS_REVIEW, authorized is accepted, removal is a violation', (t) => {
    const f = fixture(t);
    const edited = { 'sample/math.test.mjs': `${readFileSync(join(f.repo, 'sample/math.test.mjs'), 'utf8')}// note\n` };
    assert.deepEqual(f.judge(edited), ['NEEDS_REVIEW:unapproved-expectation-change:sample/math.test.mjs']);
    assert.deepEqual(f.judge(edited, { expectationChanges: [{ path: 'sample/math.test.mjs', reason: 'approved' }] }), []);
    const fewer = { 'sample/math.test.mjs': "import test from 'node:test';\ntest('adds numbers', () => {});\n" };
    assert.match(f.judge(fewer).join(), /INTEGRITY_VIOLATION:tests-removed:sample\/math\.test\.mjs/);
  });

  test('8. a deleted test file is still a violation', (t) => {
    assert.deepEqual(fixture(t).judge({ 'sample/math.test.mjs': null }), ['INTEGRITY_VIOLATION:test-file-deleted:sample/math.test.mjs']);
  });

  test('9. a forbidden surface still takes precedence, with its own finding', (t) => {
    assert.deepEqual(fixture(t).judge({ 'restricted/zz.test.mjs': "it('x', () => {});\n" }), ['INTEGRITY_VIOLATION:forbidden-surface:restricted/zz.test.mjs']);
  });

  test('10. a check\'s protected configuration is still a violation', (t) => {
    assert.deepEqual(fixture(t).judge({ 'sample/check.config.json': '{}\n' }), ['INTEGRITY_VIOLATION:check-definition-modified:sample/check.config.json']);
  });

  test('a new non-surface file outside the allowed surfaces keeps its NEEDS_REVIEW', (t) => {
    assert.deepEqual(fixture(t).judge({ 'elsewhere/notes.txt': 'x\n' }), ['NEEDS_REVIEW:outside-allowed-surfaces:elsewhere/notes.txt']);
  });

  test('glob edge cases: * stays within a segment, ** spans segments, an exact path allows only itself', (t) => {
    const f = fixture(t);
    const star = { surfaces: { allowed: ['sample/**', 'apps/api/test/*.ts'], forbidden: [] } };
    assert.deepEqual(f.judge({ 'apps/api/test/zz.ts': 'x\n' }, star), []);
    assert.deepEqual(f.judge({ 'apps/api/test/sub/zz.ts': 'x\n' }, star), [IV_ADDED('apps/api/test/sub/zz.ts')]);
    const deep = { surfaces: { allowed: ['sample/**', 'apps/api/test/**'], forbidden: [] } };
    assert.deepEqual(f.judge({ 'apps/api/test/sub/zz.ts': 'x\n' }, deep), []);
    const exact = { surfaces: { allowed: ['sample/**', 'apps/api/test/native.integration-spec.ts'], forbidden: [] } };
    assert.deepEqual(f.judge({ 'apps/api/test/native.integration-spec.ts': "it('x', () => {});\n" }, exact), []);
    assert.deepEqual(f.judge({ 'apps/api/test/native2.integration-spec.ts': "it('x', () => {});\n" }, exact), [IV_ADDED('apps/api/test/native2.integration-spec.ts')]);
  });
});

describe('end to end', () => {
  test('an otherwise-passing candidate with unauthorized new evidence is an INTEGRITY_VIOLATION, and the loop stops', async (t) => {
    const f = fixture(t);
    const candidate = f.candidate({ ...VALID, 'apps/api/test/zz-evidence.integration-spec.ts': "it('x', () => {});\n" });
    const record = await f.run(candidate);
    assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(record.findings.some((x) => x.code === 'unauthorized-surface-added'));
    const r = await f.advance(candidate);
    assert.deepEqual([r.decision, r.reason], ['STOP', 'INTEGRITY_VIOLATION']);
  });
});

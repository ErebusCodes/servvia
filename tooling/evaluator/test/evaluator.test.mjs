// Tests of the Servvia evaluator itself. Run: node --test tooling/evaluator/test/
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globToRegExp, matches } from '../lib/glob.mjs';
import { redact, redactDeep, secretValues, REDACTED } from '../lib/redact.mjs';
import { countTests, testNames } from '../lib/integrity.mjs';
import { computeVerdict } from '../lib/verdict.mjs';
import { validateObjective } from '../lib/objective.mjs';
import { EVALUATOR_ROOT } from '../lib/evaluate.mjs';
import { MULTIPLY_IMPL, MULTIPLY_TEST, OBJECTIVE_PATH, VALID, git, makeFixture, objectiveFor } from './fixture.mjs';

const codes = (record) => record.findings.map((f) => f.code);

describe('pure functions', () => {
  test('glob matching', () => {
    assert.ok(matches('apps/api/test/x.integration-spec.ts', ['**/*.integration-spec.ts']));
    assert.ok(matches('tooling/evaluator/lib/a.mjs', ['tooling/evaluator/**']));
    assert.ok(matches('fileRestructure.md', ['fileRestructure.md']));
    assert.ok(!matches('apps/api/src/a.ts', ['**/*.spec.ts']));
    assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
    assert.ok(!globToRegExp('src/*.ts').test('src/x/a.ts'));
  });

  test('redaction removes credentials by shape and by value', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl';
    const text = `token ${jwt} Authorization: Bearer abc.def-123 password=hunter2222 {"pin":"4321"} `
      + 'owner@example.com postgresql://u:topsecret@h/db cookie: sid=xyz '
      + '2f1c4c8e-1b9a-4c1e-9d3e-1a2b3c4d5e6f.abcdefghijklmnopqrstuv my-env-secret-value';
    const out = redact(text, secretValues({ JWT_ACCESS_SECRET: 'my-env-secret-value', PORT: '3000' }));
    for (const leaked of [jwt, 'abc.def-123', 'hunter2222', '"4321"', 'owner@example.com', 'topsecret', 'sid=xyz', 'abcdefghijklmnopqrstuv', 'my-env-secret-value']) {
      assert.ok(!out.includes(leaked), `leaked ${leaked}: ${out}`);
    }
    assert.ok(out.includes(REDACTED));
    assert.deepEqual(redactDeep({ a: ['password=x1'], n: 3 }), { a: [`password=${REDACTED}`], n: 3 });
  });

  test('test names are extracted in JS and Go', () => {
    assert.deepEqual(testNames('a.test.mjs', "test('adds', () => {});\nit(\"it's ok\", () => {});\ndescribe('x', () => {});"), ['adds', "it's ok"]);
    assert.deepEqual(testNames('a_test.go', 'func TestA(t *testing.T) {}\nfunc helper() {}\nfunc TestB(t *testing.T) {}'), ['TestA', 'TestB']);
  });

  test('test declarations are counted in JS and Go', () => {
    assert.equal(countTests('a.test.mjs', "test('a', () => {});\nit('b', () => {});\ndescribe('c', () => {});"), 2);
    assert.equal(countTests('a_test.go', 'func TestA(t *testing.T) {}\nfunc TestB(t *testing.T) {}\nfunc helper() {}'), 2);
  });

  test('verdict precedence', () => {
    const f = (...s) => s.map((severity) => ({ severity }));
    assert.equal(computeVerdict([]), 'PASS');
    assert.equal(computeVerdict(f('INFO')), 'PASS');
    assert.equal(computeVerdict(f('NEEDS_REVIEW', 'FAIL')), 'FAIL');
    assert.equal(computeVerdict(f('FAIL', 'HARNESS_ERROR')), 'HARNESS_ERROR');
    assert.equal(computeVerdict(f('HARNESS_ERROR', 'INTEGRITY_VIOLATION', 'FAIL')), 'INTEGRITY_VIOLATION');
  });

  test('objective validation', () => {
    assert.deepEqual(validateObjective(objectiveFor('a'.repeat(40))), []);
    const noException = objectiveFor('a'.repeat(40), {
      requiredTests: [{ id: 'RT', check: 'unit', name: 'x', expectBaselineFailure: false }],
    });
    assert.match(validateObjective(noException).join(' '), /baselineException/);
    assert.ok(validateObjective({ schema: 'other' }).length > 5);
  });
});

describe('evaluation of candidates against a frozen objective', () => {
  let fx;
  before(() => { fx = makeFixture(); });
  after(() => fx.cleanup());

  test('a valid candidate passes, with a compact redacted record', async () => {
    const record = await fx.run(fx.candidate(VALID));
    assert.equal(record.verdict, 'PASS', JSON.stringify(record.findings));
    assert.equal(record.checks[0].counts.passed, 3);
    assert.equal(record.checks[0].baseline.counts.failed > 0 || record.checks[0].baseline.exitCode !== 0, true);
    assert.equal(record.evaluator.authentic, true);
    assert.match(record.objective.sha256, /^[0-9a-f]{64}$/);
    assert.ok(record.diff.shortStat.includes('2 files changed'));
    const saved = JSON.parse(readFileSync(join(record.evidence.dir, 'record.json'), 'utf8'));
    assert.equal(saved.verdict, 'PASS');
  });

  test('an objective that does not hash to the approved anchor is an integrity violation', async () => {
    const record = await fx.run(fx.candidate(VALID), { anchor: { ...fx.anchor, objectiveSha256: 'f'.repeat(64) } });
    assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
    assert.deepEqual(codes(record), ['objective-anchor-mismatch']);
  });

  test('a candidate that does not descend from the anchor is an integrity violation', async () => {
    const record = await fx.run(fx.candidate(VALID, fx.baseline));
    assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(codes(record).includes('candidate-not-descendant'));
  });

  test('changing the evaluator, the objective, a forbidden surface or a check configuration is an integrity violation', async () => {
    for (const [files, code] of [
      [{ 'tooling/evaluator/policy.json': '{}' }, 'governance-modified'],
      [{ [OBJECTIVE_PATH]: '{"weakened":true}' }, 'objective-modified'],
      [{ 'restricted/area.txt': 'x' }, 'forbidden-surface'],
      [{ 'sample/check.config.json': '{}' }, 'check-definition-modified'],
    ]) {
      const record = await fx.run(fx.candidate({ ...VALID, ...files }));
      assert.equal(record.verdict, 'INTEGRITY_VIOLATION', code);
      assert.ok(codes(record).includes(code), `${code}: ${codes(record)}`);
      assert.equal(record.checks, undefined, 'no check runs once the candidate is known to have tampered');
    }
  });

  test('a deleted test file, removed tests and an added skip are integrity violations', async () => {
    const removed = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.mjs';\ntest('adds numbers', () => assert.equal(add(2, 3), 5));\n";
    for (const [files, code] of [
      [{ 'sample/math.test.mjs': null }, 'test-file-deleted'],
      [{ 'sample/math.test.mjs': removed }, 'tests-removed'],
      [{ 'sample/multiply.test.mjs': `${MULTIPLY_TEST}test.skip('multiplies zero', () => {});\n` }, 'skip-or-focus-added'],
      [{ 'sample/multiply.test.mjs': `${MULTIPLY_TEST}test('product sign', { skip: true }, () => {});\n` }, 'skip-or-focus-added'],
    ]) {
      const record = await fx.run(fx.candidate({ ...VALID, ...files }));
      assert.equal(record.verdict, 'INTEGRITY_VIOLATION', code);
      assert.ok(codes(record).includes(code), `${code}: ${codes(record)}`);
    }
  });

  test('a modified existing test needs review unless the objective approved the change', async () => {
    const modified = readFileSync(join(fx.repo, 'sample/math.test.mjs'), 'utf8').replace('add(-2, -3), -5', 'add(-2, -2), -4');
    const unapproved = await fx.run(fx.candidate({ ...VALID, 'sample/math.test.mjs': modified }));
    assert.equal(unapproved.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(unapproved).includes('unapproved-expectation-change'));

    const approvedFx = makeFixture({ expectationChanges: [{ path: 'sample/math.test.mjs', reason: 'negative case restated', requirementRef: 'DEMO-REQ-1' }] });
    try {
      const approved = await approvedFx.run(approvedFx.candidate({ ...VALID, 'sample/math.test.mjs': modified }));
      assert.equal(approved.verdict, 'PASS', JSON.stringify(approved.findings));
    } finally {
      approvedFx.cleanup();
    }
  });

  test('authorizing changes to a test file never authorizes removing its tests', async () => {
    const oneLeft = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './math.mjs';\ntest('adds numbers', () => assert.equal(add(2, 3), 5));\n";
    const authorized = makeFixture({ expectationChanges: [{ path: 'sample/math.test.mjs', reason: 'restated' }] });
    try {
      const record = await authorized.run(authorized.candidate({ ...VALID, 'sample/math.test.mjs': oneLeft }));
      assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
      assert.match(record.findings.find((f) => f.code === 'tests-removed').detail, /adds negatives/);
    } finally {
      authorized.cleanup();
    }
    const retiring = makeFixture({ expectationChanges: [{ path: 'sample/math.test.mjs', reason: 'negative case retired', retiresTests: ['adds negatives'] }], checks: [{ ...objectiveFor('x').checks[0], minTests: 2 }] });
    try {
      const record = await retiring.run(retiring.candidate({ ...VALID, 'sample/math.test.mjs': oneLeft }));
      assert.equal(record.verdict, 'PASS', JSON.stringify(record.findings));
    } finally {
      retiring.cleanup();
    }
  });

  test('a new lint or type suppression needs review', async () => {
    const record = await fx.run(fx.candidate({ ...VALID, 'sample/math.mjs': `// eslint-disable-next-line\n${MULTIPLY_IMPL}` }));
    assert.equal(record.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(record).includes('suppression-added'));
  });

  test('a behavioural regression fails', async () => {
    const record = await fx.run(fx.candidate({ ...VALID, 'sample/math.mjs': 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a + b;\n' }));
    assert.equal(record.verdict, 'FAIL');
    assert.ok(codes(record).includes('check-failed'));
    assert.ok(codes(record).includes('required-test-failed'));
  });

  test('a required test that also passes on the baseline needs review', async () => {
    const record = await fx.run(fx.candidate({
      ...VALID,
      'sample/multiply.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('multiplies numbers', () => assert.equal(2 * 3, 6));\n",
    }));
    assert.equal(record.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(record).includes('required-test-passes-on-baseline'));
  });

  test('failing output is redacted in the evidence, including environment secrets', async () => {
    const leaky = `import test from 'node:test';
import assert from 'node:assert/strict';
import { multiply } from './math.mjs';
test('multiplies numbers', () => assert.equal(multiply(2, 3), 6));
test('leaks', () => {
  console.log('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl password=hunter2222 owner@example.com');
  assert.fail('secret ' + process.env.JWT_ACCESS_SECRET + ' and ' + process.env.SEED_OWNER_PASSWORD);
});
`;
    const record = await fx.run(fx.candidate({ ...VALID, 'sample/multiply.test.mjs': leaky }));
    assert.equal(record.verdict, 'FAIL');
    const files = readdirSync(record.evidence.dir);
    assert.ok(files.includes('record.json') && files.some((f) => f.startsWith('check-unit')));
    const all = files.map((f) => readFileSync(join(record.evidence.dir, f), 'utf8')).join('\n');
    for (const leaked of ['eyJhbGciOiJIUzI1NiJ9', 'hunter2222', 'owner@example.com', 'ci-only-access-secret-at-least-32-characters', 'ci-only-seed-password-not-a-real-secret']) {
      assert.ok(!all.includes(leaked), `evidence leaked ${leaked}`);
    }
    assert.ok(record.excerpts.some((e) => e.test === 'leaks'));
  });

  test('a mandatory check that executes too few tests is an integrity violation', async () => {
    const emptied = makeFixture({ expectationChanges: [{ path: 'sample/*.test.mjs', reason: 'fixture: tests restructured', retiresTests: ['adds numbers', 'adds negatives'] }] });
    try {
      const empty = "import test from 'node:test';\n";
      const record = await emptied.run(emptied.candidate({ ...VALID, 'sample/math.test.mjs': empty, 'sample/multiply.test.mjs': empty }));
      assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
      assert.ok(codes(record).includes('too-few-tests'));
    } finally {
      emptied.cleanup();
    }
  });

  test('a check that fails, then passes on retry, is not a clean pass without an approved flake policy', async () => {
    const flaky = `${MULTIPLY_TEST}import { existsSync, writeFileSync } from 'node:fs';
test('sometimes', () => { if (!existsSync('.attempt')) { writeFileSync('.attempt', '1'); assert.fail('first attempt'); } });
`.replace("import assert from 'node:assert/strict';\n", "import assert from 'node:assert/strict';\n");
    const record = await fx.run(fx.candidate({ ...VALID, 'sample/multiply.test.mjs': flaky }));
    assert.equal(record.verdict, 'NEEDS_REVIEW', JSON.stringify(record.findings));
    assert.ok(codes(record).includes('flaky-check'));
    assert.equal(record.checks[0].flaky, true);

    const tolerant = makeFixture({ checks: [{ ...objectiveFor('x').checks[0], flakePolicy: { approvedRetries: 1 } }] });
    try {
      const ok = await tolerant.run(tolerant.candidate({ ...VALID, 'sample/multiply.test.mjs': flaky }));
      assert.equal(ok.verdict, 'PASS', JSON.stringify(ok.findings));
      assert.ok(codes(ok).includes('flake-within-approved-policy'));
    } finally {
      tolerant.cleanup();
    }
  });

  test('an evaluator that differs from the anchor, an invalid objective or a missing tool is a harness error', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'servvia-eval-copy-'));
    try {
      cpSync(EVALUATOR_ROOT, copy, { recursive: true });
      writeFileSync(join(copy, 'lib', 'verdict.mjs'), 'export const computeVerdict = () => "PASS";\n');
      const tampered = await fx.run(fx.candidate(VALID), { evaluatorRoot: copy });
      assert.equal(tampered.verdict, 'HARNESS_ERROR');
      assert.ok(codes(tampered).includes('evaluator-not-authentic'));
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }

    const invalid = makeFixture({ acceptanceCriteria: [] });
    try {
      const record = await invalid.run(invalid.candidate(VALID));
      assert.equal(record.verdict, 'HARNESS_ERROR');
      assert.ok(codes(record).includes('objective-invalid'));
    } finally {
      invalid.cleanup();
    }

    const noTool = makeFixture({ checks: [{ id: 'unit', category: 'unit', runner: 'go-test', args: ['./...'] }], requiredTests: [] });
    try {
      const record = await noTool.run(noTool.candidate(VALID), { tools: { goRoot: '/nonexistent/go' } });
      assert.equal(record.verdict, 'HARNESS_ERROR', JSON.stringify(record.findings));
    } finally {
      noTool.cleanup();
    }
  });

  test('a failing command check fails', async () => {
    const cmd = makeFixture({ checks: [{ id: 'build', category: 'build', runner: 'command', args: ['node', '-e', 'process.exit(3)'] }], requiredTests: [] });
    try {
      const record = await cmd.run(cmd.candidate(VALID));
      assert.equal(record.verdict, 'FAIL');
      assert.equal(record.checks[0].exitCode, 3);
    } finally {
      cmd.cleanup();
    }
  });

  test('an objective whose baseline is not the anchor commit parent is an integrity violation', async () => {
    const wrong = makeFixture({ baseline: '0'.repeat(40) });
    try {
      const record = await wrong.run(wrong.candidate(VALID));
      assert.equal(record.verdict, 'INTEGRITY_VIOLATION');
      assert.ok(codes(record).includes('wrong-baseline'));
    } finally {
      wrong.cleanup();
    }
  });

  test('the working tree never matters: an uncommitted edit in the repository is not evaluated', async () => {
    const candidate = fx.candidate(VALID);
    writeFileSync(join(fx.repo, 'sample/math.mjs'), 'export const multiply = () => 0;\n');
    try {
      const record = await fx.run(candidate);
      assert.equal(record.verdict, 'PASS');
    } finally {
      git(fx.repo, 'checkout', '--', 'sample/math.mjs');
    }
  });
});

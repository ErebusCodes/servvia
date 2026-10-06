// Baseline evidence for required tests declared expectBaselineFailure: the
// record names, per test, whether it failed, did not build, did not run, was
// not found or passed, with a redacted excerpt and location, not counts alone.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineState } from '../lib/baseline.mjs';
import { parseGoTestJson } from '../lib/runners.mjs';
import { MULTIPLY_TEST, VALID, makeFixture } from './fixture.mjs';

const rt = (name, files) => ({ id: 'RT', check: 'c', name, files, expectBaselineFailure: true });
const run = (tests, extra = {}) => ({ tests, exitCode: 1, ...extra });

describe('baselineState', () => {
  test('a test that ran: failed, skipped or passed', () => {
    assert.equal(baselineState(rt('adds'), run([{ name: 'adds', status: 'failed', message: 'x' }])).state, 'FAILED');
    assert.equal(baselineState(rt('adds'), run([{ name: 'adds', status: 'failed' }])).failureClass, 'behavioral');
    assert.equal(baselineState(rt('adds'), run([{ name: 'adds', status: 'skipped' }])).state, 'SKIPPED');
    assert.equal(baselineState(rt('adds'), run([{ name: 'adds', status: 'passed' }])).state, 'PASSED_UNEXPECTEDLY');
  });

  test('a test whose package did not compile did not run: NOT_RUN_BUILD_FAILURE, from go test -json', () => {
    const stdout = [
      { ImportPath: 'servvia/core/internal/timeouts [servvia/core/internal/timeouts.test]', Action: 'build-output', Output: '# servvia/core/internal/timeouts [servvia/core/internal/timeouts.test]\n' },
      { ImportPath: 'servvia/core/internal/timeouts [servvia/core/internal/timeouts.test]', Action: 'build-output', Output: 'internal/timeouts/timeouts_test.go:12:9: undefined: config.StatementTimeout\n' },
      { ImportPath: 'servvia/core/internal/timeouts [servvia/core/internal/timeouts.test]', Action: 'build-fail' },
      { Action: 'fail', Package: 'servvia/core/internal/timeouts', FailedBuild: 'servvia/core/internal/timeouts [servvia/core/internal/timeouts.test]' },
      { Action: 'run', Package: 'servvia/core/internal/config', Test: 'TestLoadTimeouts' },
      { Action: 'output', Package: 'servvia/core/internal/config', Test: 'TestLoadTimeouts', Output: '    config_test.go:30: got 0, want 5s\n' },
      { Action: 'fail', Package: 'servvia/core/internal/config', Test: 'TestLoadTimeouts' },
      { Action: 'fail', Package: 'servvia/core/internal/config' },
    ].map((e) => JSON.stringify(e)).join('\n');
    const { tests } = parseGoTestJson(stdout, { module: 'servvia/core', cwdInRepo: 'services/core' });
    const build = tests.find((t) => t.kind === 'build');
    assert.equal(build.dir, 'services/core/internal/timeouts');
    assert.match(build.message, /^services\/core\/internal\/timeouts\/timeouts_test\.go:12:9: undefined: config\.StatementTimeout/);
    const r = run(tests);
    const notBuilt = baselineState(rt('TestStatementTimeout', ['services/core/internal/timeouts/timeouts_test.go']), r);
    assert.deepEqual([notBuilt.state, notBuilt.failureClass], ['NOT_RUN_BUILD_FAILURE', 'build']);
    assert.equal(notBuilt.related[0].package, 'servvia/core/internal/timeouts');
    assert.equal(baselineState(rt('TestLoadTimeouts', ['services/core/internal/config/config_test.go']), r).state, 'FAILED');
    // A test in a package that built, but that never reported: not found, and not explained by another package's build.
    assert.equal(baselineState(rt('TestNoSuchTest', ['services/core/internal/config/config_test.go']), r).state, 'NOT_FOUND');
  });

  test('a whole-check build failure, a failed suite or file, a failed package, a timeout', () => {
    const goWhole = run([{ name: 'go test (build failed)', status: 'failed', kind: 'build', message: 'go: cannot find main module' }], { buildFailed: true });
    assert.equal(baselineState(rt('TestX', ['a/x_test.go']), goWhole).state, 'NOT_RUN_BUILD_FAILURE');
    const dotnet = run([{ name: 'dotnet build (failed)', status: 'failed', kind: 'build', message: 'error CS0103' }], { buildFailed: true });
    assert.equal(baselineState(rt('Ns.Tests.When_X', ['tests/XTests.cs']), dotnet).state, 'NOT_RUN_BUILD_FAILURE');
    const jest = run([{ name: '/w/baseline/apps/api/src/k.spec.ts (suite failed to run)', status: 'failed', kind: 'build', file: '/w/baseline/apps/api/src/k.spec.ts', message: "TS2307: Cannot find module './k.guard'" }]);
    assert.equal(baselineState(rt('k answers 404', ['apps/api/src/k.spec.ts']), jest).state, 'NOT_RUN_BUILD_FAILURE');
    assert.equal(baselineState(rt('other', ['apps/api/src/other.spec.ts']), jest).state, 'NOT_FOUND', 'another suite\'s compile error explains nothing');
    const pkg = run([{ name: 'm/p (package failed)', status: 'failed', kind: 'package', dir: 'svc/p', message: '' }]);
    assert.deepEqual(Object.values((({ state, failureClass }) => ({ state, failureClass }))(baselineState(rt('TestP', ['svc/p/p_test.go']), pkg))), ['NOT_RUN_PACKAGE_FAILURE', 'behavioral']);
    assert.equal(baselineState(rt('TestP', ['svc/p/p_test.go']), run([], { timedOut: true })).state, 'NOT_RUN_TIMEOUT');
  });

  test('setup and harness failures', () => {
    assert.equal(baselineState(rt('x'), undefined, { setupFailed: true }).state, 'NOT_RUN_SETUP_FAILURE');
    assert.equal(baselineState(rt('x'), undefined).state, 'NOT_RUN_HARNESS_ERROR');
    assert.equal(baselineState(rt('x'), run([], { harnessError: 'jest wrote no result file' })).state, 'NOT_RUN_HARNESS_ERROR');
  });
});

describe('baseline evidence in the evaluation record', () => {
  const evaluated = async (t, files, overrides, options) => {
    const f = makeFixture(overrides, options);
    t.after(() => f.cleanup());
    const record = await f.run(f.candidate(files));
    return { f, record, baseline: record.requiredTests[0].baseline, persisted: JSON.parse(readFileSync(join(record.evidence.dir, 'record.json'), 'utf8')) };
  };

  test('a required test whose file does not load on the baseline: NOT_RUN_BUILD_FAILURE, with the loader\'s error and location', async (t) => {
    const { record, baseline, persisted } = await evaluated(t, VALID);
    assert.equal(record.verdict, 'PASS');
    assert.deepEqual([baseline.state, baseline.failureClass, baseline.satisfiesExpectedBaselineFailure], ['NOT_RUN_BUILD_FAILURE', 'build', true]);
    assert.match(baseline.excerpt, /does not provide an export named 'multiply'/);
    assert.equal(baseline.location, 'sample/multiply.test.mjs:3');
    assert.deepEqual(baseline.explainedBy, [{ name: 'sample/multiply.test.mjs', kind: 'build' }]);
    assert.doesNotMatch(baseline.excerpt, /servvia-eval-|\/private\/|\/var\/folders/);
    assert.deepEqual(persisted.requiredTests[0].baseline, baseline);
    assert.ok(existsSync(join(record.evidence.dir, 'baseline-check-unit.log')));
    assert.ok(record.evidenceFiles.some((x) => x.name === 'baseline-check-unit.log'));
  });

  test('a required test that runs and fails on the baseline: FAILED (behavioral), with its assertion', async (t) => {
    const { record, baseline } = await evaluated(t, VALID, {}, { baselineFiles: { 'sample/math.mjs': 'export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a + b;\n' } });
    assert.equal(record.verdict, 'PASS');
    assert.deepEqual([baseline.state, baseline.failureClass], ['FAILED', 'behavioral']);
    assert.deepEqual(baseline.observed, [{ name: 'multiplies numbers', status: 'failed' }]);
    assert.match(baseline.excerpt, /5 !== 6|Expected values to be strictly equal/);
  });

  test('a required test that passes on the baseline: PASSED_UNEXPECTEDLY, which is the verdict\'s NEEDS_REVIEW', async (t) => {
    const { record, baseline } = await evaluated(t, { 'sample/multiply.test.mjs': MULTIPLY_TEST }, {}, { baselineFiles: { 'sample/math.mjs': VALID['sample/math.mjs'] } });
    assert.equal(baseline.state, 'PASSED_UNEXPECTEDLY');
    assert.equal(baseline.satisfiesExpectedBaselineFailure, false);
    assert.ok(record.findings.some((x) => x.code === 'required-test-passes-on-baseline'));
  });

  test('baseline setup that fails: NOT_RUN_SETUP_FAILURE, with the step and its output', async (t) => {
    const setup = [{ id: 'prepare', run: ['node', 'sample/prepare.mjs'] }];
    const { record, baseline } = await evaluated(t, { ...VALID, 'sample/prepare.mjs': 'console.log("prepared")\n' }, { setup });
    assert.equal(record.verdict, 'HARNESS_ERROR');
    assert.deepEqual([baseline.state, baseline.failureClass, baseline.detail], ['NOT_RUN_SETUP_FAILURE', 'setup', 'baseline setup step prepare exited 1']);
    assert.match(baseline.excerpt, /Cannot find module/);
    assert.deepEqual(record.baselineSetup, [{ id: 'prepare', exitCode: 1 }]);
  });

  test('a required test not expected to fail on the baseline has no baseline evidence', async (t) => {
    const { record } = await evaluated(t, VALID, { requiredTests: [{ id: 'RT-1', check: 'unit', name: 'adds numbers', expectBaselineFailure: false, baselineException: 'regression-characterization' }] });
    assert.equal(record.requiredTests[0].baseline, null);
  });
});

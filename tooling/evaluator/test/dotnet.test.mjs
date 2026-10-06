// Tests of the dotnet-test runner and C# test identity. The runner is
// exercised end to end through evaluate() with a stand-in dotnet
// (fake-dotnet.mjs) that writes real-format TRX, so no .NET SDK is needed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTrx } from '../lib/runners.mjs';
import { countTests, testNames } from '../lib/integrity.mjs';
import { locationOf } from '../lib/packet.mjs';
import { validateObjective } from '../lib/objective.mjs';
import { matches } from '../lib/glob.mjs';
import { evaluateCheck } from '../lib/verdict.mjs';
import { EVALUATOR_ROOT } from '../lib/evaluate.mjs';
import { makeFixture } from './fixture.mjs';

const policy = JSON.parse(readFileSync(join(EVALUATOR_ROOT, 'policy.json'), 'utf8'));
const codes = (record) => record.findings.map((f) => f.code);
const SECRET = JSON.parse(readFileSync(join(EVALUATOR_ROOT, 'env/evaluation.json'), 'utf8')).variables.JWT_ACCESS_SECRET;

const CALC_TESTS = `namespace Sample.Tests;

public class CalcTests
{
    [Fact]
    public void Adds()
    {
        // requires: ADD
    }

    [Theory]
    [InlineData("a]b")] // data that contains a bracket
    public void AddsMany()
    {
        // requires: ADD
    }
}
`;
const OTHER_TESTS = `namespace Sample.Tests;

public class OtherTests
{
    [Fact]
    public void Other()
    {
        // requires: ADD
    }
}
`;
const withMultiplyTest = (extra = '') => CALC_TESTS.replace(/\n}\n$/, `
    [Fact]
    public void Multiplies()
    {
        // requires: MUL
    }
${extra}}
`);

const BASELINE = {
  'apps/dotnet/Sample.slnx': '<Solution />\n',
  'apps/dotnet/Calc/Calc.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
  'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n// ADD\n',
  'apps/dotnet/Calc.Tests/Calc.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
  'apps/dotnet/Calc.Tests/CalcTests.cs': CALC_TESTS,
  'apps/dotnet/Other.Tests/Other.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
  'apps/dotnet/Other.Tests/OtherTests.cs': OTHER_TESTS,
  'apps/dotnet-empty/Empty.Tests/Empty.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
};
const VALID = { 'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n// ADD\n// MUL\n', 'apps/dotnet/Calc.Tests/CalcTests.cs': withMultiplyTest() };

const OBJECTIVE = {
  checks: [{ id: 'dotnet-unit', category: 'unit', runner: 'dotnet-test', cwd: 'apps/dotnet', args: ['Sample.slnx', '-c', 'Release'], minTests: 4 }],
  requiredTests: [{ id: 'RT-1', check: 'dotnet-unit', name: 'Sample.Tests.CalcTests.Multiplies', files: ['apps/dotnet/Calc.Tests/CalcTests.cs'], expectBaselineFailure: true }],
  surfaces: { allowed: ['apps/dotnet/**'], forbidden: ['apps/dotnet/Other.Tests/**/*.csproj'] },
  expectationChanges: [{ path: 'apps/dotnet/Calc.Tests/CalcTests.cs', reason: 'adds the multiply test' }],
};

/** A directory holding an executable `dotnet` that runs the stand-in. */
function fakeDotnetRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'servvia-fake-dotnet-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'dotnet'), `#!/bin/sh\nexec "${process.execPath}" "${join(EVALUATOR_ROOT, 'test', 'fake-dotnet.mjs')}" "$@"\n`);
  chmodSync(join(dir, 'dotnet'), 0o755);
  return dir;
}

function dotnetFixture(t, overrides = {}) {
  const f = makeFixture({ ...OBJECTIVE, ...overrides }, { baselineFiles: BASELINE });
  t.after(() => f.cleanup());
  const dotnetRoot = fakeDotnetRoot(t);
  const tools = { dotnetRoot };
  return {
    ...f,
    tools,
    run: (candidate, extra = {}) => f.run(candidate, { tools, ...extra }),
    advance: (candidate, extra = {}) => f.advance(candidate, { tools, ...extra }),
  };
}

const TRX = (results, total = results.length) => `﻿<?xml version="1.0" encoding="utf-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>
${results.join('\n')}
</Results><ResultSummary><Counters total="${total}" passed="0" failed="0" /></ResultSummary></TestRun>`;

describe('TRX parsing and C# test identity', () => {
  test('passed, failed and not-run results, with entities, messages and repository locations', () => {
    const root = '/tmp/ws/candidate';
    const xml = TRX([
      '<UnitTestResult testName="A.B.Passes(x: &quot;1&quot;)" outcome="Passed" />',
      `<UnitTestResult testName="A.B.Fails" outcome="Failed"><Output><ErrorInfo><Message>Expected: &quot;IPS.exe&quot; &amp; more</Message><StackTrace>   at A.B.Fails() in ${root}/apps/x/BTests.cs:line 12</StackTrace></ErrorInfo></Output></UnitTestResult>`,
      '<UnitTestResult testName="A.B.Later" outcome="NotExecuted" />',
      '<UnitTestResult testName="A.B.Crashed" outcome="Error" />',
    ]);
    const { tests, total } = parseTrx(xml, { roots: [root] });
    assert.equal(total, 4);
    assert.deepEqual(tests.map((x) => [x.name, x.status]), [['A.B.Passes(x: "1")', 'passed'], ['A.B.Fails', 'failed'], ['A.B.Later', 'skipped'], ['A.B.Crashed', 'failed']]);
    assert.match(tests[1].message, /Expected: "IPS\.exe" & more/);
    assert.match(tests[1].message, / in apps\/x\/BTests\.cs:12$/);
    assert.equal(locationOf(tests[1].message), 'apps/x/BTests.cs:12');
    assert.deepEqual(parseTrx(TRX([])), { tests: [], total: 0 });
  });

  test('xUnit test methods are named and counted, including theories with data attributes and comments', () => {
    assert.deepEqual(testNames('X/CalcTests.cs', CALC_TESTS), ['Adds', 'AddsMany']);
    assert.equal(countTests('X/CalcTests.cs', CALC_TESTS), 2);
    const async = '[Fact(DisplayName = "x")]\n    public async Task Waits() { }\n    [SkippableFact] public void Maybe() { }';
    assert.deepEqual(testNames('X/ATests.cs', async), ['Waits', 'Maybe']);
  });

  test('the policy treats C# test files, test configuration, skips and suppressions as protected', () => {
    const re = (list) => list.map((p) => new RegExp(p));
    const skip = (line) => re(policy.skipPatterns).some((r) => r.test(line));
    const suppression = (line) => re(policy.suppressionPatterns).some((r) => r.test(line));
    assert.ok(skip('    [Fact(Skip = "later")]') && skip('[Theory(Skip="x")]') && skip('Skip.If(true);') && skip('Assert.Skip("no");'));
    assert.ok(!skip('    [Fact]') && !skip('var skipped = Skip(3);'));
    assert.ok(suppression('#pragma warning disable CS0168') && suppression('[SuppressMessage("x", "y")]'));
    assert.ok(matches('apps/v/tests/T/NativeTests.cs', policy.testFiles));
    assert.ok(matches('apps/v/V.slnx', policy.expectationSurfaces) && matches('apps/v/t/T.csproj', policy.expectationSurfaces));
  });

  test('a check that did not build fails; its count is not judged against the floor', () => {
    const run = (buildFailed) => ({ exitCode: 1, buildFailed, tests: [{ name: 'dotnet build (failed)', status: 'failed' }], counts: { total: 1, passed: 0, failed: 1, skipped: 0 } });
    const check = { id: 'c', runner: 'dotnet-test', minTests: 500 };
    assert.deepEqual(evaluateCheck(check, run(true), {}).map((x) => x.severity), ['FAIL']);
    assert.deepEqual(evaluateCheck(check, run(false), {}).map((x) => x.severity), ['INTEGRITY_VIOLATION', 'FAIL']);
  });

  test('an objective may use the dotnet-test runner', () => {
    assert.deepEqual(validateObjective({ ...makeFixtureObjective(), checks: OBJECTIVE.checks, requiredTests: OBJECTIVE.requiredTests }), []);
  });
});

function makeFixtureObjective() {
  return {
    schema: 'servvia.objective/v1', objectiveId: 'demo', storyId: 'D-1', version: 1, title: 't', baseline: 'a'.repeat(40),
    requirementRefs: ['r'], acceptanceCriteria: [{ id: 'AC-1', given: 'g', when: 'w', then: 't' }],
    approval: { approvedBy: 'o', reference: 'r' }, completionCriteria: ['c'], surfaces: { allowed: [], forbidden: [] },
  };
}

describe('the dotnet-test runner', () => {
  test('a valid candidate passes: named results from every test assembly, the baseline failure proven', async (t) => {
    const f = dotnetFixture(t);
    const r = await f.run(f.candidate(VALID));
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.verdictReasons));
    const check = r.checks.find((c) => c.id === 'dotnet-unit');
    assert.deepEqual(check.counts, { total: 4, passed: 4, failed: 0, skipped: 0 });
    assert.equal(r.environment.dotnet, '8.0.0-fake');
    for (const name of ['DOTNET_ROOT', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'MSBUILDDISABLENODEREUSE']) assert.ok(r.environment.variables.includes(name), name);
  });

  test('a failing named test fails, with a repository location the failure packet and signature use', async (t) => {
    const f = dotnetFixture(t);
    const c1 = f.candidate({ ...VALID, 'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n// MUL\n' });
    const r = await f.advance(c1);
    assert.equal(r.decision, 'CORRECT');
    const failure = r.packet.failures.find((x) => x.test === 'Sample.Tests.CalcTests.Adds');
    assert.ok(failure, JSON.stringify(r.packet.failures));
    assert.equal(failure.location, 'apps/dotnet/Calc.Tests/CalcTests.cs:6');
    assert.match(failure.error, /assert\.contains\(\) failure/);
  });

  test('a compile error is a failed check, not a harness error', async (t) => {
    const f = dotnetFixture(t);
    const r = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n#error broken\n// ADD // MUL\n' }));
    assert.equal(r.verdict, 'FAIL');
    const excerpt = r.excerpts.find((e) => e.test === 'dotnet build (failed)');
    assert.ok(excerpt);
    assert.equal(locationOf(excerpt.text), 'apps/dotnet/Calc/Calc.cs:2');
  });

  test('a restore failure, a missing dotnet and an unreadable result file are harness errors', async (t) => {
    const f = dotnetFixture(t);
    const broken = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc/Calc.csproj': '<Project><!-- BROKEN-PACKAGE --></Project>\n' }));
    assert.equal(broken.verdict, 'HARNESS_ERROR');
    assert.ok(broken.verdictReasons.some((x) => /restore failed/.test(x.detail)));
    const missing = await f.run(f.candidate(VALID), { tools: { dotnetRoot: join(tmpdir(), 'no-such-dotnet-root') } });
    assert.equal(missing.verdict, 'HARNESS_ERROR');
    assert.ok(missing.verdictReasons.some((x) => /--dotnet-root/.test(x.detail)));
    const truncated = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc.Tests/CalcTests.cs': withMultiplyTest('    // TRUNCATED-TRX\n') }));
    assert.equal(truncated.verdict, 'HARNESS_ERROR');
    assert.ok(truncated.verdictReasons.some((x) => /TRX counts/.test(x.detail)));
  });

  test('zero tests, and fewer tests than the floor, are integrity violations', async (t) => {
    const empty = dotnetFixture(t, { checks: [{ id: 'empty', category: 'unit', runner: 'dotnet-test', cwd: 'apps/dotnet-empty', args: [] }], requiredTests: [] });
    const r0 = await empty.run(empty.candidate(VALID));
    assert.equal(r0.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(codes(r0).includes('too-few-tests'));
    const high = dotnetFixture(t, { checks: [{ ...OBJECTIVE.checks[0], minTests: 9 }] });
    const r1 = await high.run(high.candidate(VALID));
    assert.equal(r1.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(codes(r1).includes('too-few-tests'));
  });

  test('a required test that is absent fails; one that already passes on the baseline needs review', async (t) => {
    // The floor counts the baseline's tests only, so the missing test is judged as missing, not as too few tests.
    const f = dotnetFixture(t, { checks: [{ ...OBJECTIVE.checks[0], minTests: 3 }] });
    const absent = await f.run(f.candidate({ 'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n// ADD\n// MUL\n' }));
    assert.equal(absent.verdict, 'FAIL');
    assert.ok(codes(absent).includes('required-test-missing'));
    const g = dotnetFixture(t, { requiredTests: [{ id: 'RT-1', check: 'dotnet-unit', name: 'Sample.Tests.CalcTests.Adds', files: ['apps/dotnet/Calc.Tests/CalcTests.cs'], expectBaselineFailure: true }] });
    const already = await g.run(g.candidate(VALID));
    assert.equal(already.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(already).includes('required-test-passes-on-baseline'));
  });

  test('deleting or skipping C# tests is an integrity violation, even in an authorized test file', async (t) => {
    const f = dotnetFixture(t);
    const removed = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc.Tests/CalcTests.cs': withMultiplyTest().replace(/\s*\[Fact\]\s*public void Adds\(\)\s*\{[^}]*\}/, '') }));
    assert.equal(removed.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(removed.findings.some((x) => x.code === 'tests-removed' && /Adds/.test(x.detail)));
    const deleted = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Other.Tests/OtherTests.cs': null }));
    assert.equal(deleted.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(codes(deleted).includes('test-file-deleted'));
    const skipped = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc.Tests/CalcTests.cs': withMultiplyTest().replace('[Fact]\n    public void Adds', '[Fact(Skip = "later")]\n    public void Adds') }));
    assert.equal(skipped.verdict, 'INTEGRITY_VIOLATION');
    assert.ok(codes(skipped).includes('skip-or-focus-added'));
    const edited = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Other.Tests/OtherTests.cs': OTHER_TESTS.replace('requires: ADD', 'requires: MUL') }));
    assert.equal(edited.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(edited).includes('unapproved-expectation-change'));
  });

  test('a new C# warning suppression needs review; a changed project file needs review', async (t) => {
    const f = dotnetFixture(t);
    const r = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc/Calc.cs': 'namespace Sample;\n#pragma warning disable CS0168\n// ADD\n// MUL\n' }));
    assert.equal(r.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(r).includes('suppression-added'));
    const p = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc/Calc.csproj': '<Project Sdk="Microsoft.NET.Sdk"><!-- changed --></Project>\n' }));
    assert.equal(p.verdict, 'NEEDS_REVIEW');
    assert.ok(codes(p).includes('unapproved-surface-change'));
  });

  test('a failure message carrying an environment secret is redacted everywhere it is kept', async (t) => {
    const f = dotnetFixture(t);
    const leaking = withMultiplyTest('\n    [Fact]\n    public void Leaks()\n    {\n        // requires: LEAK-TOKEN\n    }\n');
    const r = await f.run(f.candidate({ ...VALID, 'apps/dotnet/Calc.Tests/CalcTests.cs': leaking }));
    assert.equal(r.verdict, 'FAIL');
    assert.ok(!JSON.stringify(r).includes(SECRET));
    for (const name of readdirSync(r.evidence.dir)) assert.ok(!readFileSync(join(r.evidence.dir, name), 'utf8').includes(SECRET), name);
  });
});

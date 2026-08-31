// A guard that cannot fail is not a guard. check-bridge-governance.mjs only
// earns its place in CI if each rule genuinely rejects the thing it claims to
// reject, so every case below feeds it the violation it is meant to catch
// rather than only confirming the clean repo stays green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findForbiddenTrackedFiles,
  findCommittedApiKey,
  extractSupportBlock,
  parseSuitesFromTestRunner,
  parseSuitesFromCiProject,
  PLACEHOLDER_API_KEY,
} from './check-bridge-governance.mjs';

test('vendor DLLs re-added under the bridge are rejected', () => {
  const { vendorDlls } = findForbiddenTrackedFiles([
    'apps/idealpos-bridge/lib/IdealPos.Webit.Core.dll',
    'apps/idealpos-bridge/lib/x64/SQLite.Interop.dll',
    'apps/idealpos-bridge/lib/PUT_DLLS_HERE.txt',
    'apps/idealpos-bridge/Program.cs',
  ]);
  assert.deepEqual(vendorDlls, [
    'apps/idealpos-bridge/lib/IdealPos.Webit.Core.dll',
    'apps/idealpos-bridge/lib/x64/SQLite.Interop.dll',
  ]);
});

test('DLLs elsewhere in the monorepo are not this guard’s business', () => {
  const { vendorDlls } = findForbiddenTrackedFiles(['apps/venue-connector/lib/Something.dll']);
  assert.deepEqual(vendorDlls, []);
});

test('committed build output is rejected, for both bin and obj', () => {
  const { buildOutput } = findForbiddenTrackedFiles([
    'apps/idealpos-bridge/bin/Release/net48/VerduraIdealposBridge.exe',
    'apps/idealpos-bridge/obj/project.assets.json',
    'apps/idealpos-bridge/ci/CiTestMain.cs',
  ]);
  assert.deepEqual(buildOutput, [
    'apps/idealpos-bridge/bin/Release/net48/VerduraIdealposBridge.exe',
    'apps/idealpos-bridge/obj/project.assets.json',
  ]);
});

test('the placeholder API key passes', () => {
  const config = `<add key="Bridge:ApiKey" value="${PLACEHOLDER_API_KEY}" />`;
  assert.equal(findCommittedApiKey(config), null);
});

test('a real GUID key is rejected — the exact regression this guard exists for', () => {
  const config = '<add key="Bridge:ApiKey" value="0510e56d-4888-4d98-a083-8cb33ef6c938" />';
  assert.match(findCommittedApiKey(config), /not the placeholder/);
});

test('a deleted API key setting is rejected rather than passing vacuously', () => {
  assert.match(findCommittedApiKey('<appSettings></appSettings>'), /missing/);
});

const SUPPORT_BLOCK = [
  '    public class TestResult',
  '    {',
  '        public string Name;',
  '    }',
].join('\n');

test('the assert mirror matches when both files carry the same block', () => {
  const runner = `namespace X\n{\n    public static class TestRunner { }\n\n${SUPPORT_BLOCK}\n}\n`;
  const mirror = `using System;\n\nnamespace X\n{\n${SUPPORT_BLOCK}\n}\n`;
  assert.equal(extractSupportBlock(runner), extractSupportBlock(mirror));
});

test('CRLF versus LF alone does not count as drift', () => {
  const lf = `namespace X\n{\n${SUPPORT_BLOCK}\n}\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(extractSupportBlock(lf), extractSupportBlock(crlf));
});

test('a changed assertion helper is caught as drift', () => {
  const runner = `namespace X\n{\n${SUPPORT_BLOCK}\n}\n`;
  const mirror = `namespace X\n{\n${SUPPORT_BLOCK.replace('public string Name;', 'public string Label;')}\n}\n`;
  assert.notEqual(extractSupportBlock(runner), extractSupportBlock(mirror));
});

test('a missing block reports null instead of silently matching', () => {
  assert.equal(extractSupportBlock('namespace X\n{\n}\n'), null);
});

test('every suite TestRunner executes is discovered', () => {
  const source = [
    'results.AddRange(OrderValidatorTests.RunAll());',
    'results.AddRange(TableAssignmentStrategyTests.RunAll());',
    'results.AddRange(OrderStatusTests.RunAll());',
  ].join('\n');
  assert.deepEqual(parseSuitesFromTestRunner(source), [
    'OrderValidatorTests',
    'TableAssignmentStrategyTests',
    'OrderStatusTests',
  ]);
});

test('CI-compiled suites are discovered under either path separator', () => {
  const windows = '<Compile Include="..\\Tests\\OrderStatusTests.cs" Link="Tests\\OrderStatusTests.cs" />';
  const posix = '<Compile Include="../Tests/OrderStatusTests.cs" />';
  assert.deepEqual(parseSuitesFromCiProject(windows), ['OrderStatusTests']);
  assert.deepEqual(parseSuitesFromCiProject(posix), ['OrderStatusTests']);
});

test('production sources linked into the CI project are not mistaken for suites', () => {
  const csproj = '<Compile Include="..\\Orders\\OrderValidator.cs" Link="Orders\\OrderValidator.cs" />';
  assert.deepEqual(parseSuitesFromCiProject(csproj), []);
});

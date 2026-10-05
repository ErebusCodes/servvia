#!/usr/bin/env node
// Story 1.9 adversarial (negative) probes — evidence tooling, FREEZE CANDIDATE — NOT YET FROZEN.
//
// Builds deliberately WRONG candidates on top of a simulated anchor in a DISPOSABLE local clone and
// judges each with the anchor's own evaluator code: staticIntegrity (lib/integrity.mjs), the evaluator's
// intent-contract rule (as lib/evaluate.mjs applies it) and the objective's static command checks.
// No variant implements Story 1.9; there is no positive control. Because every variant also lacks the
// fix, each check's messages are compared with the no-op's: a variant is DISCRIMINATED only if an
// integrity finding or a message specific to it rejects it, and MASKED if it fails only for the
// reasons the unfixed baseline fails.
//
//   node adversarial-probes.mjs <disposable-clone> <anchor-ref> <objective-path>
//
// Refuses to run in a clone with any remote other than a local path (never against a real remote).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const [repo, anchorRef, objectivePath] = process.argv.slice(2);
if (!repo || !anchorRef || !objectivePath) { console.error('usage: adversarial-probes.mjs <disposable-clone> <anchor-ref> <objective-path>'); process.exit(2); }
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const remotes = g('remote', '-v');
if (/github\.com|https?:\/\/|git@/.test(remotes)) { console.error('REFUSED: the clone has a network remote; use a disposable local clone'); process.exit(2); }
const anchor = g('rev-parse', anchorRef);
const { staticIntegrity } = await import(join(repo, 'tooling/evaluator/lib/integrity.mjs'));
const { intentContractSha256 } = await import(join(repo, 'tooling/evaluator/lib/objective.mjs'));
const policy = JSON.parse(g('show', `${anchor}:tooling/evaluator/policy.json`));
const objective = JSON.parse(g('show', `${anchor}:${objectivePath}`));
const STATIC = ['test-server-explicit-loopback', 'connector-harness-change-bounded', 'supertest-dependency-delta'];
const H = 'apps/api/test/connector-command-harness.integration-spec.ts';

const edit = (p, fn) => { const f = join(repo, p); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const json = (p, fn) => edit(p, (t) => { const o = JSON.parse(t); fn(o); return JSON.stringify(o, null, 2) + '\n'; });
const add = (p, text) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), text); };
const sub = (p, a, b) => edit(p, (t) => { if (!t.includes(a)) throw new Error(`${p}: no ${a}`); return t.replace(a, b); });
const VARIANTS = {
  'unchanged (no-op)': () => {},
  'harness binds the wildcard ::': () => sub(H, 'await app.listen(0);', "await app.listen(0, '::');"),
  'harness binds 0.0.0.0': () => sub(H, 'await app.listen(0);', "await app.listen(0, '0.0.0.0');"),
  'harness listen via bracket call': () => sub(H, 'await app.listen(0);', "await app['listen'](0);"),
  'harness test skipped': () => sub(H, '  it(', '  it.skip('),
  'harness assertion weakened': () => edit(H, (t) => t.replace(/expect\(([^;]*)\)\.toBe\(/, 'expect($1).not.toBe(')),
  'new helper reintroduces host-less listen': () => add('apps/api/test/zz-listen-helper.ts', 'export const start = (s: { listen: (p: number) => void }) => s.listen(0);\n'),
  'new test file with wildcard bind': () => add('apps/api/test/zz-wildcard.integration-spec.ts', "it('x', async () => { await app.listen(0); });\n"),
  'src spec with host-less listen': () => add('apps/api/src/zz-wildcard.spec.ts', "it('x', () => { server.listen(0); });\n"),
  'orders suite deleted': () => unlinkSync(join(repo, 'apps/api/test/orders.integration-spec.ts')),
  'one orders test removed': () => edit('apps/api/test/orders.integration-spec.ts', (t) => { const i = t.indexOf('\n  it('); const j = t.indexOf('\n  it(', i + 5); return t.slice(0, i) + t.slice(j); }),
  'recovery suite skipped (Story 1.7)': () => edit('apps/api/test/native-round-recovery.integration-spec.ts', (t) => t.replace('describe(', 'describe.skip(')),
  'host-override guard removed (Story 1.8)': () => edit('apps/api/test/native-round-recovery.integration-spec.ts', (t) => t.replace('hasHostParameter', 'hasHostParameterDisabled')),
  'integration setup bypass': () => edit('apps/api/test/integration-setup.ts', (t) => t + '\nprocess.env.NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE = "x";\n'),
  'environment file bypass': () => add('apps/api/.env', 'NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE=anything\n'),
  'jest config narrowed (hard-coded success)': () => json('apps/api/test/jest-integration.json', (o) => { o.testRegex = 'zz-none'; }),
  'unit jest config in package.json narrowed': () => json('apps/api/package.json', (o) => { o.jest.testRegex = 'zz-none'; }),
  'test script replaced (hard-coded success)': () => json('apps/api/package.json', (o) => { o.scripts.test = 'true'; }),
  'extra api dev dependency': () => json('apps/api/package.json', (o) => { o.devDependencies['left-pad'] = '^1.3.0'; }),
  'root dependency': () => json('package.json', (o) => { o.devDependencies = { ...(o.devDependencies ?? {}), 'left-pad': '^1.3.0' }; }),
  'lockfile tampered (other package)': () => json('package-lock.json', (o) => { o.packages['node_modules/methods'].version = '9.9.9'; }),
  'production listen host changed': () => sub('apps/api/src/main.ts', "await app.listen(port, '0.0.0.0');", "await app.listen(port, '127.0.0.1');"),
  'CI continue-on-error': () => edit('.github/workflows/ci.yml', (t) => t.replace('timeout-minutes: 15', 'timeout-minutes: 15\n    continue-on-error: true')),
  'evaluator modified': () => edit('tooling/evaluator/lib/verdict.mjs', (t) => t + '\n// x\n'),
  'objective weakened': () => json(objectivePath, (o) => { o.checks = o.checks.filter((c) => c.id !== 'loopback-endpoint-identity'); }),
  'epic context edited': () => edit('_bmad-output/implementation-artifacts/epic-1-context.md', (t) => t + '\nx\n'),
  'spec intent contract edited': () => edit('_bmad-output/implementation-artifacts/spec-1-9-test-harness-loopback-binding.md', (t) => t.replace('## Intent', '## Intent\n\nAnything goes.')),
  'freeze-candidate packet edited': () => add('_bmad-output/implementation-artifacts/objective-drafts/story-1-9-test-harness-loopback-binding/x.txt', 'x\n'),
};

const out = []; let unsafeAccepted = 0; let baselineMessages = new Set();
for (const [name, mutate] of Object.entries(VARIANTS)) {
  execFileSync('git', ['-C', repo, 'checkout', '-q', '--detach', anchor]);
  mutate();
  execFileSync('git', ['-C', repo, 'add', '-A', '-f']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=probe', '-c', 'user.email=probe@invalid', 'commit', '-q', '--allow-empty', '-m', `probe: ${name}`]);
  const cand = g('rev-parse', 'HEAD');
  const findings = staticIntegrity({ repo, anchorCommit: anchor, candidateCommit: cand, objective, objectivePath, policy });
  const spec = objective.inputs.storySpec; let specText = ''; try { specText = g('show', `${cand}:${spec.path}`); } catch { /* missing */ }
  if (intentContractSha256(specText + '\n') !== spec.intentContractSha256 && intentContractSha256(specText) !== spec.intentContractSha256) findings.push({ severity: 'INTEGRITY_VIOLATION', code: 'intent-contract-modified', path: spec.path });
  const tree = mkdtempSync(join(tmpdir(), 's19-probe-'));
  execFileSync('sh', ['-c', `git -C '${repo}' archive ${cand} | tar -x -C '${tree}'`]);
  const cmd = STATIC.map((id) => { const c = objective.checks.find((x) => x.id === id); const r = spawnSync(process.execPath, c.args.slice(1), { cwd: join(tree, c.cwd), encoding: 'utf8' }); return [id, r.status === 0 ? 'ok' : 'FAIL', r.stdout.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.replace(/sha256 [0-9a-f]{64}/g, 'sha256 <h>'))]; });
  rmSync(tree, { recursive: true, force: true });
  const iv = findings.filter((f) => f.severity === 'INTEGRITY_VIOLATION'); const nr = findings.filter((f) => f.severity === 'NEEDS_REVIEW');
  const failed = cmd.filter(([, s]) => s === 'FAIL').map(([id]) => id);
  if (name === 'unchanged (no-op)') baselineMessages = new Set(cmd.flatMap(([, , m]) => m));
  const specific = cmd.flatMap(([id, , m]) => m.filter((x) => !baselineMessages.has(x)).map((x) => `${id}: ${x.slice(5, 140)}`));
  const verdict = iv.length ? 'INTEGRITY_VIOLATION' : failed.length ? 'FAIL' : nr.length ? 'NEEDS_REVIEW' : 'NOT REJECTED STATICALLY';
  const discriminated = name === 'unchanged (no-op)' ? 'baseline' : (iv.length || specific.length ? 'DISCRIMINATED' : nr.length ? 'REVIEW-ONLY' : 'MASKED');
  if (discriminated === 'MASKED') unsafeAccepted += 1;
  out.push({ name, verdict, discriminated, integrity: [...new Set(iv.map((f) => f.code))], review: [...new Set(nr.map((f) => f.code))], failedStaticChecks: failed, specific });
}
execFileSync('git', ['-C', repo, 'checkout', '-q', '--detach', anchor]);
for (const r of out) console.log(`${r.name.padEnd(44)} ${r.verdict.padEnd(20)} ${r.discriminated.padEnd(14)} IV[${r.integrity.join(',')}] NR[${r.review.join(',')}] SPECIFIC[${r.specific.join(' | ')}]`);
console.log(`variants ${out.length}; wrong variants rejected only because the fix is absent (MASKED): ${unsafeAccepted}`);
process.exit(unsafeAccepted ? 1 : 0);

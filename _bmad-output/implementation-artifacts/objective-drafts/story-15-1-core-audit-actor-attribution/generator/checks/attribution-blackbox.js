// Evaluator-owned Story 15.1 Go tests (checks audit-attribution-routes and audit-actor-model). Writes
// the evaluator's Go sources FILES ([path, source] pairs, paths relative to services/core-platform)
// into the candidate's integration package, runs exactly the TESTS against the evaluation's
// PostgreSQL, and removes the files. Every named test must pass; a skip (no database), a build
// failure or a missing result fails, with the compiler's or the test's own diagnosis.
// Generated constants: FILES, TESTS.
const { spawnSync } = require('node:child_process'); const fs = require('node:fs');
const FILES = __FILES__;
const TESTS = __TESTS__;
for (const [f] of FILES) if (fs.existsSync(f)) { console.log('FAIL the candidate already has ' + f + ': the evaluator-owned test cannot be placed'); process.exit(1); }
if (!process.env.SERVVIA_CORE_TEST_DATABASE_URL) { console.log('FAIL SERVVIA_CORE_TEST_DATABASE_URL is not set: the evaluator-owned test needs the evaluation database'); process.exit(1); }
let r;
try {
  for (const [f, source] of FILES) fs.writeFileSync(f, source);
  r = spawnSync('go', ['test', '-count=1', '-json', '-run', '^(' + TESTS.join('|') + ')$', './tests/integration/'], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900000 });
} finally {
  for (const [f] of FILES) fs.rmSync(f, { force: true });
}
const events = (r.stdout || '').split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
const outcome = {}; const output = {};
for (const e of events) {
  if (!e.Test || e.Test.includes('/')) continue;
  if (['pass', 'fail', 'skip'].includes(e.Action)) outcome[e.Test] = e.Action;
  if (e.Action === 'output' && /^\s+\S+\.go:\d+: |^\s+--- SKIP|SKIP/.test(e.Output)) (output[e.Test] = output[e.Test] || []).push(e.Output.trim());
}
let bad = 0;
for (const t of TESTS) {
  const o = outcome[t] || 'no result';
  if (o !== 'pass') bad += 1;
  console.log((o === 'pass' ? 'ok   ' : 'FAIL ') + t + ': ' + o);
  for (const line of (output[t] || []).slice(0, 12)) console.log('       ' + line.slice(0, 400));
}
if (!Object.keys(outcome).length) {
  console.log('FAIL the evaluator-owned test did not run (go test exit ' + r.status + (r.error ? ', ' + r.error.message : '') + ')');
  const build = events.filter((e) => e.Action === 'build-output' || (e.Action === 'output' && !e.Test)).map((e) => String(e.Output).trimEnd());
  const other = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').filter((l) => l && !l.startsWith('{'));
  for (const line of [...build, ...other].filter(Boolean).slice(0, 30)) console.log('       ' + line.slice(0, 400));
  bad += 1;
}
process.exit(bad ? 1 : 0);

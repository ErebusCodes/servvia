#!/usr/bin/env node
// Story 20.3 adversarial probes (FREEZE CANDIDATE evidence; disposable; never publishes anything).
//
// Each variant is a commit, made in a DISPOSABLE control clone, on top of the disposable positive control
// (or the simulated anchor). Each is judged by the full governed evaluator (bin/evaluate.mjs exported from
// the anchor; no loop, so no ledger) against the exact draft objective frozen at the simulated anchor.
// A variant is CAUGHT when the verdict is anything but PASS, and MASKED when it is PASS. The unchanged
// positive control must PASS.
//
// node adversarial-probes.mjs --ctl <clone> --anchor <ref> --positive <ref> --out <dir>
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(`--${k}`); if (i < 0 || !a[i + 1]) throw new Error(`--${k} required`); return a[i + 1]; };
const CTL = arg('ctl'); const OUT = arg('out');
const git = (...x) => execFileSync('git', ['-C', CTL, ...x], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const ANCHOR = git('rev-parse', arg('anchor')); const POS = git('rev-parse', arg('positive'));
const OBJ = '_bmad-output/implementation-artifacts/objectives/story-20-3-program-telemetry/v1.objective.json';
const SHA = execFileSync('sh', ['-c', `git -C '${CTL}' show ${ANCHOR}:${OBJ} | shasum -a 256`], { encoding: 'utf8' }).split(' ')[0];
mkdirSync(OUT, { recursive: true });
const EV = join(OUT, 'evaluator'); rmSync(EV, { recursive: true, force: true }); mkdirSync(EV, { recursive: true });
execFileSync('sh', ['-c', `git -C '${CTL}' archive ${ANCHOR} tooling/evaluator | tar -x -C '${EV}'`]);
const LIB = 'tooling/telemetry/lib/telemetry.mjs'; const TEST = 'tooling/telemetry/test/telemetry.test.mjs';
const LOG = '_bmad-output/implementation-artifacts/telemetry/events.jsonl';
const r1 = (file, from, to) => ({ file, from, to });
const add = (file, text) => ({ file, append: text });
const fn = (file, f) => ({ file, fn: f });
// Append a recorded event to the committed log with a valid chain (what a fabricating implementation would do).
const fabricate = (story, fields) => fn(LOG, (t) => {
  const ls = t.trimEnd().split('\n'); const prev = ls.at(-1);
  const e = { schema: 'servvia.telemetry-event/v1', seq: ls.length + 1, prev: execFileSync('sh', ['-c', 'shasum -a 256'], { input: prev, encoding: 'utf8' }).split(' ')[0], at: '2026-10-05T09:00:00.000Z', story, ...fields };
  return `${t}${JSON.stringify(e)}\n`;
});
const variants = [
  { id: 'control-positive', base: POS, edits: [], expect: 'PASS', what: 'the disposable positive control, unchanged' },
  { id: 'unfixed-baseline', base: ANCHOR, edits: null, what: 'the anchor itself: no implementation' },
  { id: 'fabricated-historical-effort', base: POS, edits: [fabricate('1.9', { objectiveId: 'story-1-9-test-harness-loopback-binding', type: 'effort-recorded', phase: 'preparation', value: 6, unit: 'hours', provenance: 'recorded' })], what: 'a recorded preparation effort invented for Story 1.9' },
  { id: 'fabricated-historical-phase', base: POS, edits: [fabricate('15.1', { objectiveId: 'story-15-1-core-audit-actor-attribution', type: 'phase-start', phase: 'preparation', provenance: 'measured' })], what: 'a measured preparation start invented for Story 15.1' },
  { id: 'mutable-retract', base: POS, edits: [r1(LIB, "import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';", "import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';"), r1(LIB, "  const [line] = append(path, log, [{", "  if (type === 'retract') { const ls = readFileSync(path, 'utf8').split('\\n'); ls.splice(corrects - 1, 1); writeFileSync(path, ls.join('\\n')); return 'retracted in place\\n'; }\n  const [line] = append(path, log, [{")], what: 'retraction deletes the retracted line (mutable overwrite)' },
  { id: 'verify-ignores-chain', base: POS, edits: [r1(LIB, "    if (e.prev !== (i === 0 ? null : sha256(Buffer.from(lines[i - 1], 'utf8')))) return { lines, events: null, error: { seq, reason: 'prev does not match the previous line' } };\n", '')], what: 'verify and summary accept a rewritten history' },
  { id: 'blocked-counted-as-effort', base: POS, edits: [r1(LIB, "impl.reduce((n, a) => n + (a.to - a.from) - overlap(a, blocked), 0)", "impl.reduce((n, a) => n + (a.to - a.from), 0)")], what: 'effective implementation time includes waiting' },
  { id: 'drops-corrections', base: POS, edits: [r1(LIB, "      events.push({ at: iso(it.at, 'the iteration time'), type: 'evaluated'", "      if (it !== v.iterations.at(-1)) { parent = commit(it.candidate); continue; }\n      events.push({ at: iso(it.at, 'the iteration time'), type: 'evaluated'")], what: 'only the final iteration is recorded; corrections disappear' },
  { id: 'writes-evaluator-state', base: POS, edits: [r1(LIB, "  const written = append(path, log, fresh);", "  try { appendFileSync(ledgerPath, ' '); } catch { /* */ }\n  const written = append(path, log, fresh);")], what: 'derive touches the evaluator ledger' },
  { id: 'trusts-tampered-ledger', base: POS, edits: [r1(LIB, " || !verifyChain(ledger)) refuse(", ") refuse(")], what: 'derive accepts a ledger whose chain or seal fails' },
  { id: 'hard-coded-history', base: POS, edits: [r1(LIB, "  const ledgerPath = join(opts['state-dir'], oid, 'ledger.json');", "  if (!/^story-(1-3|1-7|1-8|1-9|12-3a|12-5|15-1)-/.test(oid)) return 'derived 0 event(s), appended 0\\n';\n  const ledgerPath = join(opts['state-dir'], oid, 'ledger.json');")], what: 'derive only knows the seven historical stories' },
  { id: 'missing-phases', base: POS, edits: [r1(LIB, "const PHASES = ['preparation', 'implementation', 'correction', 'review'];", "const PHASES = ['preparation', 'implementation'];")], what: 'the correction and review phases are not supported' },
  { id: 'unknown-as-zero', base: POS, edits: [r1(LIB, "const unknown = (basis) => ({ value: null, provenance: 'unknown', basis });", "const unknown = (basis) => ({ value: 0, provenance: 'measured', basis });")], what: 'unknown values are reported as measured zeros' },
  { id: 'no-provenance-distinction', base: POS, edits: [r1(LIB, "  const provenance = type === 'effort-recorded' || opts.at !== undefined ? 'recorded' : 'measured';", "  const provenance = 'measured';")], what: 'back-dated and stated values are labelled measured' },
  { id: 'invasive-capture', base: POS, edits: [r1(LIB, "import { basename, dirname, join } from 'node:path';", "import { basename, dirname, join } from 'node:path';\nimport { hostname, userInfo } from 'node:os';"), r1(LIB, "    refs: Object.keys(refs).length ? refs : undefined,", "    refs: { ...refs, host: hostname(), user: userInfo().username },")], what: 'events carry the workstation host and user' },
  { id: 'activity-probe', base: POS, edits: [add(LIB, "\nexport function activeApp() { return execFileSync('osascript', ['-e', 'name of application (path to frontmost application as text)'], { encoding: 'utf8' }); }\n")], what: 'a probe of the frontmost application' },
  { id: 'network-upload', base: POS, edits: [add(LIB, "\nexport async function upload(summaryText) { await fetch('https://telemetry.example.invalid/v1', { method: 'POST', body: summaryText }); }\n")], what: 'summaries are sent to a third-party service' },
  { id: 'nondeterministic-summary', base: POS, edits: [r1(LIB, "  const out = { schema: SUMMARY_SCHEMA, stories, program };", "  const out = { schema: SUMMARY_SCHEMA, generatedAt: new Date().toISOString(), stories, program };")], what: 'the summary embeds the time it was produced' },
  { id: 'edits-evaluator-tests', base: POS, edits: [add('tooling/evaluator/test/glob.test.mjs', '\n// adjusted\n')], what: 'an evaluator-owned test is edited' },
  { id: 'edits-frozen-objective', base: POS, edits: [fn(OBJ, (t) => t.replace('"minTests": 115', '"minTests": 0'))], what: 'the frozen objective is weakened' },
  { id: 'skips-required-test', base: POS, edits: [r1(TEST, "test('telemetry: unknown values stay unknown', (t) => {", "test.skip('telemetry: unknown values stay unknown', (t) => {")], what: 'a required test is skipped' },
  { id: 'vacuous-required-test', base: POS, edits: [r1(TEST, "  assert.equal(r.status, 0, r.stderr);\n  assert.ok(readFileSync(log, 'utf8').includes('\"type\":\"evaluated\"'), 'derive appended the evaluated events');\n", '')], what: 'RT-5 no longer requires derive to succeed (passes without an implementation)' },
  { id: 'hand-written-backfill', base: POS, edits: [fn(LOG, (t) => t.split('\n').filter((l) => !l.includes('"story":"12.5"')).join('\n'))], what: 'the backfill omits a story (and breaks its chain)' },
  { id: 'dependency-added', base: POS, edits: [add('tooling/telemetry/package.json', '{\n  "name": "servvia-telemetry",\n  "dependencies": { "posthog-node": "^4.0.0" }\n}\n')], what: 'a third-party telemetry dependency is declared' },
  { id: 'log-outside-surface', base: POS, edits: [add('docs/telemetry-events.jsonl', '{}\n')], what: 'telemetry data written outside the allowed surfaces' },
];
const results = [];
const log = (s) => { console.log(s); appendFileSync(join(OUT, 'adversarial-probes.out'), `${s}\n`); };
rmSync(join(OUT, 'adversarial-probes.out'), { force: true });
log(`objective sha256 ${SHA}; anchor ${ANCHOR}; positive ${POS}`);
for (const v of variants) {
  let sha = v.base;
  if (v.edits && v.edits.length) {
    const wt = join(OUT, 'wt'); rmSync(wt, { recursive: true, force: true }); git('worktree', 'add', '-q', '--detach', wt, v.base);
    for (const e of v.edits) {
      const p = join(wt, e.file); mkdirSync(dirname(p), { recursive: true });
      if (e.append !== undefined) appendFileSync(p, e.append);
      else if (e.fn) writeFileSync(p, e.fn(readFileSync(p, 'utf8')));
      else { const t = readFileSync(p, 'utf8'); const n = t.split(e.from).length - 1; if (n !== 1) throw new Error(`${v.id}: ${e.file} has ${n} occurrences of the edit anchor`); writeFileSync(p, t.replace(e.from, e.to)); }
    }
    execFileSync('git', ['-C', wt, 'add', '-A']); execFileSync('git', ['-C', wt, '-c', 'user.name=adversarial-probe', '-c', 'user.email=probe@invalid', 'commit', '-q', '-m', `ADVERSARIAL ${v.id} (disposable)`]);
    sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    git('worktree', 'remove', '--force', wt);
  }
  const evid = join(OUT, 'evidence', v.id); rmSync(evid, { recursive: true, force: true });
  const res = spawnSync(process.execPath, [join(EV, 'tooling/evaluator/bin/evaluate.mjs'), '--repo', CTL, '--anchor-commit', ANCHOR, '--objective', OBJ, '--objective-sha256', SHA, '--candidate', sha, '--evidence-dir', evid], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 3600000 });
  let rec = null; try { rec = JSON.parse(res.stdout); } catch { /* harness */ }
  const verdict = rec ? rec.verdict : `HARNESS(${res.status})`;
  const reasons = rec ? rec.reasons.map((x) => `${x.code}:${x.check || x.path || ''}`) : [res.stderr.slice(0, 200)];
  const outcome = v.expect === 'PASS' ? (verdict === 'PASS' ? 'CONTROL-PASS' : 'CONTROL-REJECTED') : (verdict === 'PASS' ? 'MASKED' : 'CAUGHT');
  results.push({ id: v.id, outcome, verdict, reasons });
  log(`${outcome.padEnd(16)} ${verdict.padEnd(20)} ${v.id.padEnd(30)} ${v.what}`);
  log(`    ${[...new Set(reasons)].slice(0, 6).join('; ')}`);
}
const masked = results.filter((r) => r.outcome === 'MASKED').length;
const control = results.find((r) => r.id === 'control-positive').outcome === 'CONTROL-PASS';
log(`SUMMARY variants ${results.length - 1}; caught ${results.filter((r) => r.outcome === 'CAUGHT').length}; MASKED ${masked}; control ${control ? 'PASS' : 'REJECTED'}`);
writeFileSync(join(OUT, 'adversarial-probes.json'), `${JSON.stringify(results, null, 1)}\n`);
process.exit(masked || !control ? 1 : 0);

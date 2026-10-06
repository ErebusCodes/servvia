// telemetry-contract (Story 20.3). Evaluator-owned black-box test of the telemetry contract fixed by the
// spec's intent contract. It runs the candidate's CLI from a temporary directory against fixture git
// repositories and fixture evaluator ledgers and records that it builds itself (synthetic story ids, so a
// tool that only knows the seven historical stories fails), and requires: measured / recorded / derived /
// unknown provenance; waiting kept apart from effort; every refusal leaving the log unchanged; append-only
// retraction; tamper detection; ledger-derived iterations, corrections and test growth; refusal of a
// tampered ledger or record; idempotent derivation; evaluator state byte-identical afterwards; a fixed
// metric set; deterministic JSON and text summaries.
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const crypto = require('node:crypto');
const ROOT = process.cwd();
const CLI = path.join(ROOT, 'tooling/telemetry/bin/telemetry.mjs');
const POLICY = path.join(ROOT, 'tooling/evaluator/policy.json');
const METRICS = ['preparationElapsedMs', 'implementationElapsedMs', 'implementationEffectiveMs', 'evaluationElapsedMs', 'evaluatorIterations', 'correctionIterations', 'firstPassVerdict', 'reviewRounds', 'blockedMs', 'recordedEffortHours', 'testDeclarationsAdded', 'defectsEscaped', 'defectsReopened', 'cycleElapsedMs'];
const KEYS = ['schema', 'seq', 'prev', 'at', 'story', 'objectiveId', 'type', 'phase', 'reason', 'value', 'unit', 'refs', 'corrects', 'note', 'provenance'];
let bad = 0;
const ok = (name, cond, detail) => { if (!cond) bad += 1; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : ': ' + String(detail).slice(0, 400))); };
if (!fs.existsSync(CLI)) { console.log('FAIL the telemetry CLI tooling/telemetry/bin/telemetry.mjs does not exist'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'servvia-telemetry-contract-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const baseEnv = { ...process.env }; delete baseEnv.SERVVIA_TELEMETRY_CLOCK;
const run = (args, clock) => spawnSync(process.execPath, [CLI, ...args], { cwd: tmp, encoding: 'utf8', timeout: 120000, env: clock ? { ...baseEnv, SERVVIA_TELEMETRY_CLOCK: clock } : baseEnv });
const LOG = path.join(tmp, 'events.jsonl');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0));
const lines = (p) => read(p).toString('utf8').split('\n').filter(Boolean);
const events = (p) => lines(p).map((l) => JSON.parse(l));
const rec = (story, type, extra = [], clock = null, log = LOG) => run(['record', '--log', log, '--story', story, '--type', type, ...extra], clock);
const summary = (args, log = LOG) => { const r = run(['summary', '--log', log, ...args]); try { return { r, s: JSON.parse(r.stdout) } } catch { return { r, s: null }; } };
const metric = (s, story, m) => { const st = s && s.stories && s.stories.find((x) => x.story === story); return st && st.metrics ? st.metrics[m] : undefined; };
const is = (m, value, provenance) => m !== undefined && m !== null && m.value === value && m.provenance === provenance;
const T = (h, m = 0) => `2030-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

// ---- 1. measured events, chain and keys ---------------------------------------------------------------
let r = rec('88.1', 'phase-start', ['--phase', 'implementation'], T(10));
ok('record phase-start (clock) exits 0', r.status === 0, r.stderr);
rec('88.1', 'blocked-start', ['--reason', 'external'], T(10, 30));
rec('88.1', 'blocked-end', [], T(11));
r = rec('88.1', 'phase-end', ['--phase', 'implementation'], T(12));
ok('record phase-end exits 0', r.status === 0, r.stderr);
let ev = events(LOG);
ok('four events appended, seq 1..4', ev.length === 4 && ev.every((e, i) => e.seq === i + 1), JSON.stringify(ev.map((e) => e.seq)));
ok('first event has prev null and the event schema', ev[0] && ev[0].prev === null && ev[0].schema === 'servvia.telemetry-event/v1', lines(LOG)[0]);
const L = lines(LOG);
ok('each prev is the SHA-256 of the previous line', ev.every((e, i) => i === 0 || e.prev === sha(Buffer.from(L[i - 1], 'utf8'))));
ok('clock events are measured with the clock time', ev[0] && ev[0].provenance === 'measured' && ev[0].at === T(10), lines(LOG)[0]);
ok('only contract keys, in contract order', L.every((l) => { const k = Object.keys(JSON.parse(l)); return k.every((x) => KEYS.includes(x)) && k.join() === KEYS.filter((x) => k.includes(x)).join(); }), L.join(' | '));
ok('the log ends with a newline', read(LOG).toString('utf8').endsWith('\n'));
r = run(['verify', '--log', LOG]);
ok('verify prints ok 4 events', r.status === 0 && /^ok 4 events/m.test(r.stdout), r.stdout + r.stderr);

// ---- 2. waiting is separate from effort; unknown stays unknown --------------------------------------
let { r: sr, s } = summary(['--story', '88.1']);
ok('summary exits 0 with the summary schema', sr.status === 0 && s && s.schema === 'servvia.telemetry-summary/v1', sr.stderr);
ok('implementation elapsed 2 h measured', is(metric(s, '88.1', 'implementationElapsedMs'), 7200000, 'measured'), JSON.stringify(metric(s, '88.1', 'implementationElapsedMs')));
ok('implementation effective 1.5 h measured (blocked excluded)', is(metric(s, '88.1', 'implementationEffectiveMs'), 5400000, 'measured'), JSON.stringify(metric(s, '88.1', 'implementationEffectiveMs')));
ok('blocked 0.5 h measured, separate', is(metric(s, '88.1', 'blockedMs'), 1800000, 'measured'), JSON.stringify(metric(s, '88.1', 'blockedMs')));
for (const m of ['preparationElapsedMs', 'reviewRounds', 'recordedEffortHours', 'evaluatorIterations', 'evaluationElapsedMs', 'testDeclarationsAdded', 'firstPassVerdict']) {
  ok(`${m} is unknown (null), not zero`, is(metric(s, '88.1', m), null, 'unknown'), JSON.stringify(metric(s, '88.1', m)));
}
ok('defects of a live-tracked story without defects are 0', is(metric(s, '88.1', 'defectsEscaped'), 0, 'measured') || is(metric(s, '88.1', 'defectsEscaped'), 0, 'recorded'), JSON.stringify(metric(s, '88.1', 'defectsEscaped')));
const st881 = s && s.stories && s.stories.find((x) => x.story === '88.1');
ok('every story has exactly the contract metrics', st881 && JSON.stringify(Object.keys(st881.metrics).sort()) === JSON.stringify([...METRICS].sort()), st881 && Object.keys(st881.metrics).join());

// ---- 3. back-dated events are recorded -------------------------------------------------------------
rec('88.2', 'phase-start', ['--phase', 'preparation', '--at', T(8)], T(20));
rec('88.2', 'phase-end', ['--phase', 'preparation', '--at', T(9)], T(20));
({ s } = summary(['--story', '88.2']));
ok('--at events are recorded, preparation 1 h recorded', is(metric(s, '88.2', 'preparationElapsedMs'), 3600000, 'recorded') && events(LOG).filter((e) => e.story === '88.2').every((e) => e.provenance === 'recorded' && (e.at === T(8) || e.at === T(9))), JSON.stringify(metric(s, '88.2', 'preparationElapsedMs')));

// ---- 3b. every lifecycle phase, blocked reason, review outcome and defect kind is accepted -------------------
{ let h = 0; const next = () => T(17, h++);
  for (const ph of ['preparation', 'implementation', 'correction', 'review']) {
    const a = rec('88.7', 'phase-start', ['--phase', ph], next()); const b = rec('88.7', 'phase-end', ['--phase', ph], next());
    ok(`phase ${ph} can start and end`, a.status === 0 && b.status === 0, a.stderr + b.stderr);
  }
  for (const why of ['owner-decision', 'external', 'authorization', 'infrastructure', 'other']) {
    const a = rec('88.7', 'blocked-start', ['--reason', why], next()); const b = rec('88.7', 'blocked-end', [], next());
    ok(`blocked reason ${why} is accepted`, a.status === 0 && b.status === 0, a.stderr + b.stderr);
  }
  for (const out of ['accept', 'revise', 'reject']) { const a = rec('88.7', 'review-decision', ['--reason', out], next()); ok(`review outcome ${out} is accepted`, a.status === 0, a.stderr); }
  for (const kind of ['escaped', 'reopened']) { const a = rec('88.7', 'defect', ['--reason', kind], next()); ok(`defect kind ${kind} is accepted`, a.status === 0, a.stderr); }
  const a = rec('88.7', 'accepted', [], next()); ok('accepted is recorded', a.status === 0, a.stderr);
  ({ s } = summary(['--story', '88.7']));
  ok('88.7: review rounds 3, defects 1 and 1, measured', is(metric(s, '88.7', 'reviewRounds'), 3, 'measured') && is(metric(s, '88.7', 'defectsEscaped'), 1, 'measured') && is(metric(s, '88.7', 'defectsReopened'), 1, 'measured'), JSON.stringify([metric(s, '88.7', 'reviewRounds'), metric(s, '88.7', 'defectsEscaped')]));
  ok('88.7: blocked total 5 minutes, cycle from preparation start to acceptance', is(metric(s, '88.7', 'blockedMs'), 300000, 'measured') && is(metric(s, '88.7', 'cycleElapsedMs'), 23 * 60000, 'measured'), JSON.stringify([metric(s, '88.7', 'blockedMs'), metric(s, '88.7', 'cycleElapsedMs')])); }

// ---- 4. refusals leave the log unchanged ------------------------------------------------------------
rec('88.4', 'phase-start', ['--phase', 'review'], T(13));
const refusals = [
  ['phase-end without a start', () => rec('88.3', 'phase-end', ['--phase', 'implementation'], T(13))],
  ['a second start of an open phase', () => rec('88.4', 'phase-start', ['--phase', 'review'], T(13, 5))],
  ['an unknown phase', () => rec('88.3', 'phase-start', ['--phase', 'coding'], T(13))],
  ['an unknown event type', () => rec('88.3', 'keystroke', [], T(13))],
  ['a derived-only type through record', () => rec('88.3', 'evaluated', ['--value', '1'], T(13))],
  ['an unknown option', () => rec('88.3', 'phase-start', ['--phase', 'review', '--keystrokes', '42'], T(13))],
  ['a note longer than 200 characters', () => rec('88.3', 'defect', ['--reason', 'escaped', '--note', 'x'.repeat(201)], T(13))],
  ['blocked-start without a reason', () => rec('88.3', 'blocked-start', [], T(13))],
  ['blocked-end without a start', () => rec('88.3', 'blocked-end', [], T(13))],
  ['an unknown blocked reason', () => rec('88.3', 'blocked-start', ['--reason', 'coffee'], T(13))],
  ['negative recorded effort', () => rec('88.3', 'effort-recorded', ['--phase', 'implementation', '--value', '-1', '--unit', 'hours'], T(13))],
  ['effort in another unit', () => rec('88.3', 'effort-recorded', ['--phase', 'implementation', '--value', '2', '--unit', 'minutes'], T(13))],
  ['retracting an event that does not exist', () => rec('88.3', 'retract', ['--corrects', '999', '--note', 'no such event'], T(13))],
  ['retracting without a note', () => rec('88.3', 'retract', ['--corrects', '1'], T(13))],
];
for (const [name, fn] of refusals) {
  const before = read(LOG); const res = fn();
  ok(`refused: ${name}`, res.status !== 0 && read(LOG).equals(before), `exit ${res.status}; ${res.stderr}`);
}

// ---- 5. retraction is append-only -------------------------------------------------------------------
r = rec('88.1', 'effort-recorded', ['--phase', 'implementation', '--value', '3', '--unit', 'hours'], T(14));
const effortSeq = events(LOG).at(-1).seq;
ok('effort-recorded is always recorded', events(LOG).at(-1).provenance === 'recorded', lines(LOG).at(-1));
({ s } = summary(['--story', '88.1']));
ok('recorded effort 3 h', is(metric(s, '88.1', 'recordedEffortHours'), 3, 'recorded'), JSON.stringify(metric(s, '88.1', 'recordedEffortHours')));
const effortLine = lines(LOG)[effortSeq - 1];
r = rec('88.1', 'retract', ['--corrects', String(effortSeq), '--note', 'entered in error'], T(14, 5));
ok('retract exits 0', r.status === 0, r.stderr);
ok('the retracted line is unchanged', lines(LOG)[effortSeq - 1] === effortLine);
({ s } = summary(['--story', '88.1']));
ok('a retracted value no longer counts', is(metric(s, '88.1', 'recordedEffortHours'), null, 'unknown'), JSON.stringify(metric(s, '88.1', 'recordedEffortHours')));
{ const before = read(LOG); const res = rec('88.1', 'retract', ['--corrects', String(effortSeq), '--note', 'again'], T(14, 6)); ok('refused: retracting twice', res.status !== 0 && read(LOG).equals(before), res.stderr); }

// ---- 6. tampering is detected -----------------------------------------------------------------------
const good = lines(LOG);
const tamper = (name, mutate) => {
  const p = path.join(tmp, `tampered-${name.replace(/\W+/g, '-')}.jsonl`);
  fs.writeFileSync(p, mutate([...good]).join('\n') + '\n');
  const v = run(['verify', '--log', p]); const sm = run(['summary', '--log', p]);
  ok(`tamper detected: ${name}`, v.status !== 0 && sm.status !== 0, `verify ${v.status} summary ${sm.status} ${v.stdout}${v.stderr}`);
};
tamper('an edited value', (ls) => { const e = JSON.parse(ls[1]); e.at = T(9, 59); ls[1] = JSON.stringify(e); return ls; });
tamper('a removed line', (ls) => { ls.splice(2, 1); return ls; });
tamper('reordered lines', (ls) => { [ls[1], ls[2]] = [ls[2], ls[1]]; return ls; });
tamper('an inserted line', (ls) => { ls.splice(1, 0, ls[1]); return ls; });
tamper('an extra key on the last line', (ls) => { const e = JSON.parse(ls.at(-1)); e.keystrokes = 12; ls[ls.length - 1] = JSON.stringify(e); return ls; });
{ const p = path.join(tmp, 'tampered-edit-name.jsonl'); const ls = [...good]; const e = JSON.parse(ls[1]); e.at = T(9, 59); ls[1] = JSON.stringify(e); fs.writeFileSync(p, ls.join('\n') + '\n'); const v = run(['verify', '--log', p]); ok('verify names the first bad seq', /\b(2|3)\b/.test(v.stdout + v.stderr), v.stdout + v.stderr); }

// ---- 7. derivation from a fixture repository and ledger ------------------------------------------------
const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo);
const g = (args, date) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...baseEnv, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid', ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } }).trim();
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const commit = (msg, date) => { g(['add', '-A']); g(['commit', '-q', '--no-gpg-sign', '-m', msg], date); return g(['rev-parse', 'HEAD']); };
g(['init', '-q', '-b', 'main']);
put('tooling/evaluator/policy.json', fs.readFileSync(POLICY, 'utf8'));
put('pkg/x.test.mjs', "test('one', () => {});\n");
const base = commit('base', '2030-02-01T09:00:00Z');
put('README.md', 'anchor\n');
const anchor = commit('anchor', '2030-02-01T10:00:00Z');
put('pkg/y.test.mjs', "test('a', () => {});\ntest('b', () => {});\n");
const c1 = commit('c1', '2030-02-01T10:20:00Z');
put('pkg/x.test.mjs', "test('one', () => {});\ntest('two', () => {});\n");
const c2 = commit('c2', '2030-02-01T11:00:00Z');
put('svc/z_test.go', 'package z\n\nfunc TestA(t *testing.T) {}\n\nfunc TestB(t *testing.T) {}\n');
const c3 = commit('c3', '2030-02-01T11:30:00Z');
put('NOTES.md', 'integrated\n');
const integ = commit('integration', '2030-02-01T12:00:00Z');
g(['checkout', '-q', '-b', 'side', base]); put('side.txt', 'x\n'); const side = commit('side', '2030-02-01T12:30:00Z'); g(['checkout', '-q', 'main']);
const OID = 'story-88-5-fixture';
const state = path.join(tmp, 'state'); const evidence = path.join(tmp, 'evidence');
const iters = [[1, c1, anchor, 'FAIL', 'CORRECT', '2030-02-01T10:30:00.000Z', '2030-02-01T10:31:00.000Z'],
  [2, c2, c1, 'FAIL', 'CORRECT', '2030-02-01T11:05:00.000Z', '2030-02-01T11:07:00.000Z'],
  [3, c3, c2, 'PASS', 'CANDIDATE_READY_FOR_ACCEPTANCE', '2030-02-01T11:40:00.000Z', '2030-02-01T11:43:00.000Z']];
const chain = []; let prev = null;
for (const [n, cand, parent, verdict, decision, started, at] of iters) {
  const dir = `${cand.slice(0, 12)}-${started.replace(/[:.]/g, '-')}`;
  const recDir = path.join(evidence, OID, 'v1', dir); fs.mkdirSync(recDir, { recursive: true });
  const bytes = Buffer.from(JSON.stringify({ schema: 'servvia.evaluation-record/v1', evaluatedAt: started, verdict, candidate: cand }, null, 2) + '\n');
  fs.writeFileSync(path.join(recDir, 'record.json'), bytes);
  const it = { n, candidate: cand, parentCandidate: n === 1 ? null : parent, at, verdict, decision, recordSha256: sha(bytes), evidenceDir: `/elsewhere/evidence/${OID}/v1/${dir}`, prevHash: prev };
  chain.push(it); prev = sha(Buffer.from(JSON.stringify(it)));
}
const ledger = { schema: 'servvia.iteration-ledger/v1', objectiveId: OID, versions: [{ version: 1, anchorCommit: anchor, objectiveSha256: 'f'.repeat(64), baseline: base, status: 'passed', stopReason: null, iterations: chain }], lessonCandidates: [] };
ledger.integrity = sha(Buffer.from(JSON.stringify((({ integrity, ...c }) => c)(ledger))));
fs.mkdirSync(path.join(state, OID), { recursive: true });
fs.writeFileSync(path.join(state, OID, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
const tree = (d) => { const out = {}; const walk = (x) => { for (const n of fs.readdirSync(x)) { const p = path.join(x, n); if (fs.statSync(p).isDirectory()) walk(p); else out[path.relative(d, p)] = sha(fs.readFileSync(p)); } }; walk(d); return JSON.stringify(out); };
const stateBefore = tree(state); const evidenceBefore = tree(evidence); const headBefore = g(['rev-parse', 'HEAD']); const refsBefore = g(['for-each-ref']);
const DLOG = path.join(tmp, 'derived.jsonl');
const derive = (extra = [], log = DLOG, st = state, evd = evidence) => run(['derive', '--log', log, '--repo', repo, '--objective-id', OID, '--story', '88.5', '--state-dir', st, '--evidence-dir', evd, ...extra]);
r = derive(['--integration', integ]);
ok('derive exits 0', r.status === 0, r.stderr);
const dv = events(DLOG);
const of = (t) => dv.filter((e) => e.type === t);
ok('derived events: 1 frozen, 3 candidate, 3 evaluated, 1 test-growth, 1 integrated', of('frozen').length === 1 && of('candidate').length === 3 && of('evaluated').length === 3 && of('test-growth').length === 1 && of('integrated').length === 1 && dv.length === 9, dv.map((e) => e.type).join());
ok('all derived, with the objective id', dv.every((e) => e.provenance === 'derived' && e.objectiveId === OID && e.story === '88.5'));
ok('frozen at the anchor committer time', of('frozen')[0] && of('frozen')[0].at === '2030-02-01T10:00:00.000Z' && of('frozen')[0].refs.anchor === anchor && of('frozen')[0].refs.baseline === base, JSON.stringify(of('frozen')[0]));
ok('candidates at their committer times with parents', JSON.stringify(of('candidate').map((e) => [e.at, e.refs.candidate, e.refs.parent])) === JSON.stringify([['2030-02-01T10:20:00.000Z', c1, anchor], ['2030-02-01T11:00:00.000Z', c2, c1], ['2030-02-01T11:30:00.000Z', c3, c2]]), JSON.stringify(of('candidate')));
ok('evaluated events carry iteration, verdict, decision, record and start', JSON.stringify(of('evaluated').map((e) => [e.value, e.at, e.refs.startedAt, e.refs.verdict, e.refs.decision, e.refs.candidate, e.refs.record])) === JSON.stringify(chain.map((it, i) => [it.n, it.at, iters[i][5], it.verdict, it.decision, it.candidate, it.recordSha256])), JSON.stringify(of('evaluated')));
ok('test growth = +2 (new file) +1 (grown file) +2 (Go) = 5', of('test-growth')[0] && of('test-growth')[0].value === 5 && of('test-growth')[0].refs.candidate === c3 && of('test-growth')[0].refs.anchor === anchor, JSON.stringify(of('test-growth')[0]));
ok('integrated at the integration committer time', of('integrated')[0] && of('integrated')[0].at === '2030-02-01T12:00:00.000Z' && of('integrated')[0].refs.commit === integ && of('integrated')[0].refs.candidate === c3, JSON.stringify(of('integrated')[0]));
({ s } = summary(['--story', '88.5'], DLOG));
const expect = { evaluatorIterations: [3, 'derived'], correctionIterations: [2, 'derived'], firstPassVerdict: ['FAIL', 'derived'], implementationElapsedMs: [1200000, 'derived'], evaluationElapsedMs: [60000 + 120000 + 180000, 'derived'], testDeclarationsAdded: [5, 'derived'], cycleElapsedMs: [7200000, 'derived'],
  preparationElapsedMs: [null, 'unknown'], implementationEffectiveMs: [null, 'unknown'], reviewRounds: [null, 'unknown'], blockedMs: [null, 'unknown'], recordedEffortHours: [null, 'unknown'], defectsEscaped: [null, 'unknown'], defectsReopened: [null, 'unknown'] };
for (const [m, [v, p]] of Object.entries(expect)) ok(`derived summary ${m} = ${v} (${p})`, is(metric(s, '88.5', m), v, p), JSON.stringify(metric(s, '88.5', m)));
ok('the ledger and records are byte-identical after derive', tree(state) === stateBefore && tree(evidence) === evidenceBefore);
ok('the repository is unchanged after derive', g(['rev-parse', 'HEAD']) === headBefore && g(['for-each-ref']) === refsBefore && g(['status', '--porcelain']) === '');
{ const before = read(DLOG); r = derive(['--integration', integ]); ok('derive is idempotent (second run appends nothing)', r.status === 0 && read(DLOG).equals(before), r.stderr); }

// ---- 8. tampered inputs are refused ----------------------------------------------------------------------
const copyDir = (a, b) => fs.cpSync(a, b, { recursive: true });
{ const st2 = path.join(tmp, 'state-tampered'); copyDir(state, st2); const lp = path.join(st2, OID, 'ledger.json'); const l = JSON.parse(fs.readFileSync(lp, 'utf8')); l.versions[0].iterations[0].verdict = 'PASS'; fs.writeFileSync(lp, JSON.stringify(l, null, 2) + '\n');
  const p = path.join(tmp, 'd-tampered-ledger.jsonl'); const res = derive([], p, st2); ok('refused: a ledger whose chain or seal does not verify', res.status !== 0 && read(p).length === 0, res.stderr); }
{ const ev2 = path.join(tmp, 'evidence-tampered'); copyDir(evidence, ev2); const recs = []; const walk = (x) => { for (const n of fs.readdirSync(x)) { const q = path.join(x, n); if (fs.statSync(q).isDirectory()) walk(q); else recs.push(q); } }; walk(ev2); fs.appendFileSync(recs[0], ' ');
  const p = path.join(tmp, 'd-tampered-record.jsonl'); const res = derive([], p, state, ev2); ok('refused: a record whose SHA-256 differs from the ledger', res.status !== 0 && read(p).length === 0, res.stderr); }
{ const p = path.join(tmp, 'd-not-ancestor.jsonl'); const res = derive(['--integration', side], p); ok('refused: an integration commit that does not contain the candidate', res.status !== 0 && read(p).length === 0, res.stderr); }

// ---- 9. retrospectives, program view, determinism ------------------------------------------------------------
fs.copyFileSync(DLOG, path.join(tmp, 'combined.jsonl'));
const combined = path.join(tmp, 'combined.jsonl');
run(['record', '--log', combined, '--story', '88.6', '--type', 'review-decision', '--reason', 'revise'], T(15));
({ s } = summary([], combined));
ok('program first-pass rate over known verdicts only', s && s.program && s.program.firstPassRate && s.program.firstPassRate.n === 1 && s.program.firstPassRate.value === 0, JSON.stringify(s && s.program && s.program.firstPassRate));
ok('program metrics report n and unknown counts', s && s.program && s.program.evaluatorIterations && s.program.evaluatorIterations.n === 1 && s.program.evaluatorIterations.unknown === 1, JSON.stringify(s && s.program && s.program.evaluatorIterations));
ok('review rounds counted when recorded', is(metric(s, '88.6', 'reviewRounds'), 1, 'measured'), JSON.stringify(metric(s, '88.6', 'reviewRounds')));
{ const a = run(['summary', '--log', LOG, '--epic', '88']); const b = run(['summary', '--log', LOG, '--epic', '88']); const t1 = run(['summary', '--log', LOG, '--format', 'text']); const t2 = run(['summary', '--log', LOG, '--format', 'text']);
  ok('JSON summary is byte-identical across runs', a.status === 0 && a.stdout === b.stdout && a.stdout.length > 0);
  ok('text summary is byte-identical across runs and names metrics with provenance', t1.status === 0 && t1.stdout === t2.stdout && /88\.1/.test(t1.stdout) && /implementationEffectiveMs/.test(t1.stdout) && /measured/.test(t1.stdout) && /unknown/.test(t1.stdout), t1.stdout.slice(0, 300));
  const e1 = run(['summary', '--log', LOG, '--epic', '1']); let parsed = null; try { parsed = JSON.parse(e1.stdout); } catch { /* */ }
  ok('--epic selects only that epic', parsed && Array.isArray(parsed.stories) && parsed.stories.every((x) => /^1\./.test(x.story)) && !parsed.stories.some((x) => x.story.startsWith('88')), e1.stdout.slice(0, 200)); }
{ const p = path.join(tmp, 'order.jsonl'); for (const st of ['12.3a', '1.10', '1.9', '2.1']) run(['record', '--log', p, '--story', st, '--type', 'accepted'], T(16));
  const o = JSON.parse(run(['summary', '--log', p]).stdout || '{"stories":[]}'); ok('stories in numeric order', JSON.stringify(o.stories.map((x) => x.story)) === JSON.stringify(['1.9', '1.10', '2.1', '12.3a']), JSON.stringify(o.stories.map((x) => x.story))); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `FAIL ${bad} contract assertion(s) failed` : 'ok   the telemetry contract holds');
process.exit(bad ? 1 : 0);

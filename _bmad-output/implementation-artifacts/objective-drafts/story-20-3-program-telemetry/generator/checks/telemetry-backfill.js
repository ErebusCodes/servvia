// telemetry-backfill (Story 20.3). The repository telemetry log must hold, for each of the seven governed
// stories completed before Story 20.3, exactly the derived events the contract defines, and nothing measured
// or recorded. EXPECTED is fixed in the objective by its generator from immutable sources: committer times and
// test files of the stories' commits (git objects at the baseline, test declarations counted with the
// evaluator's own countTests over its policy's testFiles), and each story's ledger facts (chain-verified
// ledgers, SHA-256-checked records). The log's hash chain is verified independently here, and the candidate's
// own summary must show the derived facts and every unmeasured value as unknown. Generated constants: LOG, EXPECTED.
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const crypto = require('node:crypto');
const LOG = __LOG__;
const EXPECTED = __EXPECTED__;
let bad = 0;
const ok = (name, cond, detail) => { if (!cond) bad += 1; console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : ': ' + String(detail).slice(0, 500))); };
if (!fs.existsSync(LOG)) { console.log('FAIL the telemetry log ' + LOG + ' does not exist'); process.exit(1); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const L = fs.readFileSync(LOG, 'utf8').split('\n');
ok('the log ends with a newline', L.pop() === '');
let ev = []; let chainOk = true;
try { ev = L.map((l) => JSON.parse(l)); } catch { chainOk = false; }
ev.forEach((e, i) => { if (e.seq !== i + 1 || e.prev !== (i === 0 ? null : sha(Buffer.from(L[i - 1], 'utf8')))) chainOk = false; });
ok('the log hash chain verifies independently', chainOk && ev.length > 0);
const canon = (e) => JSON.stringify([e.type, e.at, e.objectiveId, e.value ?? null, Object.keys(e.refs || {}).sort().map((k) => [k, e.refs[k]])]);
const r = spawnSync(process.execPath, ['tooling/telemetry/bin/telemetry.mjs', 'summary', '--log', LOG], { encoding: 'utf8', timeout: 120000 });
let s = null; try { s = JSON.parse(r.stdout); } catch { /* reported below */ }
ok('the candidate summarises the log', r.status === 0 && s && Array.isArray(s.stories), r.stderr);
const metric = (story, m) => { const st = s && Array.isArray(s.stories) && s.stories.find((x) => x.story === story); return st && st.metrics ? st.metrics[m] : undefined; };
for (const x of EXPECTED) {
  const mine = ev.filter((e) => e.story === x.story);
  ok(`${x.story}: only derived events, all with the objective id`, mine.length > 0 && mine.every((e) => e.provenance === 'derived' && e.objectiveId === x.objectiveId), JSON.stringify(mine.find((e) => e.provenance !== 'derived' || e.objectiveId !== x.objectiveId) || null));
  const got = mine.map(canon).sort(); const want = x.events.map(canon).sort();
  ok(`${x.story}: exactly the derived events git and the ledger give`, JSON.stringify(got) === JSON.stringify(want), `got ${got.length}, want ${want.length}; first difference: ${want.find((w) => !got.includes(w)) || got.find((g) => !want.includes(g))}`);
  const wrong = Object.entries(x.metrics).filter(([m, w]) => { const g = metric(x.story, m); return !g || g.value !== w.value || g.provenance !== w.provenance; });
  ok(`${x.story}: summary shows the derived facts and unknown for everything unmeasured`, wrong.length === 0, wrong.map(([m, w]) => `${m}: got ${JSON.stringify(metric(x.story, m))}, want ${JSON.stringify(w)}`).join('; '));
}
console.log(bad ? `FAIL ${bad} backfill assertion(s) failed` : `ok   the backfill of ${EXPECTED.length} governed stories is exact`);
process.exit(bad ? 1 : 0);

// Required tests of Story 20.3 (RT-1…RT-6). Each runs the CLI as a child process against temporary logs,
// fixture git repositories and fixture evaluator ledgers; nothing outside a temporary directory is touched.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO_ROOT, 'tooling/telemetry/bin/telemetry.mjs');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'SERVVIA_TELEMETRY_CLOCK'));

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'servvia-telemetry-rt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'log.jsonl');
  const run = (args, clock) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: clock ? { ...cleanEnv, SERVVIA_TELEMETRY_CLOCK: clock } : cleanEnv });
  const record = (story, type, extra, clock) => run(['record', '--log', log, '--story', story, '--type', type, ...(extra ?? [])], clock ?? '2032-03-01T08:00:00.000Z');
  const metrics = (story) => {
    const r = run(['summary', '--log', log, '--story', story]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).stories.find((s) => s.story === story).metrics;
  };
  return { dir, log, run, record, metrics };
}

/** A fixture repository with an anchor and two candidates, and a sealed, chained ledger with a correction. */
function governedFixture(dir) {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (args, when) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...cleanEnv, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid', ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) },
  }).trim();
  const write = (path, text) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); };
  const commitAt = (when) => { git(['add', '-A']); git(['commit', '-q', '--no-gpg-sign', '-m', `at ${when}`], when); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q']);
  write('tooling/evaluator/policy.json', readFileSync(join(REPO_ROOT, 'tooling/evaluator/policy.json'), 'utf8'));
  write('src/a_test.go', 'package a\n\nfunc TestOne(t *testing.T) {}\n');
  const baseline = commitAt('2032-03-01T07:00:00Z');
  write('README.md', 'frozen\n');
  const anchor = commitAt('2032-03-01T08:00:00Z');
  write('src/a_test.go', 'package a\n\nfunc TestOne(t *testing.T) {}\n\nfunc TestTwo(t *testing.T) {}\n');
  const first = commitAt('2032-03-01T08:45:00Z');
  write('web/b.spec.ts', "it('works', () => {});\n");
  const second = commitAt('2032-03-01T09:15:00Z');
  const objectiveId = 'story-97-2-fixture';
  const state = join(dir, 'state');
  const evidence = join(dir, 'evidence');
  const iterations = [];
  let prevHash = null;
  for (const [n, candidate, parent, verdict, decision, started, finished] of [
    [1, first, null, 'FAIL', 'CORRECT', '2032-03-01T08:50:00.000Z', '2032-03-01T08:52:00.000Z'],
    [2, second, first, 'PASS', 'CANDIDATE_READY_FOR_ACCEPTANCE', '2032-03-01T09:20:00.000Z', '2032-03-01T09:21:30.000Z'],
  ]) {
    const name = `${candidate.slice(0, 12)}-run`;
    const bytes = Buffer.from(`${JSON.stringify({ evaluatedAt: started, verdict }, null, 2)}\n`);
    mkdirSync(join(evidence, objectiveId, 'v1', name), { recursive: true });
    writeFileSync(join(evidence, objectiveId, 'v1', name, 'record.json'), bytes);
    const entry = { n, candidate, parentCandidate: parent, at: finished, verdict, decision, recordSha256: hash(bytes), evidenceDir: `/evaluations/${name}`, prevHash };
    iterations.push(entry);
    prevHash = hash(JSON.stringify(entry));
  }
  const ledger = { schema: 'servvia.iteration-ledger/v1', objectiveId, versions: [{ version: 1, anchorCommit: anchor, objectiveSha256: 'a'.repeat(64), baseline, status: 'passed', stopReason: null, iterations }], lessonCandidates: [] };
  ledger.integrity = hash(JSON.stringify(ledger));
  mkdirSync(join(state, objectiveId), { recursive: true });
  writeFileSync(join(state, objectiveId, 'ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  return { repo, state, evidence, objectiveId, git };
}

function fingerprint(dir) {
  const files = {};
  const walk = (d) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = hash(readFileSync(p)); } };
  walk(dir);
  return files;
}

test('telemetry: the event log is append-only and hash-chained', (t) => {
  const { log, run, record } = workspace(t);
  assert.equal(record('97.1', 'phase-start', ['--phase', 'implementation'], '2032-03-01T08:00:00.000Z').status, 0);
  assert.equal(record('97.1', 'phase-end', ['--phase', 'implementation'], '2032-03-01T09:00:00.000Z').status, 0);
  assert.equal(record('97.1', 'defect', ['--reason', 'escaped'], '2032-03-01T09:30:00.000Z').status, 0);
  const lines = readFileSync(log, 'utf8').split('\n').slice(0, -1);
  assert.deepEqual(lines.map((l) => JSON.parse(l).seq), [1, 2, 3]);
  assert.equal(JSON.parse(lines[0]).prev, null);
  assert.equal(JSON.parse(lines[2]).prev, hash(lines[1]));
  assert.match(run(['verify', '--log', log]).stdout, /^ok 3 events/);

  const before = readFileSync(log);
  assert.notEqual(record('97.1', 'phase-end', ['--phase', 'implementation']).status, 0);
  assert.notEqual(record('97.1', 'candidate').status, 0);
  assert.deepEqual(readFileSync(log), before);

  assert.equal(record('97.1', 'retract', ['--corrects', '3', '--note', 'not a defect after all']).status, 0);
  assert.equal(readFileSync(log, 'utf8').split('\n')[2], lines[2]);
  assert.notEqual(record('97.1', 'retract', ['--corrects', '3', '--note', 'again']).status, 0);

  writeFileSync(log, `${[lines[0], lines[2], lines[1]].join('\n')}\n`);
  assert.notEqual(run(['verify', '--log', log]).status, 0);
  assert.notEqual(run(['summary', '--log', log]).status, 0);
});

test('telemetry: unknown values stay unknown', (t) => {
  const { record, metrics } = workspace(t);
  record('97.4', 'accepted');
  const m = metrics('97.4');
  for (const name of ['preparationElapsedMs', 'implementationElapsedMs', 'implementationEffectiveMs', 'evaluationElapsedMs', 'evaluatorIterations', 'correctionIterations', 'firstPassVerdict', 'reviewRounds', 'blockedMs', 'recordedEffortHours', 'testDeclarationsAdded', 'defectsEscaped', 'defectsReopened', 'cycleElapsedMs']) {
    assert.equal(m[name].value, null, name);
    assert.equal(m[name].provenance, 'unknown', name);
  }
});

test('telemetry: blocked time is kept separate from effort', (t) => {
  const { record, metrics } = workspace(t);
  record('97.5', 'phase-start', ['--phase', 'implementation'], '2032-03-01T08:00:00.000Z');
  record('97.5', 'blocked-start', ['--reason', 'authorization'], '2032-03-01T08:15:00.000Z');
  record('97.5', 'blocked-end', [], '2032-03-01T08:45:00.000Z');
  record('97.5', 'phase-end', ['--phase', 'implementation'], '2032-03-01T09:00:00.000Z');
  const m = metrics('97.5');
  assert.deepEqual([m.implementationElapsedMs.value, m.implementationEffectiveMs.value, m.blockedMs.value], [3600000, 1800000, 1800000]);
  assert.equal(m.implementationEffectiveMs.provenance, 'measured');
});

test('telemetry: iterations and corrections are derived from the ledger', (t) => {
  const { dir, log, run, metrics } = workspace(t);
  const f = governedFixture(dir);
  const args = ['derive', '--log', log, '--repo', f.repo, '--objective-id', f.objectiveId, '--story', '97.2', '--state-dir', f.state, '--evidence-dir', f.evidence];
  const r = run(args);
  assert.equal(r.status, 0, r.stderr);
  const m = metrics('97.2');
  assert.deepEqual([m.evaluatorIterations.value, m.correctionIterations.value, m.firstPassVerdict.value], [2, 1, 'FAIL']);
  assert.deepEqual([m.implementationElapsedMs.value, m.implementationElapsedMs.provenance], [2700000, 'derived']);
  assert.deepEqual([m.evaluationElapsedMs.value, m.testDeclarationsAdded.value], [210000, 2]);
  assert.equal(m.preparationElapsedMs.provenance, 'unknown');
  const before = readFileSync(log);
  assert.equal(run(args).status, 0);
  assert.deepEqual(readFileSync(log), before);
});

test('telemetry: deriving never writes evaluator state', (t) => {
  const { dir, log, run } = workspace(t);
  const f = governedFixture(dir);
  const snapshot = () => [fingerprint(f.state), fingerprint(f.evidence), f.git(['rev-parse', 'HEAD']), f.git(['status', '--porcelain'])];
  const before = snapshot();
  const r = run(['derive', '--log', log, '--repo', f.repo, '--objective-id', f.objectiveId, '--story', '97.2', '--state-dir', f.state, '--evidence-dir', f.evidence]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(log, 'utf8'), /"type":"evaluated"/);
  assert.deepEqual(snapshot(), before);

  const forgedEvidence = join(dir, 'forged-evidence');
  cpSync(f.evidence, forgedEvidence, { recursive: true });
  const runDir = readdirSync(join(forgedEvidence, f.objectiveId, 'v1'))[0];
  writeFileSync(join(forgedEvidence, f.objectiveId, 'v1', runDir, 'record.json'), '{"evaluatedAt":"2032-03-01T00:00:00.000Z","verdict":"PASS"}\n');
  const other = join(dir, 'other.jsonl');
  assert.notEqual(run(['derive', '--log', other, '--repo', f.repo, '--objective-id', f.objectiveId, '--story', '97.2', '--state-dir', f.state, '--evidence-dir', forgedEvidence]).status, 0);
});

test('telemetry: the summary is deterministic', (t) => {
  const { log, run, record } = workspace(t);
  for (const id of ['10.5b', '2.11', '2.9', '10.5a']) record(id, 'review-decision', ['--reason', 'accept']);
  const json = [run(['summary', '--log', log]), run(['summary', '--log', log])];
  assert.equal(json[0].stdout, json[1].stdout);
  assert.deepEqual(JSON.parse(json[0].stdout).stories.map((s) => s.story), ['2.9', '2.11', '10.5a', '10.5b']);
  const text = [run(['summary', '--log', log, '--format', 'text']), run(['summary', '--log', log, '--format', 'text'])];
  assert.equal(text[0].stdout, text[1].stdout);
  assert.match(text[0].stdout, /reviewRounds = 1 \(measured/);
});

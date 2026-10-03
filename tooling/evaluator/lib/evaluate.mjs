import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  diffBytes, gitVersion, hashObject, isAncestor, lsTree, resolveCommit, shortStat, showFile, treeId,
} from './git.mjs';
import { checkBaseline, loadFrozenObjective, sha256 } from './objective.mjs';
import { staticIntegrity } from './integrity.mjs';
import { createWorkspace } from './workspace.mjs';
import { startPostgres, startRedis } from './services.mjs';
import { runCheck, runProcess } from './runners.mjs';
import { computeVerdict, evaluateCheck, evaluateRequiredTests } from './verdict.mjs';
import { redact, redactDeep, secretValues } from './redact.mjs';

export const EVALUATOR_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EVALUATOR_PATH = 'tooling/evaluator';
export const RECORD_SCHEMA = 'servvia.evaluation-record/v1';

function localFiles(root, base = root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? localFiles(path, base) : [relative(base, path)];
  });
}

/**
 * The evaluator running now must be the evaluator frozen with the objective:
 * every file identical to the anchor commit's tooling/evaluator, nothing
 * added. A candidate cannot supply its own judge.
 */
export function authenticateEvaluator(repo, anchorCommit, root = EVALUATOR_ROOT) {
  const frozen = lsTree(repo, anchorCommit, EVALUATOR_PATH);
  if (frozen.size === 0) return `the anchor commit has no ${EVALUATOR_PATH}`;
  const local = new Set(localFiles(root).map((f) => `${EVALUATOR_PATH}/${f}`));
  for (const [path, blob] of frozen) {
    if (!local.has(path)) return `${path} is missing from the running evaluator`;
    if (hashObject(repo, join(root, path.slice(EVALUATOR_PATH.length + 1))) !== blob) {
      return `${path} differs from the anchor commit`;
    }
  }
  const extra = [...local].filter((p) => !frozen.has(p));
  return extra.length ? `the running evaluator has files the anchor does not: ${extra.join(', ')}` : null;
}

function toolVersion(argv) {
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim().split('\n')[0] : null;
}

function buildEnv({ base, tools, home, goCache, services }) {
  const path = [dirname(process.execPath), tools.goRoot && join(tools.goRoot, 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    .filter(Boolean).join(':');
  const env = { ...base, PATH: path, HOME: home, TZ: 'UTC', LANG: 'C.UTF-8', CI: 'true' };
  if (tools.goRoot) {
    Object.assign(env, {
      GOROOT: tools.goRoot, GOMODCACHE: tools.goModCache, GOCACHE: goCache, GOPATH: join(home, 'gopath'),
      GOFLAGS: '-mod=readonly', GOPROXY: 'off', GOTOOLCHAIN: 'local', GOTELEMETRY: 'off', GOSUMDB: 'off',
    });
  }
  if (services.redis) Object.assign(env, { REDIS_HOST: services.redis.host, REDIS_PORT: String(services.redis.port), SERVVIA_CORE_TEST_REDIS_ADDR: `${services.redis.host}:${services.redis.port}` });
  return env;
}

function withDatabase(env, services, db) {
  if (!services.postgres) return env;
  const url = services.postgres.url(db);
  return { ...env, DATABASE_URL: url, SERVVIA_CORE_TEST_DATABASE_URL: url };
}

/** Runs setup steps, then the given checks, in one workspace. */
function runPhase({ objective, checks, cwd, env, scratch, tools, label, retry }) {
  const setup = [];
  for (const step of objective.setup ?? []) {
    const argv = step.run[0] === 'node' ? [process.execPath, ...step.run.slice(1)] : step.run;
    const res = runProcess(argv, { cwd: join(cwd, step.cwd ?? '.'), env, timeoutSeconds: step.timeoutSeconds ?? 600 });
    setup.push({ id: step.id, exitCode: res.exitCode, failure: step.failure ?? 'fail', stdout: res.stdout, stderr: res.stderr, spawnError: res.spawnError });
    if (res.exitCode !== 0) return { setup, runs: {}, setupFailed: setup.at(-1) };
  }
  const runs = {};
  for (const check of checks) {
    const ctx = { node: process.execPath, go: tools.goRoot ? join(tools.goRoot, 'bin', 'go') : 'go', cwd: join(cwd, check.cwd ?? '.'), env: { ...env, ...(check.env ?? {}) }, scratch, attempt: `${label}-1` };
    const started = Date.now();
    let run = runCheck(check, ctx);
    run.durationMs = Date.now() - started;
    const failed = !run.harnessError && (run.counts.failed > 0 || run.exitCode !== 0);
    if (retry && failed && check.runner !== 'command') {
      const second = runCheck(check, { ...ctx, attempt: `${label}-2` });
      if (!second.harnessError && second.counts.failed === 0 && second.exitCode === 0) {
        run = { ...run, flaky: true, retry: { counts: second.counts, exitCode: second.exitCode } };
      } else {
        run = { ...run, retry: { counts: second.counts, exitCode: second.exitCode } };
      }
    }
    runs[check.id] = run;
  }
  return { setup, runs };
}

function excerpts(runs, setup, secrets) {
  const out = [];
  for (const step of setup ?? []) {
    if (step.exitCode !== 0) out.push({ source: `setup:${step.id}`, text: redact(`${step.stderr}\n${step.stdout}`.split('\n').slice(-60).join('\n'), secrets) });
  }
  for (const [id, run] of Object.entries(runs ?? {})) {
    for (const t of run.tests.filter((x) => x.status === 'failed').slice(0, 10)) {
      out.push({ source: `check:${id}`, test: redact(t.name, secrets), text: redact((t.message ?? '').slice(0, 1500), secrets) });
    }
    if (run.exitCode !== 0 && run.tests.every((t) => t.status !== 'failed')) {
      out.push({ source: `check:${id}`, text: redact(`${run.stderr}\n${run.stdout}`.split('\n').slice(-60).join('\n'), secrets) });
    }
  }
  return out;
}

/**
 * Evaluate `candidate` against the objective frozen at `anchor`.
 * opts: { repo, anchor: { commit, objectivePath, objectiveSha256 }, candidate,
 *         evidenceRoot, tools: { nodeModules, goRoot, goModCache, pgBin, redisBin },
 *         evaluatorRoot, keepWorkspace }
 */
export async function evaluate(opts) {
  const { repo, anchor, evidenceRoot } = opts;
  const tools = opts.tools ?? {};
  const findings = [];
  const add = (severity, code, detail, extra = {}) => findings.push({ severity, code, detail, ...extra });
  const record = {
    schema: RECORD_SCHEMA,
    evaluatedAt: new Date().toISOString(),
    evaluator: { path: EVALUATOR_PATH, git: gitVersion(), node: process.version },
    objective: { path: anchor.objectivePath, approvedSha256: anchor.objectiveSha256 },
  };
  const scratch = mkdtempSync(join(tmpdir(), 'servvia-eval-'));
  const services = {};
  let objective;
  let secrets = [];
  const raw = [];
  try {
    const anchorCommit = resolveCommit(repo, anchor.commit);
    const candidate = resolveCommit(repo, opts.candidate);
    record.objective.anchorCommit = anchorCommit;
    record.candidate = candidate;
    if (!anchorCommit || !candidate) {
      add('HARNESS_ERROR', 'unknown-commit', `anchor ${anchor.commit} or candidate ${opts.candidate} is not a commit in ${repo}`);
      return finish();
    }
    record.evaluator.treeId = treeId(repo, anchorCommit, EVALUATOR_PATH);
    const notAuthentic = authenticateEvaluator(repo, anchorCommit, opts.evaluatorRoot ?? EVALUATOR_ROOT);
    record.evaluator.authentic = !notAuthentic;
    if (notAuthentic) {
      add('HARNESS_ERROR', 'evaluator-not-authentic', notAuthentic);
      return finish();
    }

    const loaded = loadFrozenObjective(repo, { ...anchor, commit: anchorCommit });
    record.objective.sha256 = loaded.digest ?? null;
    if (loaded.error) {
      add('INTEGRITY_VIOLATION', 'objective-anchor-mismatch', loaded.error);
      return finish();
    }
    if (loaded.invalid) {
      add('HARNESS_ERROR', 'objective-invalid', loaded.invalid.join('; '));
      return finish();
    }
    objective = loaded.objective;
    Object.assign(record.objective, { id: objective.objectiveId, storyId: objective.storyId, version: objective.version });
    record.baseline = objective.baseline;

    const wrongBaseline = checkBaseline(repo, anchorCommit, objective);
    if (wrongBaseline) add('INTEGRITY_VIOLATION', 'wrong-baseline', wrongBaseline);
    const descends = isAncestor(repo, anchorCommit, candidate);
    record.ancestry = { anchorIsAncestorOfCandidate: descends };
    if (!descends) add('INTEGRITY_VIOLATION', 'candidate-not-descendant', 'the candidate does not descend from the anchor commit');
    if (findings.length) return finish();

    record.diff = { shortStat: shortStat(repo, anchorCommit, candidate), sha256: sha256(diffBytes(repo, anchorCommit, candidate)) };
    const policy = JSON.parse(showFile(repo, anchorCommit, `${EVALUATOR_PATH}/policy.json`).toString('utf8'));
    const integrity = staticIntegrity({ repo, anchorCommit, candidateCommit: candidate, objective, objectivePath: anchor.objectivePath, policy });
    record.integrityFindings = integrity;
    findings.push(...integrity);
    if (integrity.some((f) => f.severity === 'INTEGRITY_VIOLATION')) return finish();

    // Evaluator-owned environment: the frozen file plus services; nothing inherited.
    const base = JSON.parse(showFile(repo, anchorCommit, `${EVALUATOR_PATH}/env/evaluation.json`).toString('utf8')).variables;
    const needs = objective.environment?.services ?? [];
    if (needs.includes('postgres')) services.postgres = await startPostgres({ bin: tools.pgBin, dir: join(scratch, 'pg'), timezone: objective.environment?.postgresTimezone ?? 'UTC' });
    if (needs.includes('redis')) services.redis = await startRedis({ bin: tools.redisBin });
    const home = join(scratch, 'home');
    mkdirSync(home, { recursive: true });
    const env = buildEnv({ base, tools, home, goCache: join(scratch, 'gocache'), services });
    secrets = secretValues(env);
    record.environment = {
      os: `${platform()} ${arch()}`, node: process.version, timezone: env.TZ,
      go: tools.goRoot ? toolVersion([join(tools.goRoot, 'bin', 'go'), 'version']) : null,
      postgres: services.postgres?.version ?? null, redis: services.redis?.version ?? null,
      variables: Object.keys(env).sort(),
    };

    // Candidate.
    services.postgres?.createDatabase('eval_candidate');
    const candidateDir = createWorkspace({ repo, commit: candidate, dest: join(scratch, 'candidate'), nodeModules: tools.nodeModules });
    const cand = runPhase({ objective, checks: objective.checks, cwd: candidateDir, env: withDatabase(env, services, 'eval_candidate'), scratch, tools, label: 'candidate', retry: true });
    record.setup = cand.setup.map(({ id, exitCode }) => ({ id, exitCode }));
    raw.push(...cand.setup.map((s) => ({ name: `setup-${s.id}.log`, content: `${s.stdout}\n--- stderr ---\n${s.stderr}` })));
    if (cand.setupFailed) {
      const sev = cand.setupFailed.failure === 'harness' || cand.setupFailed.spawnError ? 'HARNESS_ERROR' : 'FAIL';
      add(sev, 'setup-failed', `setup step ${cand.setupFailed.id} exited ${cand.setupFailed.exitCode}`);
    }

    // Baseline, with the required tests' sources placed on it.
    const expecting = (objective.requiredTests ?? []).filter((t) => t.expectBaselineFailure);
    let base_ = { runs: {} };
    if (!cand.setupFailed && expecting.length) {
      const checkIds = [...new Set(expecting.map((t) => t.check))];
      services.postgres?.createDatabase('eval_baseline');
      const baselineDir = createWorkspace({
        repo, commit: anchorCommit, dest: join(scratch, 'baseline'), nodeModules: tools.nodeModules,
        overlay: { commit: candidate, paths: [...new Set(expecting.flatMap((t) => t.files))] },
      });
      base_ = runPhase({ objective, checks: objective.checks.filter((c) => checkIds.includes(c.id)), cwd: baselineDir, env: withDatabase(env, services, 'eval_baseline'), scratch, tools, label: 'baseline', retry: false });
      if (base_.setupFailed) add('HARNESS_ERROR', 'baseline-setup-failed', `baseline setup step ${base_.setupFailed.id} exited ${base_.setupFailed.exitCode}`);
    }

    if (!cand.setupFailed) {
      for (const check of objective.checks) findings.push(...evaluateCheck(check, cand.runs[check.id], objective));
      findings.push(...evaluateRequiredTests(objective, cand.runs, base_.runs));
    }
    record.checks = objective.checks.map((c) => {
      const r = cand.runs[c.id];
      const b = base_.runs[c.id];
      if (r) raw.push({ name: `check-${c.id}.log`, content: `${r.stdout}\n--- stderr ---\n${r.stderr}` });
      return {
        id: c.id, category: c.category, runner: c.runner, mandatory: c.mandatory !== false,
        argv: c.args, exitCode: r?.exitCode ?? null, timedOut: r?.timedOut ?? false, durationMs: r?.durationMs ?? null,
        counts: r?.counts ?? null, flaky: r?.flaky ?? false, retry: r?.retry ?? null,
        skipped: (r?.tests ?? []).filter((t) => t.status === 'skipped').map((t) => t.name),
        baseline: b ? { exitCode: b.exitCode, counts: b.counts } : null,
      };
    });
    record.requiredTests = (objective.requiredTests ?? []).map((t) => ({ id: t.id, check: t.check, name: t.name, expectBaselineFailure: t.expectBaselineFailure, baselineException: t.baselineException ?? null }));
    record.excerpts = excerpts(cand.runs, cand.setup, secrets);
    return finish();
  } catch (err) {
    add('HARNESS_ERROR', 'evaluator-exception', err.message);
    return finish();
  }

  async function finish() {
    await services.redis?.stop().catch(() => {});
    await services.postgres?.stop().catch(() => {});
    if (!opts.keepWorkspace) rmSync(scratch, { recursive: true, force: true });
    record.findings = findings;
    record.verdict = computeVerdict(findings);
    record.verdictReasons = findings.filter((f) => f.severity === record.verdict);
    record.evidence = writeEvidence(evidenceRoot, record, raw, secrets);
    return record;
  }
}

/** Raw logs and the record, redacted before they touch disk, with hashes. */
function writeEvidence(root, record, raw, secrets) {
  if (!root) return null;
  const id = `${record.objective.id ?? 'unknown'}/v${record.objective.version ?? 0}/${(record.candidate ?? 'none').slice(0, 12)}-${record.evaluatedAt.replace(/[:.]/g, '-')}`;
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const files = raw.map(({ name, content }) => {
    const text = redact(content, secrets);
    writeFileSync(join(dir, name), text);
    return { name, sha256: sha256(Buffer.from(text)), bytes: Buffer.byteLength(text) };
  });
  record.evidenceFiles = files;
  const json = JSON.stringify(redactDeep(record, secrets), null, 2);
  writeFileSync(join(dir, 'record.json'), json);
  return { dir, recordSha256: sha256(Buffer.from(json)) };
}

#!/usr/bin/env node
// Servvia bounded correction loop (Phase 2). Run from an export of the anchor
// commit (README.md), like bin/evaluate.mjs.
//
//   loop.mjs inputs   --repo <path> --spec <spec path> --epic-context <context path>
//       prints the `inputs` block a draft objective records (the spec's
//       intent-contract hash, the epic context's hash).
//   loop.mjs validate --objective-file <draft.json> --repo <path>
//       checks a DRAFT objective; prints OBJECTIVE READY FOR FREEZE and its
//       SHA-256 for the orchestrator. It never freezes or approves anything.
//   loop.mjs gate     --repo <path> --anchor-commit <sha> --objective <path> --objective-sha256 <hex> [--failure-packet <path>]
//       GATE OPEN only for a frozen, approved objective whose loop is open,
//       on a clean checkout of the run's one permitted starting commit: the
//       anchor for the initial candidate; for a correction, exactly the
//       failed candidate the ledger records, with the packet issued for it.
//   loop.mjs advance  --repo ... --anchor-commit ... --objective ... --objective-sha256 ... --candidate <sha> [--worktree <path>]
//       [--node-modules ... --go-root ... --go-modcache ... --dotnet-root ... --nuget-packages ... --pg-bin ... --redis-bin ...]
//       evaluates the next candidate and prints the decision; with
//       --worktree, the run's checkout must stay at the candidate, clean,
//       for the whole evaluation.
//   loop.mjs status   --objective-id <id>
//   loop.mjs cleanup  --older-than-days <n>  |  --purge-objective <id>
//
// Exit codes: advance 0 CANDIDATE_READY_FOR_ACCEPTANCE, 10 CORRECT, 20 STOP;
// gate/validate 0 open/ready, 20 closed/invalid.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { advance, gate, readLedger, verifyChain } from '../lib/controller.mjs';
import { authenticateEvaluator } from '../lib/evaluate.mjs';
import { OBJECTIVE_SCHEMA, checkBaseline, checkInputs, intentContractSha256, loadFrozenObjective, sha256, validateObjective } from '../lib/objective.mjs';
import { checkoutState, resolveCommit, showFile } from '../lib/git.mjs';
import { pruneEvidence, purgeObjective } from '../lib/cleanup.mjs';

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];
const stateRoot = resolve(args['state-dir'] ?? join(homedir(), '.servvia', 'evaluator-state'));
const evidenceRoot = resolve(args['evidence-dir'] ?? join(homedir(), '.servvia', 'evaluator-evidence'));
const out = (value, code) => { console.log(JSON.stringify(value, null, 2)); process.exit(code); };
const anchorOf = () => ({ commit: args['anchor-commit'], objectivePath: args.objective, objectiveSha256: args['objective-sha256'] });

if (command === 'inputs') {
  const repo = resolve(args.repo ?? '.');
  const read = (path) => (path && existsSync(join(repo, path)) ? readFileSync(join(repo, path)) : null);
  const spec = read(args.spec);
  const context = read(args['epic-context']);
  const intent = spec && intentContractSha256(spec.toString('utf8'));
  const errors = [!spec && `no story spec at ${args.spec}`, spec && !intent && `${args.spec} has no <intent-contract> block`, !context && `no epic context at ${args['epic-context']}`].filter(Boolean);
  out(errors.length ? { errors } : { inputs: { storySpec: { path: args.spec, intentContractSha256: intent }, epicContext: { path: args['epic-context'], sha256: sha256(context) } } }, errors.length ? 20 : 0);
}

if (command === 'validate') {
  const bytes = readFileSync(args['objective-file']);
  let objective;
  try { objective = JSON.parse(bytes.toString('utf8')); } catch (e) { out({ ready: false, errors: [e.message] }, 20); }
  const errors = validateObjective(objective);
  if (!errors.length && objective.schema !== OBJECTIVE_SCHEMA) errors.push(`a new draft uses ${OBJECTIVE_SCHEMA}`);
  if (!args.repo) errors.push('--repo is required: a draft is checked against the repository it was planned in');
  if (args.repo && !errors.length) {
    const repo = resolve(args.repo);
    // A draft is planned on the current commit, from the committed epic context and the story spec on disk.
    const head = resolveCommit(repo, 'HEAD');
    if (objective.baseline !== head) errors.push(`baseline ${objective.baseline} is not the repository's HEAD ${head}`);
    const context = objective.inputs.epicContext.path;
    const committed = showFile(repo, head, context);
    if (!committed) errors.push(`epic context ${context} is not committed: it is a canonical input, committed before story preparation`);
    else if (!existsSync(join(repo, context)) || !committed.equals(readFileSync(join(repo, context)))) errors.push(`epic context ${context} differs from its committed version`);
    errors.push(...checkInputs(objective, (path) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path)) : null)));
  }
  out(errors.length
    ? { ready: false, errors }
    : { ready: true, status: 'OBJECTIVE READY FOR FREEZE', state: 'DRAFT: no authority until the orchestrator freezes it by this SHA-256',
        objectiveId: objective.objectiveId, version: objective.version, sha256: sha256(bytes), baseline: objective.baseline,
        freeze: `orchestrator only: on ${objective.baseline}, commit this file unchanged as ${'_bmad-output/implementation-artifacts/objectives/'}${objective.objectiveId}/v${objective.version}.objective.json together with ${objective.inputs.storySpec.path}; that commit is the anchor` }, errors.length ? 20 : 0);
}

if (command === 'gate') {
  const repo = resolve(args.repo);
  const commit = resolveCommit(repo, args['anchor-commit']);
  if (!commit) out({ gate: 'CLOSED', reason: 'unknown anchor commit' }, 20);
  const notAuthentic = authenticateEvaluator(repo, commit);
  if (notAuthentic) out({ gate: 'CLOSED', reason: `evaluator not authentic: ${notAuthentic}` }, 20);
  const loaded = loadFrozenObjective(repo, { ...anchorOf(), commit });
  if (!loaded.objective) out({ gate: 'CLOSED', reason: loaded.error ?? loaded.invalid.join('; ') }, 20);
  const wrong = checkBaseline(repo, commit, loaded.objective);
  if (wrong) out({ gate: 'CLOSED', reason: wrong }, 20);
  const missing = checkInputs(loaded.objective, (path) => showFile(repo, commit, path));
  if (missing.length) out({ gate: 'CLOSED', reason: `the anchor does not hold the approved inputs: ${missing.join('; ')}` }, 20);
  const policy = JSON.parse(showFile(repo, commit, 'tooling/evaluator/policy.json').toString('utf8'));
  const result = gate({
    repo, anchorCommit: commit, objectivePath: args.objective, loaded, stateRoot, maxIterations: 1 + (policy.loop?.maxCorrections ?? 2),
    checkout: checkoutState(repo), failurePacket: args['failure-packet'],
  });
  out(result, result.gate === 'OPEN' ? 0 : 20);
}

if (command === 'advance') {
  const result = await advance({
    repo: resolve(args.repo), anchor: anchorOf(), candidate: args.candidate, stateRoot, evidenceRoot,
    worktree: args.worktree && resolve(args.worktree),
    tools: {
      nodeModules: args['node-modules'] && resolve(args['node-modules']),
      goRoot: args['go-root'] && resolve(args['go-root']),
      goModCache: args['go-modcache'] && resolve(args['go-modcache']),
      dotnetRoot: args['dotnet-root'] && resolve(args['dotnet-root']),
      nugetPackages: args['nuget-packages'] && resolve(args['nuget-packages']),
      pgBin: args['pg-bin'] ?? '/opt/homebrew/opt/postgresql@18/bin',
      redisBin: args['redis-bin'] ?? '/opt/homebrew/bin',
    },
  });
  const { record, ...summary } = result;
  out({ ...summary, evidence: record?.evidence ?? null, reasons: record?.verdictReasons ?? [] },
    result.decision === 'CANDIDATE_READY_FOR_ACCEPTANCE' ? 0 : result.decision === 'CORRECT' ? 10 : 20);
}

if (command === 'status') {
  const ledger = readLedger(stateRoot, args['objective-id']);
  out({ ...ledger, chainIntact: verifyChain(ledger) }, 0);
}

if (command === 'cleanup') {
  if (args['purge-objective']) {
    purgeObjective({ stateRoot, evidenceRoot, objectiveId: args['purge-objective'] });
    out({ purged: args['purge-objective'] }, 0);
  }
  out({ removed: pruneEvidence(evidenceRoot, { olderThanDays: Number(args['older-than-days']) }) }, 0);
}

out({ error: `unknown command ${command ?? ''}` }, 20);

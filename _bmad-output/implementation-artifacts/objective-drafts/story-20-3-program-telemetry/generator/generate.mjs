#!/usr/bin/env node
// Story 20.3 freeze-candidate generator (FREEZE CANDIDATE — NOT YET FROZEN; no authority).
//
// Builds the Story 20.3 draft objective deterministically from:
//   - generator/inputs.json (explicit baseline and the few non-derivable inputs);
//   - generator/history.json (the seven governed stories' ledger facts, read once from their chain-verified
//     ledgers and SHA-256-checked records; provenance inside);
//   - facts read from the baseline commit (git show / ls-tree / log at <baseline>), never from a working tree:
//     committer times and test files of the historical commits, counted with the evaluator's own countTests
//     over the anchor's policy testFiles; the repository layout; the epic context;
//   - the story spec in the working tree (its <intent-contract> is hashed into inputs);
//   - the check templates in generator/checks/.
// Writes the draft objective and the packet manifest; with --check it writes nothing and fails unless both
// regenerate byte-identically. Paths are repository-relative; it fails closed on any violated precondition.
//
// Usage: node generate.mjs --repo <repository root> [--check]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fail = (msg) => { console.error(`GENERATOR REFUSED: ${msg}`); process.exit(2); };
const args = process.argv.slice(2);
const repoArg = args[args.indexOf('--repo') + 1];
if (!args.includes('--repo') || !repoArg) fail('--repo <repository root> is required');
const CHECK = args.includes('--check');
const REPO = resolve(repoArg);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKET = dirname(HERE);
const PACKET_REL = relative(REPO, PACKET).split('\\').join('/');
if (PACKET_REL.startsWith('..')) fail('the generator must live inside the repository given by --repo');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
const gitBuf = (...a) => execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 1 << 30 });
const readJson = (p, what) => { if (!existsSync(p)) fail(`${what} missing: ${relative(REPO, p)}`); return JSON.parse(readFileSync(p, 'utf8')); };

// ---- explicit inputs ---------------------------------------------------------------------------------
const inputs = readJson(join(HERE, 'inputs.json'), 'generator inputs');
for (const k of ['baseline', 'objectiveId', 'storyId', 'version', 'title', 'specPath', 'epicContextPath', 'logPath', 'telemetryDir', 'requiredTests', 'allowedBuiltins', 'floors', 'toolchain']) if (inputs[k] === undefined) fail(`inputs.${k} is missing`);
const history = readJson(join(HERE, 'history.json'), 'history');
const B = inputs.baseline;
if (!/^[0-9a-f]{40}$/.test(B)) fail('inputs.baseline must be a full commit id');
try { if (git('cat-file', '-t', B).trim() !== 'commit') fail(`baseline ${B} is not a commit`); } catch { fail(`baseline ${B} is not in the repository`); }
const atBase = (p) => { try { return gitBuf('show', `${B}:${p}`); } catch { fail(`${p} does not exist at the baseline ${B}`); } };
const existsAtBase = (p) => { try { execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${B}:${p}`], { stdio: 'ignore' }); return true; } catch { return false; } };
try { git('diff', '--quiet', B, '--', 'tooling/evaluator'); } catch { fail('tooling/evaluator in the working tree differs from the baseline'); }
const lib = (m) => import(pathToFileURL(join(REPO, 'tooling/evaluator/lib', m)).href);
const { intentContractSha256, validateObjective } = await lib('objective.mjs');
const { countTests } = await lib('integrity.mjs');
const { matches } = await lib('glob.mjs');

// ---- inputs hashed into the objective ---------------------------------------------------------------
const specFile = join(REPO, inputs.specPath);
if (!existsSync(specFile)) fail(`story spec missing: ${inputs.specPath}`);
const specText = readFileSync(specFile, 'utf8');
if (!/<intent-contract>[\s\S]*<\/intent-contract>/.test(specText)) fail('the story spec has no <intent-contract> block');
if (!specText.includes(B)) fail('the story spec does not name the baseline');
const objectiveInputs = {
  storySpec: { path: inputs.specPath, intentContractSha256: intentContractSha256(specText) },
  epicContext: { path: inputs.epicContextPath, sha256: sha256(atBase(inputs.epicContextPath)) },
};

// ---- premise: nothing of the story exists at the baseline ---------------------------------------------
if (git('ls-tree', '-r', '--name-only', B, '--', inputs.telemetryDir).trim()) fail(`${inputs.telemetryDir} already exists at the baseline`);
if (existsAtBase(inputs.logPath)) fail(`${inputs.logPath} already exists at the baseline`);
for (const t of inputs.requiredTests) if (existsAtBase(t.file)) fail(`${t.file} already exists at the baseline`);

// ---- expected backfill, from immutable sources -----------------------------------------------------------
const isAncestor = (a, b) => { try { execFileSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; } };
const full = (c) => git('rev-parse', `${c}^{commit}`).trim();
const ctime = (c) => new Date(git('log', '-1', '--format=%cI', c).trim()).toISOString();
const show = (c, p) => { try { return execFileSync('git', ['-C', REPO, 'show', `${c}:${p}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }); } catch { return null; } };
const growth = (a, c) => {
  const globs = JSON.parse(show(a, 'tooling/evaluator/policy.json')).testFiles;
  return git('diff', '--name-only', a, c).split('\n').filter(Boolean).filter((p) => matches(p, globs))
    .reduce((n, p) => n + countTests(p, show(c, p)) - countTests(p, show(a, p)), 0);
};
const UNKNOWN = { value: null, provenance: 'unknown' };
const STORY_ORDER = ['1.3', '12.3a', '12.5', '1.7', '1.8', '1.9', '15.1'];
if (JSON.stringify(history.stories.map((h) => h.story)) !== JSON.stringify(STORY_ORDER)) fail('history.json must hold the seven governed stories in the backfill order');
const expected = history.stories.map((h) => {
  const events = [];
  for (const c of [h.integration, ...h.versions.flatMap((v) => [v.anchor, v.baseline, ...v.iterations.map((i) => i.candidate)])]) {
    if (full(c) !== c) fail(`${h.story}: ${c} is not a full commit id`);
    if (!isAncestor(c, B)) fail(`${h.story}: ${c} is not in the baseline's history`);
  }
  for (const v of h.versions) {
    events.push({ type: 'frozen', at: ctime(v.anchor), objectiveId: h.objectiveId, refs: { anchor: v.anchor, baseline: v.baseline } });
    let parent = v.anchor;
    for (const it of v.iterations) {
      events.push({ type: 'candidate', at: ctime(it.candidate), objectiveId: h.objectiveId, refs: { candidate: it.candidate, parent } });
      events.push({ type: 'evaluated', at: it.at, objectiveId: h.objectiveId, value: it.n, refs: { candidate: it.candidate, decision: it.decision, record: it.recordSha256, startedAt: it.startedAt, verdict: it.verdict } });
      parent = it.candidate;
    }
    const last = v.iterations.at(-1).candidate;
    events.push({ type: 'test-growth', at: ctime(last), objectiveId: h.objectiveId, value: growth(v.anchor, last), refs: { anchor: v.anchor, candidate: last } });
  }
  const lastCandidate = h.versions.at(-1).iterations.at(-1).candidate;
  if (!isAncestor(lastCandidate, h.integration)) fail(`${h.story}: the integration commit does not contain the candidate`);
  events.push({ type: 'integrated', at: ctime(h.integration), objectiveId: h.objectiveId, refs: { candidate: lastCandidate, commit: h.integration } });
  const its = h.versions.flatMap((v) => v.iterations);
  const frozenAt = new Date(ctime(h.versions[0].anchor));
  const metrics = {
    preparationElapsedMs: UNKNOWN,
    implementationElapsedMs: { value: new Date(ctime(h.versions[0].iterations[0].candidate)) - frozenAt, provenance: 'derived' },
    implementationEffectiveMs: UNKNOWN,
    evaluationElapsedMs: { value: its.reduce((n, i) => n + (new Date(i.at) - new Date(i.startedAt)), 0), provenance: 'derived' },
    evaluatorIterations: { value: its.length, provenance: 'derived' },
    correctionIterations: { value: its.filter((i) => i.n > 1).length, provenance: 'derived' },
    firstPassVerdict: { value: h.versions[0].iterations[0].verdict, provenance: 'derived' },
    reviewRounds: UNKNOWN,
    blockedMs: UNKNOWN,
    recordedEffortHours: UNKNOWN,
    testDeclarationsAdded: { value: events.filter((e) => e.type === 'test-growth').reduce((n, e) => n + e.value, 0), provenance: 'derived' },
    defectsEscaped: UNKNOWN,
    defectsReopened: UNKNOWN,
    cycleElapsedMs: { value: new Date(ctime(h.integration)) - frozenAt, provenance: 'derived' },
  };
  return { story: h.story, objectiveId: h.objectiveId, events, metrics };
});

// ---- check scripts -------------------------------------------------------------------------------
const fill = (file, values) => {
  let t = readFileSync(join(HERE, 'checks', file), 'utf8');
  for (const [k, v] of Object.entries(values)) { const token = `__${k}__`; if (!t.includes(token)) fail(`${file} has no placeholder ${token}`); t = t.split(token).join(JSON.stringify(v)); }
  const left = t.match(/__[A-Z0-9_]+__/); if (left) fail(`${file}: unfilled placeholder ${left[0]}`);
  return t;
};
const scripts = {
  contract: fill('telemetry-contract.js', {}),
  boundaries: fill('telemetry-boundaries.js', { ALLOWED_BUILTINS: inputs.allowedBuiltins }),
  backfill: fill('telemetry-backfill.js', { LOG: inputs.logPath, EXPECTED: expected }),
};
const checks = [
  // One node --test run of the evaluator's own tests and the telemetry tests: the evaluator suite (floor = its
  // baseline count) proves the evaluator is unchanged and keeps the run non-empty on the baseline, where the new
  // telemetry suite does not exist yet; the six named required tests prove the telemetry suite exists and passes.
  { id: 'node-tests', category: 'unit', runner: 'node-test', cwd: '.', args: ['tooling/evaluator/test/*.test.mjs', `${inputs.telemetryDir}/test/*.test.mjs`], mandatory: true, minTests: inputs.floors.evaluatorSelfTests, timeoutSeconds: 900, configFiles: ['tooling/evaluator/policy.json'] },
  { id: 'telemetry-contract', category: 'integration', runner: 'command', cwd: '.', args: ['node', '-e', scripts.contract], mandatory: true, timeoutSeconds: 900 },
  { id: 'telemetry-boundaries', category: 'architecture', runner: 'command', cwd: '.', args: ['node', '-e', scripts.boundaries], mandatory: true },
  { id: 'telemetry-backfill', category: 'integration', runner: 'command', cwd: '.', args: ['node', '-e', scripts.backfill], mandatory: true, timeoutSeconds: 600 },
];
const requiredTests = inputs.requiredTests.map((t) => ({ id: t.id, check: 'node-tests', name: t.name, files: [t.file], expectBaselineFailure: true }));

// ---- surfaces ------------------------------------------------------------------------------------
const tree = git('ls-tree', '-r', '--name-only', B).trim().split('\n');
const allowed = [`${inputs.telemetryDir}/**`, `${dirname(inputs.logPath)}/**`];
const forbidden = new Set();
const dirOrFile = (prefix) => (tree.some((p) => p.startsWith(`${prefix}/`)) ? `${prefix}/**` : prefix);
const children = (prefix) => [...new Set(tree.filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1).split('/')[0]))];
for (const t of [...new Set(tree.map((p) => p.split('/')[0]))]) if (!['tooling', '_bmad-output'].includes(t)) forbidden.add(dirOrFile(t));
for (const e of children('tooling')) forbidden.add(dirOrFile(`tooling/${e}`));
for (const p of tree.filter((p) => p.startsWith('_bmad-output/') && !p.startsWith('_bmad-output/implementation-artifacts/objectives/'))) forbidden.add(p);
forbidden.add('_bmad-output/implementation-artifacts/objective-drafts/**');
for (const p of ['.env', '.env.*', '**/.env', '**/.env.*', '**/node_modules/**', '**/package.json', '**/package-lock.json']) forbidden.add(p);
for (const p of allowed) forbidden.delete(p);
forbidden.delete(inputs.specPath);
if (forbidden.has(inputs.telemetryDir) || [...forbidden].some((f) => f === `${inputs.telemetryDir}/**`)) fail('the telemetry directory is forbidden');

// ---- the objective -------------------------------------------------------------------------------
const objective = {
  schema: 'servvia.objective/v2',
  objectiveId: inputs.objectiveId,
  storyId: inputs.storyId,
  version: inputs.version,
  title: inputs.title,
  baseline: B,
  inputs: objectiveInputs,
  requirementRefs: [
    'PRD/product-requirements.md section 26 (DOD-26): the Definition of Done derives from the Enterprise Quality Bar; a story is not done solely because code exists',
    'PRD/product-requirements.md section 24 (REL-24): release readiness rests on explicit evidence, not informal confidence',
    'PRD/product-requirements.md section 21 (TEST-21): deterministic tests on disposable environments',
    `${inputs.epicContextPath}: Goal and Requirements (telemetry is engineering-program measurement, not surveillance; no fabricated data; append-only evidence; evaluator independence)`,
    '_bmad-output/planning-artifacts/epics.md Epic 20, Story 20.3 (Program telemetry and retrospective feedback), as refined 2026-10-06 at objective preparation',
    '_bmad-output/planning-artifacts/release-readiness-program.md revision 2 (accepted 7f21624): AIL-5; Story 20.3 precedes the next governed product story',
  ],
  architectureConstraints: [
    `Location: a new repository tool ${inputs.telemetryDir}/ (SPRD Part C section 30: development tooling lives under tooling/), Node.js built-in modules only (${inputs.allowedBuiltins.join(', ')}), plus read-only imports from tooling/evaluator/lib; no package manifest dependency, no network API, child processes run git only (telemetry-boundaries)`,
    `Event log: ${inputs.logPath}, append-only and hash-chained (servvia.telemetry-event/v1), in the repository; corrections are retract events, never edits; verify detects any edited, removed, inserted or reordered line and summary refuses such a log`,
    'Contract fixed by the spec intent contract: commands record, derive, verify, summary; event keys, types, phases, reasons and provenance (measured, derived, recorded, unknown); the fourteen summary metrics and their rules; the clock override SERVVIA_TELEMETRY_CLOCK',
    "Evaluator independence: derive only reads the evaluator's ledger (accepted only if the evaluator's own verifyChain accepts it) and records (accepted only if their SHA-256 equals the ledger's recordSha256), and git objects; it never writes them; tooling/evaluator/**, frozen objectives and epic contexts are forbidden surfaces; telemetry cannot change a verdict or any evidence",
    'No fabricated data: unmeasured values are unknown (null); derived values are re-computable from git and the ledger; recorded values are explicit statements; waiting (blocked intervals) is never effort; every correction iteration is counted',
    'Privacy: engineering-program events only; no keyboard, mouse, screen, window, process, clipboard, shell history, browser or message data; no person field; no files outside the repository and the named evaluator state; no third-party service',
    `Backfill: the committed log holds derive output for the seven governed stories (${STORY_ORDER.join(', ')}) with their integration commits; their expected events and summary metrics are fixed in telemetry-backfill from immutable sources (git objects at the baseline; ledger facts from generator/history.json)`,
    'Planning estimates (the effective-hour envelope) and assessments (April 2027: AT RISK) are not inputs, thresholds or outputs of the tool',
    `Baseline: ${B} (integration/normative-prd-baseline after the Story 20.3 planning refinement and Epic 20 context); measured there: evaluator self-tests ${inputs.floors.evaluatorSelfTests}/${inputs.floors.evaluatorSelfTests} under Node ${inputs.toolchain.node.validatedVersion}; no tooling/telemetry and no telemetry log exist`,
  ],
  acceptanceCriteria: [
    { id: 'AC-1', given: 'a sequence of record calls (clock and back-dated, phases, blocked intervals, reviews, effort, defects, retractions)', when: 'the log is verified and summarised', then: 'every metric carries its provenance (measured, derived, recorded, unknown), elapsed and effective time and waiting are separate, retracted values no longer count, and every invalid call is refused with the log unchanged (telemetry-contract)' },
    { id: 'AC-2', given: 'a log whose lines were edited, removed, inserted, reordered or given an extra key', when: 'it is verified or summarised', then: 'verify names the first bad seq and both refuse' },
    { id: 'AC-3', given: 'an evaluator ledger with corrections and its records, in a fixture repository', when: 'derive runs, twice', then: 'frozen, candidate, evaluated (each iteration with verdict and decision), test-growth and integrated events appear exactly once, iterations and corrections are counted, the ledger, records and repository are byte-identical afterwards, and a tampered ledger, a mismatched record or a non-containing integration commit is refused' },
    { id: 'AC-4', given: 'the repository log', when: 'it is verified and summarised', then: `the seven governed stories (${STORY_ORDER.join(', ')}) show exactly their derived events and facts, and preparation, review, recorded effort, effective time, waiting and defects are unknown (telemetry-backfill)` },
    { id: 'AC-5', given: 'the candidate', when: 'node-tests (the evaluator and telemetry suites) and the boundary check run', then: `RT-1 to RT-${inputs.requiredTests.length} pass (and fail or do not run on the baseline), the tool uses built-ins only, git-only child processes and no network or surveillance source, and node-tests passes with at least the evaluator's ${inputs.floors.evaluatorSelfTests} baseline tests` },
    { id: 'AC-6', given: 'the candidate', when: 'it is compared with the baseline', then: `only ${inputs.telemetryDir}/**, ${dirname(inputs.logPath)}/** and the story spec change; no evaluator, objective, epic context, PRD, product, CI or manifest change; no skip, focus or suppression` },
  ],
  environment: { services: [] },
  setup: [],
  checks,
  requiredTests,
  allowedSkips: [],
  surfaces: { allowed, forbidden: [...forbidden].sort() },
  expectationChanges: [],
  allowedSuppressions: [],
  completionCriteria: [
    'Every mandatory check passes on the candidate with at least its minimum test count',
    'telemetry-contract, telemetry-boundaries and telemetry-backfill pass; node-tests runs the evaluator suite unchanged (at least its baseline count) and the telemetry suite',
    `RT-1 to RT-${inputs.requiredTests.length} pass on the candidate and fail or do not run on the baseline`,
    'The candidate changes only the allowed surfaces and the story spec',
    "Technical completion is the evaluator decision CANDIDATE_READY_FOR_ACCEPTANCE only; acceptance, merging and pushing are the orchestrator's",
  ],
};
const invalid = validateObjective(objective);
if (invalid.length) fail(`the generated objective is invalid: ${invalid.join('; ')}`);
const objectiveBytes = Buffer.from(JSON.stringify(objective, null, 2) + '\n', 'utf8');
const draftRel = `${PACKET_REL}/v${inputs.version}.objective.json`;

// ---- manifest ------------------------------------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = {};
for (const p of walk(PACKET).sort()) { const rel = relative(REPO, p).split('\\').join('/'); if (rel.endsWith('/manifest.json') || rel === draftRel) continue; files[rel] = sha256(readFileSync(p)); }
files[inputs.specPath] = sha256(Buffer.from(specText, 'utf8'));
const manifest = {
  schema: 'servvia.freeze-candidate-manifest/v1',
  status: 'FREEZE CANDIDATE — NOT YET FROZEN',
  objectiveId: inputs.objectiveId,
  version: inputs.version,
  baseline: B,
  draftObjective: { path: draftRel, sha256: sha256(objectiveBytes) },
  inputs: objectiveInputs,
  toolchain: inputs.toolchain,
  derived: {
    backfill: expected.map((x) => ({ story: x.story, events: x.events.length, testDeclarationsAdded: x.metrics.testDeclarationsAdded.value, implementationElapsedMs: x.metrics.implementationElapsedMs.value, evaluationElapsedMs: x.metrics.evaluationElapsedMs.value })),
    checkScriptSha256: Object.fromEntries(checks.filter((c) => c.runner === 'command').map((c) => [c.id, sha256(Buffer.from(c.args[2], 'utf8'))])),
    forbiddenSurfaces: forbidden.size,
  },
  files,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const outputs = [[join(REPO, draftRel), objectiveBytes], [join(PACKET, 'manifest.json'), manifestBytes]];
if (CHECK) {
  let bad = 0;
  for (const [p, b] of outputs) { const same = existsSync(p) && readFileSync(p).equals(b); if (!same) bad += 1; console.log(`${same ? 'IDENTICAL' : 'DIFFERENT'} ${relative(REPO, p)}`); }
  if (bad) { console.error('regeneration differs from the files on disk'); process.exit(1); }
} else {
  for (const [p, b] of outputs) writeFileSync(p, b);
}
console.log(`draft ${draftRel} sha256 ${sha256(objectiveBytes)}`);
console.log(`inputs ${JSON.stringify(objectiveInputs)}`);
console.log(`allowed ${allowed.length}; forbidden ${forbidden.size}; checks ${checks.length}; required tests ${requiredTests.length}; backfill stories ${expected.length}`);

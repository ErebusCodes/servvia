#!/usr/bin/env node
// Story 1.9 freeze-candidate generator (FREEZE CANDIDATE — NOT YET FROZEN; no authority).
//
// Builds the Story 1.9 draft objective deterministically from:
//   - generator/inputs.json (explicit baseline commit and the few non-derivable inputs, with provenance);
//   - facts read from the baseline commit itself (git show <baseline>:<path>), never from a working tree:
//     the frozen Story 1.8 objective, the epic context, the dependency manifests and lockfile, the
//     connector harness, the Supertest-importing files and the repository layout;
//   - the story spec in the repository working tree (its <intent-contract> is hashed into inputs);
//   - the check templates in generator/checks/.
// Then writes the draft objective and the packet manifest. With --check it writes nothing and fails
// unless both regenerate byte-identically. Paths are repository-relative; it fails closed on any
// missing input or violated precondition.
//
// Usage (from anywhere): node generate.mjs --repo <repository root> --node-modules <dir with js-yaml> [--check]
// (--node-modules: any node_modules holding the repository-locked js-yaml, e.g. one provisioned by
// provisioning/provision.sh; it is used only to parse .github/workflows/ci.yml the way the inherited
// ci-workflow-opt-in check does.)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const fail = (msg) => { console.error(`GENERATOR REFUSED: ${msg}`); process.exit(2); };
const args = process.argv.slice(2);
const repoArg = args[args.indexOf('--repo') + 1];
if (!args.includes('--repo') || !repoArg) fail('--repo <repository root> is required');
const CHECK = args.includes('--check');
const nmArg = args.includes('--node-modules') ? args[args.indexOf('--node-modules') + 1] : null;
if (!nmArg || !existsSync(join(resolve(nmArg), 'js-yaml', 'package.json'))) fail('--node-modules <dir> holding js-yaml is required');
const yaml = createRequire(join(resolve(nmArg), 'js-yaml', 'package.json'))('js-yaml');
const REPO = resolve(repoArg);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKET = dirname(HERE);
const PACKET_REL = relative(REPO, PACKET).split('\\').join('/');
if (PACKET_REL.startsWith('..')) fail('the generator must live inside the repository given by --repo');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const shaJson = (v) => sha256(JSON.stringify(canon(v)));
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
const gitBuf = (...a) => execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 1 << 30 });
const readJson = (p, what) => { if (!existsSync(p)) fail(`${what} missing: ${relative(REPO, p)}`); return JSON.parse(readFileSync(p, 'utf8')); };

// ---- explicit inputs -------------------------------------------------------------------------------
const inputs = readJson(join(HERE, 'inputs.json'), 'generator inputs');
for (const k of ['baseline', 'objectiveId', 'storyId', 'version', 'title', 'specPath', 'epicContextPath', 'inheritedObjectivePath', 'harness', 'supertest', 'toolchain', 'floors', 'allowedSkip']) if (inputs[k] === undefined) fail(`inputs.json lacks ${k}`);
const TC = inputs.toolchain;
if (TC.node?.major !== 22 || !/^11\.\d+\.\d+$/.test(TC.npm?.version ?? '') || !/^sha512-/.test(TC.npm?.integrity ?? '')) fail('inputs.toolchain must pin Node 22 and an exact npm 11.x.y with its sha512 integrity');
const B = inputs.baseline;
if (!/^[0-9a-f]{40}$/.test(B)) fail('inputs.baseline must be a full commit id');
try { if (git('cat-file', '-t', B).trim() !== 'commit') fail(`baseline ${B} is not a commit`); } catch { fail(`baseline ${B} is not in the repository`); }
const atBase = (p) => { try { return gitBuf('show', `${B}:${p}`); } catch { fail(`${p} does not exist at the baseline ${B}`); } };
const atBaseText = (p) => atBase(p).toString('utf8');

// The evaluator code used to hash the spec must be the baseline's own.
try { git('diff', '--quiet', B, '--', 'tooling/evaluator'); } catch { fail('tooling/evaluator in the working tree differs from the baseline'); }
const { intentContractSha256, validateObjective } = await import(pathToFileURL(join(REPO, 'tooling/evaluator/lib/objective.mjs')).href);

// ---- inputs hashed into the objective ---------------------------------------------------------------
const specFile = join(REPO, inputs.specPath);
if (!existsSync(specFile)) fail(`story spec missing: ${inputs.specPath}`);
const specText = readFileSync(specFile, 'utf8');
if (!/<intent-contract>[\s\S]*<\/intent-contract>/.test(specText)) fail('the story spec has no <intent-contract> block');
const epicContext = atBase(inputs.epicContextPath);
const objectiveInputs = {
  storySpec: { path: inputs.specPath, intentContractSha256: intentContractSha256(specText) },
  epicContext: { path: inputs.epicContextPath, sha256: sha256(epicContext) },
};

// ---- baseline-derived facts ----------------------------------------------------------------------
const o18 = JSON.parse(atBaseText(inputs.inheritedObjectivePath));
const H = inputs.harness.file;
const harnessText = atBaseText(H);
const BASE_EXPR = inputs.harness.baselineExpression; const NEW_EXPR = inputs.harness.approvedExpression;
if (!BASE_EXPR || !NEW_EXPR) fail('inputs.harness needs baselineExpression and approvedExpression');
if (harnessText.split(BASE_EXPR).length - 1 !== 1) fail(`${H} at the baseline must contain ${JSON.stringify(BASE_EXPR)} exactly once`);
if (harnessText.includes(NEW_EXPR)) fail(`${H} at the baseline already contains ${JSON.stringify(NEW_EXPR)}`);
const harnessExpected = harnessText.replace(BASE_EXPR, NEW_EXPR);

const IMPORT_RE = "from 'supertest'|require\\('supertest'\\)";
const required = git('grep', '-lE', IMPORT_RE, B, '--', 'apps/api').trim().split('\n').filter(Boolean)
  .map((l) => l.slice(B.length + 1)).map((p) => relative('apps/api', p).split('\\').join('/')).sort();
if (!required.length) fail('no Supertest-importing files found at the baseline');

const apiPkg = JSON.parse(atBaseText('apps/api/package.json'));
const rootPkg = JSON.parse(atBaseText('package.json'));
const lock = JSON.parse(atBaseText('package-lock.json'));
const RANGE = inputs.supertest.range;
if (apiPkg.devDependencies?.supertest === RANGE) fail(`the baseline already declares supertest ${RANGE}: the defect premise no longer holds`);
const ENTRIES = inputs.supertest.approvedEntries;
for (const k of ['node_modules/supertest', 'node_modules/superagent', 'node_modules/formidable']) if (!ENTRIES[k]?.integrity) fail(`approved entry ${k} missing`);
const pkgRest = JSON.parse(JSON.stringify(apiPkg)); delete pkgRest.devDependencies.supertest;
const lockRest = JSON.parse(JSON.stringify(lock)); delete lockRest.name;
for (const k of Object.keys(ENTRIES)) delete lockRest.packages[k];
for (const k of ['', 'apps/api']) { delete lockRest.packages[k].name; delete lockRest.packages[k].engines; }
delete lockRest.packages['apps/api'].devDependencies.supertest;
const BASE_META = {
  name: lock.name, 'packages[""].name': lock.packages['']?.name, 'packages[""].engines': lock.packages['']?.engines,
  'packages["apps/api"].name': lock.packages['apps/api']?.name, 'packages["apps/api"].engines': lock.packages['apps/api']?.engines,
};

// ---- check scripts -------------------------------------------------------------------------------
const fill = (file, values) => {
  let t = readFileSync(join(HERE, 'checks', file), 'utf8');
  for (const [k, v] of Object.entries(values)) { const token = `__${k}__`; if (!t.includes(token)) fail(`${file} has no placeholder ${token}`); t = t.split(token).join(JSON.stringify(v)); }
  const left = t.match(/__[A-Z0-9_]+__/); if (left) fail(`${file}: unfilled placeholder ${left[0]}`);
  return t;
};
const scripts = {
  endpoint: fill('endpoint-identity.js', { REQUIRED: required, FLOORS: { unit: inputs.floors.unit, integration: inputs.floors.integration } }),
  listen: fill('explicit-loopback.js', {}),
  harness: fill('harness-bounded.js', { FILE: H, BASE_EXPR, NEW_EXPR, BASE_SHA256: sha256(Buffer.from(harnessText, 'utf8')), EXPECTED_SHA256: sha256(Buffer.from(harnessExpected, 'utf8')) }),
  deps: fill('dependency-delta.js', { RANGE, PKG_REST: shaJson(pkgRest), LOCK_REST: shaJson(lockRest), ENTRIES, BASE_META }),
  resolve: fill('runtime-resolution.js', {}),
};

// ---- checks: Story 1.8's, inherited from the baseline's frozen objective -------------------------
const inherit = (id) => { const c = o18.checks.find((x) => x.id === id); if (!c) fail(`Story 1.8 objective has no check ${id}`); return structuredClone(c); };
// ci-workflow-opt-in pins a hash of ci.yml (without the opt-in entry) computed at Story 1.8's baseline;
// ci.yml legitimately changed since (354ea1b), so the constant is re-derived at this baseline with the
// check's own algorithm, after proving the algorithm reproduces Story 1.8's constant at Story 1.8's baseline.
const ciRest = (commit) => { const w = yaml.load(gitBuf('show', `${commit}:.github/workflows/ci.yml`).toString('utf8')); delete w.jobs['api-integration'].env.NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE; return sha256(JSON.stringify(w)); };
const ciCheck = inherit('ci-workflow-opt-in');
if (ciCheck.args.length !== 4) fail('unexpected ci-workflow-opt-in argument shape');
if (ciRest(o18.baseline) !== ciCheck.args[3]) fail('cannot reproduce the Story 1.8 ci-workflow-opt-in constant at its own baseline');
ciCheck.args[3] = ciRest(B);
const apiIntegration = inherit('api-integration'); apiIntegration.minTests = inputs.floors.integration;
const apiUnit = inherit('api-unit'); apiUnit.minTests = inputs.floors.unit;
// apps/api/package.json becomes an authorized surface; its integrity moves to supertest-dependency-delta.
apiUnit.configFiles = apiUnit.configFiles.filter((f) => f !== 'apps/api/package.json');
const checks = [
  apiIntegration,
  inherit('native-round-recovery-fail-safe'),
  inherit('native-round-recovery-suite-unchanged'),
  ciCheck,
  apiUnit,
  inherit('api-lint'),
  inherit('api-typecheck'),
  { id: 'loopback-endpoint-identity', category: 'integration', runner: 'command', cwd: 'apps/api', args: ['node', '-e', scripts.endpoint], env: { NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE: 'eval_candidate' }, timeoutSeconds: 3600, mandatory: true, configFiles: ['apps/api/test/jest-integration.json', 'apps/api/test/integration-setup.ts', 'apps/api/test/integration-rate-limit-reset.ts', 'apps/api/src/test-setup.ts'] },
  { id: 'test-server-explicit-loopback', category: 'other', runner: 'command', cwd: '.', args: ['node', '-e', scripts.listen], mandatory: true },
  { id: 'connector-harness-change-bounded', category: 'other', runner: 'command', cwd: '.', args: ['node', '-e', scripts.harness], mandatory: true },
  { id: 'supertest-dependency-delta', category: 'other', runner: 'command', cwd: '.', args: ['node', '-e', scripts.deps], mandatory: true },
  { id: 'supertest-runtime-resolution', category: 'other', runner: 'command', cwd: 'apps/api', args: ['node', '-e', scripts.resolve], mandatory: true },
];

// ---- surfaces: everything except the three authorized files is forbidden, derived from the tree ---
const tree = git('ls-tree', '-r', '--name-only', B).trim().split('\n');
const top = [...new Set(tree.map((p) => p.split('/')[0]))];
const allowed = [H, 'apps/api/package.json', 'package-lock.json'];
const forbidden = new Set(o18.surfaces.forbidden.filter((p) => ![H, '**/package.json', '**/package-lock.json'].includes(p)));
forbidden.add('apps/api/test/native-round-recovery.integration-spec.ts');
for (const p of tree.filter((p) => p.startsWith('apps/api/test/') && p !== H)) forbidden.add(p);
for (const e of [...new Set(tree.filter((p) => p.startsWith('apps/api/')).map((p) => p.split('/')[2]))]) if (!['package.json', 'test', 'src', 'prisma'].includes(e)) forbidden.add(tree.some((p) => p.startsWith(`apps/api/${e}/`)) ? `apps/api/${e}/**` : `apps/api/${e}`);
for (const d of [...new Set(tree.filter((p) => p.startsWith('apps/')).map((p) => p.split('/')[1]))]) if (d !== 'api') forbidden.add(`apps/${d}/**`);
for (const p of tree.filter((p) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|\.npmrc)$/.test(p))) if (!allowed.includes(p)) forbidden.add(p);
for (const t of top) if (!['apps', '_bmad-output', 'package-lock.json'].includes(t)) forbidden.add(tree.some((p) => p.startsWith(`${t}/`)) ? `${t}/**` : t);
for (const p of tree.filter((p) => p.startsWith('_bmad-output/') && !p.startsWith('_bmad-output/implementation-artifacts/objectives/'))) forbidden.add(p);
forbidden.add('_bmad-output/implementation-artifacts/objective-drafts/**');
// Environment files the application could load at test time (no candidate may add or change one).
for (const p of ['.env', '.env.*', '**/.env', '**/.env.*']) forbidden.add(p);
for (const p of allowed) forbidden.delete(p);
forbidden.delete(inputs.specPath);

// ---- the objective -------------------------------------------------------------------------------
const fl = inputs.floors;
const objective = {
  schema: 'servvia.objective/v2',
  objectiveId: inputs.objectiveId,
  storyId: inputs.storyId,
  version: inputs.version,
  title: inputs.title,
  baseline: B,
  inputs: objectiveInputs,
  requirementRefs: [
    'PRD/product-requirements.md section 21 (test quality): tests are deterministic where practical; database and integration tests run on disposable environments',
    'PRD/product-requirements.md section 24 (release and production readiness): passing tests with explicit evidence; implemented is not production ready',
    'PRD/product-requirements.md section 16 (security standard): least privilege and fail closed; a test request must reach only the server it targets',
    "_bmad-output/implementation-artifacts/epic-1-context.md: Goal (what passes CI is what actually runs; test verdicts cannot be corrupted by the test harness itself) and Requirements 'Green honestly' and 'Real, disposable dependencies; deterministic tests'",
    '_bmad-output/planning-artifacts/epics.md Epic 1, Story 1.9 (Test-harness loopback binding) and its readiness record of 2026-10-05',
    'Story 1.9 preparation evidence (objective-drafts/story-1-9-test-harness-loopback-binding/evidence): mechanism confirmed on macOS under Node 22 and Node 24; the 2026-10-05 Batch 2 flake (ECONNRESET and socket hang up on 127.0.0.1 requests, 2 of 10 targeted runs on 38bea30) is prior accepted evidence of the symptom',
  ],
  architectureConstraints: [
    "Endpoint-identity invariant: every HTTP request a test sends to an in-process Servvia test server targets exactly the explicit local endpoint that server is bound to, 127.0.0.1:<port>. No test server binds a wildcard (::, 0.0.0.0) or an unspecified host",
    "Approach carried from the 2026-10-05 orchestrator selection (Option A; to be confirmed at freeze): apps/api devDependencies.supertest -> " + RANGE + " (supertest 7 starts an unbound server on 127.0.0.1 and requests 127.0.0.1) plus the single explicit bind: the harness\'s one host-less server start " + BASE_EXPR + " in " + H + " becomes " + NEW_EXPR + '. Rejected: a shared bootstrap or http/net monkeypatch (hides future host-less binds behind global behaviour) and per-suite edits of every Supertest file (wide and repetitive)',
    'Test-only scope: the implementation surface is exactly apps/api/package.json, package-lock.json and the one server-start expression of ' + H + '. Production code (apps/api/src/**, including main.ts and its listen host), Prisma, schema, migrations, auth, contracts, Go Core, other applications, CI (.github/**) and the evaluator (tooling/**) do not change',
    'Dependency delta (pinned by supertest-dependency-delta): package-lock.json entries node_modules/supertest ' + ENTRIES['node_modules/supertest'].version + ', node_modules/superagent ' + ENTRIES['node_modules/superagent'].version + ' and node_modules/formidable ' + ENTRIES['node_modules/formidable'].version + ' with their registry integrity, all dev-only; the apps/api supertest range; npm synchronising the lockfile name/engines metadata with the unchanged manifests. Every other field of apps/api/package.json and package-lock.json is hash-pinned to the baseline; no package is added or removed',
    'Toolchain (Tier-2 tooling decision, 2026-10-05): Node ' + TC.node.major + ' is the runtime and evaluator engine. The lockfile change is authored, and evaluator dependencies are provisioned, with exactly npm ' + TC.npm.version + ' (' + TC.npm.tarball + ', ' + TC.npm.integrity + ') running under Node ' + TC.node.major + '. Node 22\'s bundled npm 10 is not accepted (it nests the supertest, superagent and formidable entries under apps/api/node_modules and drops libc from unrelated platform entries, which supertest-dependency-delta rejects); no floating npm version. This is a Story 1.9 constraint, not a repository package-manager migration',
    'Evaluator dependency provisioning: the evaluator links one operator-supplied node_modules root and does not install the candidate lockfile. The evaluation is provisioned with npm ' + TC.npm.version + ' under Node ' + TC.node.major + ' (npm ci --ignore-scripts from the candidate lockfile in a disposable export), only after supertest-dependency-delta passes on that lockfile; provisioning fails closed on any other Node major or npm version; supertest-runtime-resolution fails if the supertest, superagent or formidable the tests load differ from the candidate lockfile (provisioning/README.md)',
    'Determinism: loopback-endpoint-identity observes every TCP listen and every http/https request of the full unit and integration suites (an observation-only probe added by the check through the protected Jest configurations) and requires every in-process test server to bind 127.0.0.1 and every request to it to target the same endpoint, with matched evidence in each of the ' + required.length + ' Supertest-importing files. It is not a flake-rate measurement',
    'Stories 1.7 and 1.8 are protected: apps/api/test/native-round-recovery.integration-spec.ts, their specs, frozen objectives and evidence are forbidden surfaces; the checks native-round-recovery-fail-safe and native-round-recovery-suite-unchanged are inherited unchanged from the frozen Story 1.8 objective at the baseline; ci-workflow-opt-in is inherited with its ci.yml hash re-derived at this baseline (ci.yml changed legitimately at 354ea1b; the derivation reproduces Story 1.8\'s constant at Story 1.8\'s baseline); api-integration, api-unit, api-lint and api-typecheck are inherited with floors raised to the baseline measurement (unit ' + fl.unit + ', integration ' + fl.integration + ') and api-unit no longer listing apps/api/package.json as configuration (it is held by supertest-dependency-delta)',
    'Baseline: ' + B + ' (integration/normative-prd-baseline after Story 14.2). Measured there: supertest ' + lock.packages['node_modules/supertest'].version + ' locked; ' + required.length + ' Supertest-importing files; ' + H + ' starts its server with the host-less ' + BASE_EXPR + '; unit ' + fl.unit + ' and integration ' + fl.integration + ' passed with only the ' + inputs.allowedSkip.count + ' GcsStorageProvider skips',
    'Recorded, not in scope: Story 1.10 (CI asserts the native-round-recovery suite executes) is separate and deferred; LIBPQ SERVICE FORM NOT APPLICABLE TO CURRENT PRISMA PATH',
  ],
  acceptanceCriteria: [
    { id: 'AC-1', given: 'the candidate with its approved dependencies installed', when: 'the full API unit and integration suites run under the evaluator endpoint probe', then: 'every in-process test server binds 127.0.0.1, every request to an in-process test server targets the 127.0.0.1 endpoint that server is bound to, each of the ' + required.length + ' Supertest-importing files shows matched runtime evidence, and both suites pass at their floors (unit ' + fl.unit + ', integration ' + fl.integration + ')' },
    { id: 'AC-2', given: 'the candidate API test sources', when: 'they are scanned', then: "every listen call in API test code names the explicit loopback host '127.0.0.1', so no test server can bind a wildcard or an unspecified host" },
    { id: 'AC-3', given: 'the candidate manifests and lockfile', when: 'they are compared with the baseline', then: 'the only dependency change is the dev-only apps/api supertest ' + RANGE + ' upgrade with exactly the approved lockfile entries, and the supertest, superagent and formidable the tests load at run time are the versions the lockfile pins' },
    { id: 'AC-4', given: 'the connector command harness', when: 'it is compared with the baseline', then: 'it equals the baseline file except that its one host-less server start (' + BASE_EXPR + ') binds the explicit loopback endpoint its external command process targets (' + NEW_EXPR + '); no other statement, test or assertion in the file changes' },
    { id: 'AC-5', given: 'the candidate', when: 'the inherited checks run', then: 'API integration passes (at least ' + fl.integration + ', only the ' + inputs.allowedSkip.count + ' GcsStorageProvider skips), RT-01 to RT-16 pass, the Story 1.8 fail-safe passes, the recovery suite hash is unchanged, the CI opt-in wiring is unchanged, and API unit (at least ' + fl.unit + '), lint and typecheck pass' },
    { id: 'AC-6', given: 'the candidate', when: 'it is compared with the baseline', then: 'nothing outside apps/api/package.json, package-lock.json, the harness server-start expression and the story spec changes; no test is added, removed, renamed, skipped, focused or weakened; no suppression, shared test bootstrap, monkeypatch, environment switch or production behaviour change is added' },
  ],
  environment: structuredClone(o18.environment),
  setup: structuredClone(o18.setup),
  checks,
  requiredTests: structuredClone(o18.requiredTests),
  allowedSkips: [{ check: inputs.allowedSkip.check, test: inputs.allowedSkip.test, reason: 'Real Google Cloud Storage coverage: runs only with GCS_INTEGRATION_TEST_* credentials, which neither CI nor the evaluator has. Skipped identically on the baseline ' + B.slice(0, 7) + ' (' + inputs.allowedSkip.count + ' tests); not part of this story.' }],
  surfaces: { allowed, forbidden: [...forbidden].sort() },
  expectationChanges: [
    { path: H, reason: 'One expression only: the host-less server start ' + BASE_EXPR + ' becomes ' + NEW_EXPR + ', so the in-process API binds the explicit loopback endpoint its external command process targets (baseUrl http://127.0.0.1:<port>/api). connector-harness-change-bounded requires the rest of the file to equal the baseline.', retiresTests: [] },
    { path: 'apps/api/package.json', reason: 'devDependencies.supertest ' + apiPkg.devDependencies.supertest + ' -> ' + RANGE + ' only (npm may re-sort devDependencies keys); every other field is pinned by supertest-dependency-delta.', retiresTests: [] },
    { path: 'package-lock.json', reason: 'Exactly the approved dev-only entries (supertest ' + ENTRIES['node_modules/supertest'].version + ', superagent ' + ENTRIES['node_modules/superagent'].version + ', formidable ' + ENTRIES['node_modules/formidable'].version + ', with their integrity), the apps/api supertest range, and npm synchronising name/engines metadata with the unchanged package.json files; everything else is pinned by supertest-dependency-delta.', retiresTests: [] },
  ],
  allowedSuppressions: [],
  completionCriteria: [
    'Every mandatory check passes on the candidate with at least its minimum test count',
    'loopback-endpoint-identity passes: ' + required.length + '/' + required.length + ' Supertest-importing files evidenced, zero bind/request mismatches, zero non-loopback test listens, unit and integration green under the probe',
    'test-server-explicit-loopback, connector-harness-change-bounded, supertest-dependency-delta and supertest-runtime-resolution pass',
    'native-round-recovery-fail-safe, native-round-recovery-suite-unchanged, ci-workflow-opt-in, api-integration, api-unit, api-lint and api-typecheck pass; RT-01 to RT-16 pass on the candidate and the baseline (regression characterizations)',
    'The only skips are the ' + inputs.allowedSkip.count + ' GcsStorageProvider tests; the candidate changes only apps/api/package.json, package-lock.json, the server-start expression of ' + H + ' and the story spec',
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
  toolchain: { node: { major: TC.node.major }, npm: { version: TC.npm.version, tarball: TC.npm.tarball, integrity: TC.npm.integrity } },
  derived: { ciWorkflowRestSha256: ciCheck.args[3], story18CiWorkflowRestSha256: inherit('ci-workflow-opt-in').args[3], supertestImportingFiles: required.map((f) => `apps/api/${f}`), harnessBaselineSha256: sha256(Buffer.from(harnessText, 'utf8')), harnessExpectedSha256: sha256(Buffer.from(harnessExpected, 'utf8')), apiPackageRestSha256: shaJson(pkgRest), lockfileRestSha256: shaJson(lockRest), baselineLockfileMeta: BASE_META, forbiddenSurfaceCount: forbidden.size },
  files,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const outputs = [[join(REPO, draftRel), objectiveBytes], [join(PACKET, 'manifest.json'), manifestBytes]];
if (CHECK) {
  let bad = 0;
  for (const [p, b] of outputs) { const ok = existsSync(p) && readFileSync(p).equals(b); if (!ok) bad += 1; console.log(`${ok ? 'IDENTICAL' : 'DIFFERENT'} ${relative(REPO, p)}`); }
  if (bad) { console.error('regeneration differs from the files on disk'); process.exit(1); }
} else {
  for (const [p, b] of outputs) writeFileSync(p, b);
}
console.log(`draft ${draftRel} sha256 ${sha256(objectiveBytes)}`);
console.log(`inputs ${JSON.stringify(objectiveInputs)}`);
console.log(`supertest-importing files ${required.length}; forbidden surfaces ${forbidden.size}; checks ${checks.length}`);

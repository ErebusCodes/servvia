#!/usr/bin/env node
// Story 15.1 freeze-candidate generator (FREEZE CANDIDATE — NOT YET FROZEN; no authority).
//
// Builds the Story 15.1 draft objective deterministically from:
//   - generator/inputs.json (explicit baseline commit and the few non-derivable inputs, with provenance);
//   - facts read from the baseline commit itself (git show / git grep / git ls-tree at <baseline>), never
//     from a working tree: the Core AuditLog writers, the actor-shape migration, the inherited Story 12.3a
//     Core checks, the epic context, the Go version and the repository layout;
//   - the story spec in the repository working tree (its <intent-contract> is hashed into inputs);
//   - the check templates in generator/checks/ (the evaluator-owned attribution test among them).
// Then writes the draft objective and the packet manifest. With --check it writes nothing and fails
// unless both regenerate byte-identically. Paths are repository-relative; it fails closed on any
// missing input or violated precondition.
//
// Usage (from anywhere): node generate.mjs --repo <repository root> [--check]
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

// ---- explicit inputs -------------------------------------------------------------------------------
const inputs = readJson(join(HERE, 'inputs.json'), 'generator inputs');
for (const k of ['baseline', 'measuredAt', 'objectiveId', 'storyId', 'version', 'title', 'specPath', 'epicContextPath', 'inheritedObjectivePath', 'core', 'auditDir', 'migration', 'writers', 'actorFiles', 'handlers', 'requiredTests', 'blackbox', 'floors', 'toolchain']) if (inputs[k] === undefined) fail(`inputs.${k} is missing`);
const B = inputs.baseline;
if (!/^[0-9a-f]{40}$/.test(B) || !/^[0-9a-f]{40}$/.test(inputs.measuredAt)) fail('inputs.baseline and inputs.measuredAt must be full commit ids');
try { if (git('cat-file', '-t', B).trim() !== 'commit') fail(`baseline ${B} is not a commit`); } catch { fail(`baseline ${B} is not in the repository`); }
const atBase = (p) => { try { return gitBuf('show', `${B}:${p}`); } catch { fail(`${p} does not exist at the baseline ${B}`); } };
const atBaseText = (p) => atBase(p).toString('utf8');
const existsAtBase = (p) => { try { execFileSync('git', ['-C', REPO, 'cat-file', '-e', `${B}:${p}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const C = inputs.core;
const AUDIT = inputs.auditDir;

// The floors were measured at inputs.measuredAt; they hold for the baseline only if every tree the
// checks exercise is identical there.
try { git('diff', '--quiet', inputs.measuredAt, B, '--', 'services', 'apps', 'contracts', 'tooling', 'package.json', 'package-lock.json'); } catch { fail(`the baseline ${B} differs from ${inputs.measuredAt}, where the floors were measured, outside planning artifacts`); }
// The evaluator code used to hash the spec must be the baseline's own.
try { git('diff', '--quiet', B, '--', 'tooling/evaluator'); } catch { fail('tooling/evaluator in the working tree differs from the baseline'); }
const { intentContractSha256, validateObjective } = await import(pathToFileURL(join(REPO, 'tooling/evaluator/lib/objective.mjs')).href);

// ---- inputs hashed into the objective ---------------------------------------------------------------
const specFile = join(REPO, inputs.specPath);
if (!existsSync(specFile)) fail(`story spec missing: ${inputs.specPath}`);
const specText = readFileSync(specFile, 'utf8');
if (!/<intent-contract>[\s\S]*<\/intent-contract>/.test(specText)) fail('the story spec has no <intent-contract> block');
if (!specText.includes(B)) fail('the story spec does not name the baseline');
const epicContext = atBase(inputs.epicContextPath);
const objectiveInputs = {
  storySpec: { path: inputs.specPath, intentContractSha256: intentContractSha256(specText) },
  epicContext: { path: inputs.epicContextPath, sha256: sha256(epicContext) },
};

// ---- baseline-derived facts ----------------------------------------------------------------------
// The Core AuditLog writers: every production Go file under cmd/ and internal/ that inserts AuditLog rows.
const grep = (re, ...paths) => { try { return git('grep', '-lE', re, B, '--', ...paths).trim().split('\n').filter(Boolean).map((l) => l.slice(B.length + 1)); } catch { return []; } };
const writers = grep('INSERT INTO "AuditLog"', `${C}/cmd`, `${C}/internal`).filter((p) => !p.endsWith('_test.go')).sort();
const declared = [...inputs.writers.tabletReachable, ...inputs.writers.staffSessionOnly].sort();
if (JSON.stringify(writers) !== JSON.stringify(declared)) fail(`the baseline's AuditLog writers ${JSON.stringify(writers)} differ from inputs.writers ${JSON.stringify(declared)}`);
for (const w of writers) {
  const n = atBaseText(w).split('INSERT INTO "AuditLog"').length - 1;
  if (n !== 1) fail(`${w} inserts AuditLog rows ${n} times at the baseline; the writer matrix assumes one helper per file`);
}
for (const p of [...inputs.actorFiles, ...inputs.handlers]) if (!existsAtBase(p)) fail(`${p} does not exist at the baseline`);
if (grep('"AuditLog"', `${C}/cmd`, `${C}/internal`).filter((p) => !p.endsWith('_test.go') && !writers.includes(p)).length) fail('a Core production file other than the writers names the AuditLog table at the baseline');
// The premise: the audit package and the required and evaluator-owned test files do not exist yet.
if (git('ls-tree', '-r', '--name-only', B, '--', AUDIT).trim()) fail(`${AUDIT} already exists at the baseline: the defect premise no longer holds`);
for (const t of inputs.requiredTests) if (existsAtBase(t.file)) fail(`${t.file} already exists at the baseline`);
const BBX = [inputs.blackbox.routes, inputs.blackbox.model];
const BB_FILES = BBX.map((b) => `${C}/${b.file}`);
for (const f of BB_FILES) if (existsAtBase(f)) fail(`${f} exists at the baseline`);
// The schema is the one Story 15.1 relies on, unchanged (no migration in this story).
const migration = atBaseText(inputs.migration);
for (const s of ['CREATE TYPE "AuditActorType" AS ENUM (\'staff\', \'device\', \'system\')', 'CONSTRAINT "AuditLog_actor_shape_check"', 'CREATE TRIGGER "AuditLog_immutable"']) if (!migration.includes(s)) fail(`${inputs.migration} lacks ${s}`);
const latestMigration = git('ls-tree', '--name-only', `${B}:apps/api/prisma/migrations`).trim().split('\n').filter((n) => /^\d{14}_/.test(n)).sort().pop();
// Go version: the module's go directive.
const goDirective = (atBaseText(`${C}/go.mod`).match(/^go (\S+)$/m) ?? [])[1];
if (goDirective !== inputs.toolchain.go.version) fail(`go.mod declares go ${goDirective}; inputs.toolchain.go.version is ${inputs.toolchain.go.version}`);
// The evaluator-owned tests name their tests and nothing they would collide with. The routes test
// uses only surfaces that exist at the baseline (it must compile there); the model test uses the
// audit package API the spec fixes.
const goSources = BBX.map((b) => readFileSync(join(HERE, 'checks', b.template), 'utf8'));
BBX.forEach((b, i) => { for (const t of b.tests) if (!new RegExp(`^func ${t}\\(t \\*testing\\.T\\) \\{$`, 'm').test(goSources[i])) fail(`${b.template} has no func ${t}`); });
if (/core-platform\/internal\/audit"/.test(goSources[0])) fail('the evaluator-owned routes test must not import the audit package (it must run on the baseline)');
const goSource = goSources.join('\n');
const goFuncs = [...goSource.matchAll(/^func (?:\([^)]*\) )?(\w+)/gm)].map((m) => m[1]);
const goTypes = [...goSource.matchAll(/^(?:type|const|var) (\w+)/gm)].map((m) => m[1]);
for (const n of [...goFuncs, ...goTypes]) if (!/^(evalStory151|TestEvalStory151)/.test(n) && !/^(StaffActive|SessionLive|Eval|exec|staff|tablet|token|call|rows|expect|visit)$/.test(n)) fail(`the evaluator-owned test declares ${n} outside its evalStory151 namespace`);
const integrationNames = git('grep', '-hoE', '^(func|type|const|var) \\w+', B, '--', `${C}/tests/integration`).split('\n').filter(Boolean).map((l) => l.split(' ')[1]);
for (const n of [...goFuncs, ...goTypes]) if (integrationNames.includes(n) && /^(evalStory151|TestEvalStory151)/.test(n)) fail(`${n} already exists in the baseline integration package`);

// ---- check scripts -------------------------------------------------------------------------------
const fill = (file, values) => {
  let t = readFileSync(join(HERE, 'checks', file), 'utf8');
  for (const [k, v] of Object.entries(values)) { const token = `__${k}__`; if (!t.includes(token)) fail(`${file} has no placeholder ${token}`); t = t.split(token).join(JSON.stringify(v)); }
  const left = t.match(/__[A-Z0-9_]+__/); if (left) fail(`${file}: unfilled placeholder ${left[0]}`);
  return t;
};
const scripts = {
  coverage: fill('writer-coverage.js', { CORE: C, AUDIT_DIR: AUDIT, WRITERS: writers }),
  routes: fill('attribution-blackbox.js', { FILES: [[inputs.blackbox.routes.file, goSources[0]]], TESTS: inputs.blackbox.routes.tests }),
  model: fill('attribution-blackbox.js', { FILES: [[inputs.blackbox.routes.file, goSources[0]], [inputs.blackbox.model.file, goSources[1]]], TESTS: inputs.blackbox.model.tests }),
};

// ---- checks: Story 12.3a's Core checks, inherited from the baseline's frozen objective -----------
const o123 = JSON.parse(atBaseText(inputs.inheritedObjectivePath));
const inherit = (id) => { const c = o123.checks.find((x) => x.id === id); if (!c) fail(`Story 12.3a objective has no check ${id}`); return structuredClone(c); };
const coreTests = inherit('core-tests');
if (coreTests.minTests > inputs.floors.coreTests) fail('the measured floor is below the inherited one');
coreTests.minTests = inputs.floors.coreTests;
const checks = [
  inherit('core-gofmt'),
  inherit('core-vet'),
  coreTests,
  { id: 'audit-writer-single-path', category: 'architecture', runner: 'command', cwd: '.', args: ['node', '-e', scripts.coverage], mandatory: true },
  { id: 'audit-attribution-routes', category: 'integration', runner: 'command', cwd: C, args: ['node', '-e', scripts.routes], mandatory: true, timeoutSeconds: 1200, configFiles: [`${C}/go.mod`, `${C}/go.sum`] },
  { id: 'audit-actor-model', category: 'integration', runner: 'command', cwd: C, args: ['node', '-e', scripts.model], mandatory: true, timeoutSeconds: 1200, configFiles: [`${C}/go.mod`, `${C}/go.sum`] },
];
const requiredTests = inputs.requiredTests.map((t) => ({ id: t.id, check: 'core-tests', name: `servvia/${C}/${t.package} ${t.name}`, files: [t.file], expectBaselineFailure: true }));

// ---- surfaces: the audit package, the writers, the actor types and handlers they need, the new
// integration test file; everything else of Core and of the repository is forbidden, derived from the tree.
const tree = git('ls-tree', '-r', '--name-only', B).trim().split('\n');
const allowed = [`${AUDIT}/**`, ...writers, ...inputs.actorFiles, ...inputs.handlers, ...new Set(inputs.requiredTests.filter((t) => t.file.startsWith(`${C}/tests/`)).map((t) => t.file))];
const DOMAINS = [...new Set([...writers, ...inputs.actorFiles, ...inputs.handlers].map((p) => p.split('/')[3]))].sort();
const forbidden = new Set();
const dirOrFile = (prefix) => (tree.some((p) => p.startsWith(`${prefix}/`)) ? `${prefix}/**` : prefix);
const children = (prefix) => [...new Set(tree.filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1).split('/')[0]))];
for (const t of [...new Set(tree.map((p) => p.split('/')[0]))]) if (!['services', '_bmad-output'].includes(t)) forbidden.add(dirOrFile(t));
for (const s of children('services')) if (`services/${s}` !== C) forbidden.add(dirOrFile(`services/${s}`));
for (const e of children(C)) if (!['internal', 'tests'].includes(e)) forbidden.add(dirOrFile(`${C}/${e}`));
for (const d of children(`${C}/internal`)) if (!DOMAINS.includes(d)) forbidden.add(dirOrFile(`${C}/internal/${d}`));
for (const e of children(`${C}/tests`)) if (e !== 'integration') forbidden.add(dirOrFile(`${C}/tests/${e}`));
// Every existing Core test file and every existing integration-package file stays as it is.
for (const p of tree.filter((p) => p.startsWith(`${C}/`) && (p.endsWith('_test.go') || p.startsWith(`${C}/tests/integration/`)))) forbidden.add(p);
for (const f of BB_FILES) forbidden.add(f);
for (const p of tree.filter((p) => p.startsWith('_bmad-output/') && !p.startsWith('_bmad-output/implementation-artifacts/objectives/'))) forbidden.add(p);
forbidden.add('_bmad-output/implementation-artifacts/objective-drafts/**');
for (const p of ['.env', '.env.*', '**/.env', '**/.env.*']) forbidden.add(p);
for (const p of allowed) forbidden.delete(p);
forbidden.delete(inputs.specPath);
for (const t of inputs.requiredTests) if ([...forbidden].some((g) => g === t.file)) fail(`required test file ${t.file} is forbidden`);

// ---- the objective -------------------------------------------------------------------------------
const W = inputs.writers;
const short = (p) => p.replace(`${C}/internal/`, '');
const objective = {
  schema: 'servvia.objective/v2',
  objectiveId: inputs.objectiveId,
  storyId: inputs.storyId,
  version: inputs.version,
  title: inputs.title,
  baseline: B,
  inputs: objectiveInputs,
  requirementRefs: [
    'PRD/00-overview-and-conventions.md INV-3: identity classes stay distinct (staff, guest, device, service, system); each action records which class acted',
    'PRD/00-overview-and-conventions.md section 00.10.6, O-21 item 4: audit provenance identifies actor, actor class and device where applicable; device, service and system actors are first-class (resolves the mechanism of DEC-OPS-21); a system or worker action never borrows or fabricates a staff identity',
    'PRD/00-overview-and-conventions.md INV-15 and NFR-AUD: every security-sensitive, financially significant and configuration mutation emits an append-only, attributable audit record; DEC-X-6: audit history is append-only from application behaviour',
    'PRD/07-finance.md FIN-36: every staff financial mutation writes an audit record in the same transaction; adapter results are recorded in the append-only transition histories with the device identity, never as an invented staff actor',
    'PRD/product-requirements.md Part C section 30.3: internal/audit/ is a target Core package',
    `${inputs.epicContextPath}: Goal and Requirements (identity classes, audit, the existing audit store is reused, transitional credentials gain no capability)`,
    '_bmad-output/planning-artifacts/epics.md Epic 15, Story 15.1 (Core audit records device and system actors truthfully), as corrected 2026-10-06 at objective preparation (FIN-36 boundary; 15.2c does not depend on 15.1)',
  ],
  architectureConstraints: [
    `One Core audit write path: ${AUDIT} (new; Part C section 30.3) holds the actor model and the only INSERT INTO "AuditLog" in Core production Go; no other Core production file names the "AuditLog" table, and none updates, deletes or bulk-copies AuditLog rows (audit-writer-single-path)`,
    'The actor model (API fixed by the spec intent contract: audit.Device, DeviceKindTablet, DeviceOf, Actor, Staff, ByDevice, System, ErrInvalidActor, Actor.Validate, Entry, Write) expresses exactly the three shapes AuditLog_actor_shape_check enforces: a staff member (id and role required; email recorded as the verified credential carries it, never NULL, as at the baseline; optionally the device acted through: kind and id), a device (kind, optional id and role; never a staff id or email), a system process (name only). An actor is validated before the write; an invalid actor is refused with ErrInvalidActor, writes nothing and fails the mutation in its transaction',
    `Writers in scope (derived from the baseline: every Core production file inserting AuditLog rows): tablet-reachable ${W.tabletReachable.map(short).join(', ')} (routes staffOnly / financial, which admit tablet_staff and tablet_manager); staff-session-only ${W.staffSessionOnly.map(short).join(', ')} (routes admin / promotionAdmin, identity.RequireStaffSession). All eight delegate to the audit package and keep their actions, resources, resource ids, before and after values and transactions`,
    "Device context comes only from the verified principal: a tablet_staff or tablet_manager token records deviceKind 'tablet_device' (the value Nest records, apps/api/src/audit/audit-actor.ts) and its deviceId (the TabletDevice); every other principal records no device. No header, query parameter or body field changes the recorded actor, class or device",
    'No device or system actor is manufactured: no Core audit writer is device- or system-initiated at the baseline (kitchen transitions use KitchenTicketTransition; payment-adapter results use transition histories), so production paths record staff actors only; the device and system shapes exist in the model and are proven against PostgreSQL by the evaluator-owned audit-actor-model check and the required tests',
    `Payment-adapter boundary (FIN-36): payment result, refund result and reversal stay recorded in their append-only transition histories with the device id and actor kind payment_adapter (payments/pgstore/store.go, payments/pgstore/adjustments.go); Story 15.1 adds no AuditLog row for them and changes none of their paths`,
    `Schema: no migration. ${inputs.migration} (AuditActorType staff/device/system, AuditLog_actor_shape_check, AuditLog_immutable, venue FK RESTRICT) is the contract; the latest migration at the baseline is ${latestMigration}; apps/** is forbidden`,
    'Out of scope: Nest (apps/**, including Story 15.2c, which does not depend on 15.1), tokens and guards (internal/identity, internal/server; ADMIN-38), cmd/api wiring, application identity, mode and provenance (Stories 15.3, 15.2a-d), kitchen routes (15.5), contracts, CI and the evaluator',
    `Allowed surfaces: ${AUDIT}/**, the eight writers, the six domain actor types (${inputs.actorFiles.map(short).join(', ')}) and their six handlers, and the new integration test file; every existing Core test file, cmd/**, tests/testsupport/**, go.mod, go.sum, every Core package outside ${DOMAINS.join(', ')} and the rest of the repository are forbidden`,
    `Evaluator-owned evidence: audit-attribution-routes writes ${inputs.blackbox.routes.file} (under ${C}) into the candidate, runs only its tests against the evaluation database, and removes it; it uses only surfaces that exist at the baseline, so it also runs, and fails behaviourally, on the baseline. It wires server.Routes exactly as cmd/api/main.go does at the baseline (forbidden, so stable), seeds through tests/testsupport (forbidden) and SQL, and drives shift open, table session open, order, check, cash payment and refund with tablet_staff (cashier), tablet_manager (manager, a second tablet enrolled) and staff-session (manager) tokens, plus device enrollment and promotion creation with the staff session, sending forged device and actor headers and query parameters. It requires every row of each resource to name exactly the caller and its tablet (or no device), no device or system row and no forged identity, and the database still refusing malformed actor rows and updates. audit-actor-model places ${inputs.blackbox.model.file} beside it, writes every actor shape through audit.Write and reads it back, requires each invalid actor to be refused with audit.ErrInvalidActor with nothing written, and checks DeviceOf for every credential kind`,
    `Baseline: ${B} (integration/normative-prd-baseline after the Story 15.1 planning correction); its services, apps, contracts and tooling trees are those of ${inputs.measuredAt}, where the floor was measured: core-tests ${inputs.floors.coreTests} (306 top-level), 0 skipped. Toolchain: Node ${inputs.toolchain.node.major} (validated ${inputs.toolchain.node.validatedVersion}), Go ${inputs.toolchain.go.version} offline (GOFLAGS=-mod=readonly, GOPROXY=off, GOTOOLCHAIN=local), PostgreSQL ${inputs.toolchain.postgres.major}, Redis; node_modules provisioned from the unchanged lockfile with npm ${inputs.toolchain.npm.version} under Node 22 (provisioning/README.md)`,
  ],
  acceptanceCriteria: [
    { id: 'AC-1', given: 'a staff member on a PIN-elevated tablet (tablet_staff or tablet_manager token naming an active TabletDevice)', when: 'they open a shift, open a table session, place an order, create a check, take a cash payment or request a refund through Core', then: "every AuditLog row of each action has actorType staff, that staff member's id, email and role, deviceKind 'tablet_device', deviceId equal to the token's TabletDevice, and no systemActor, whatever device or actor the request headers or query otherwise claim" },
    { id: 'AC-2', given: 'a staff login session', when: 'the same actions, a device enrollment or a promotion creation run through Core', then: 'every AuditLog row names the staff member (id, email, role) and no device or system actor' },
    { id: 'AC-3', given: 'the Core audit-actor model', when: 'a staff, staff-through-device, device or system actor is written to PostgreSQL', then: 'each row has exactly the identity of its class (a staff email exactly as given, never NULL); an invalid actor (none; staff without id or role; device id without kind; device without kind; system without name) is refused with audit.ErrInvalidActor and writes nothing; a raw device row naming a staff member is refused with 23514 AuditLog_actor_shape_check, and AuditLog rows cannot be updated' },
    { id: 'AC-4', given: 'Core production Go', when: 'it is scanned', then: `the only INSERT INTO "AuditLog" is under ${AUDIT}, no other production file names the "AuditLog" table, and none of the ${writers.length} baseline writers keeps AuditLog SQL of its own` },
    { id: 'AC-5', given: 'the candidate', when: "Core's gofmt, vet and race-enabled full test suite run against PostgreSQL and Redis", then: `they pass with at least ${inputs.floors.coreTests} tests, no skips, and RT-1 to RT-${inputs.requiredTests.length} passing on the candidate and failing or not running on the baseline` },
    { id: 'AC-6', given: 'the candidate', when: 'it is compared with the baseline', then: 'nothing outside the authorized Core files and the story spec changes; no migration, Nest, contract, identity, server, cmd/api, testsupport or existing-test change; no test is removed, skipped or weakened and no suppression is added' },
  ],
  environment: structuredClone(o123.environment),
  setup: structuredClone(o123.setup),
  checks,
  requiredTests,
  allowedSkips: [],
  surfaces: { allowed, forbidden: [...forbidden].sort() },
  expectationChanges: [],
  allowedSuppressions: [],
  completionCriteria: [
    `Every mandatory check passes on the candidate; core-tests runs at least ${inputs.floors.coreTests} tests with no skips`,
    `audit-attribution-routes passes: ${inputs.blackbox.routes.tests.join(', ')}; audit-actor-model passes: ${inputs.blackbox.model.tests.join(', ')}`,
    `audit-writer-single-path passes: one AuditLog INSERT, under ${AUDIT}`,
    `RT-1 to RT-${inputs.requiredTests.length} pass on the candidate and fail or do not run on the baseline`,
    'The candidate changes only the allowed surfaces and the story spec; no forbidden surface, governance path or existing test changes',
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
  measuredAt: inputs.measuredAt,
  draftObjective: { path: draftRel, sha256: sha256(objectiveBytes) },
  inputs: objectiveInputs,
  toolchain: inputs.toolchain,
  derived: {
    auditWriters: writers,
    latestMigration,
    goDirective,
    evaluatorGoSourceSha256: Object.fromEntries(BBX.map((b, i) => [b.file, sha256(Buffer.from(goSources[i], 'utf8'))])),
    checkScriptSha256: Object.fromEntries(checks.filter((c) => c.runner === 'command' && c.args[1] === '-e').map((c) => [c.id, sha256(Buffer.from(c.args[2], 'utf8'))])),
    forbiddenSurfaces: forbidden.size,
  },
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
console.log(`audit writers ${writers.length}; allowed surfaces ${allowed.length}; forbidden surfaces ${forbidden.size}; checks ${checks.length}; required tests ${requiredTests.length}`);

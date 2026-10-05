#!/usr/bin/env node
// Story 15.1 adversarial probes (FREEZE CANDIDATE evidence; disposable; never publishes anything).
//
// Each variant is a commit, made in a DISPOSABLE control clone, on top of the disposable positive
// control (or of the simulated anchor). Every variant is judged by the anchored objective's own
// mechanisms, taken from the anchor commit:
//   integrity   - the evaluator's static integrity (forbidden surfaces, skips, suppressions, ...);
//   coverage    - the audit-writer-single-path check script;
//   routes      - the audit-attribution-routes check script (evaluator-owned Go test of every route);
//   model       - the audit-actor-model check script (evaluator-owned Go test of the audit API);
//   required    - the five required tests (go test -run on their packages).
// A variant is CAUGHT when at least one mechanism rejects it, MASKED otherwise. The control
// (the positive control itself) must be rejected by none. (core-gofmt, core-vet and the full
// core-tests run are not repeated here; they only add rejections.)
//
// node adversarial-probes.mjs --ctl <clone> --anchor <sha> --positive <ref> --evaluator <export root>
//   --node-modules <dir> --go-root <dir> --go-modcache <dir> --pg-bin <dir> --redis-bin <dir> --out <dir>
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf(`--${k}`); if (i < 0 || !a[i + 1]) throw new Error(`--${k} required`); return a[i + 1]; };
const CTL = arg('ctl'); const ANCHOR = arg('anchor'); const POS = arg('positive'); const EV = arg('evaluator'); const NM = arg('node-modules');
const GOROOT = arg('go-root'); const MODCACHE = arg('go-modcache'); const PGBIN = arg('pg-bin'); const REDISBIN = arg('redis-bin'); const OUT = arg('out');
const OBJ = '_bmad-output/implementation-artifacts/objectives/story-15-1-core-audit-actor-attribution/v1.objective.json';
const C = 'services/core-platform';
const git = (...x) => execFileSync('git', ['-C', CTL, ...x], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
mkdirSync(OUT, { recursive: true });
const { staticIntegrity } = await import(pathToFileURL(join(EV, 'tooling/evaluator/lib/integrity.mjs')).href);
const { startPostgres, startRedis } = await import(pathToFileURL(join(EV, 'tooling/evaluator/lib/services.mjs')).href);
const objective = JSON.parse(git('show', `${ANCHOR}:${OBJ}`));
const policy = JSON.parse(git('show', `${ANCHOR}:tooling/evaluator/policy.json`));
const script = (id) => objective.checks.find((c) => c.id === id).args[2];
const RT = objective.requiredTests.map((t) => t.name.split(' ')[1]);

// ---- services and environment, as the evaluator builds them ---------------------------------------
const pg = await startPostgres({ bin: PGBIN, dir: join(OUT, 'pg'), timezone: 'UTC' });
const redis = await startRedis({ bin: REDISBIN });
pg.createDatabase('eval_adversarial');
const base = JSON.parse(git('show', `${ANCHOR}:tooling/evaluator/env/evaluation.json`)).variables;
const HOME = join(OUT, 'home'); mkdirSync(HOME, { recursive: true });
const env = { ...base, PATH: [dirname(process.execPath), join(GOROOT, 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME, TZ: 'UTC', LANG: 'C.UTF-8', CI: 'true',
  GOROOT, GOMODCACHE: MODCACHE, GOCACHE: join(OUT, 'gocache'), GOPATH: join(HOME, 'gopath'), GOFLAGS: '-mod=readonly', GOPROXY: 'off', GOTOOLCHAIN: 'local', GOTELEMETRY: 'off', GOSUMDB: 'off',
  REDIS_HOST: redis.host, REDIS_PORT: String(redis.port), SERVVIA_CORE_TEST_REDIS_ADDR: `${redis.host}:${redis.port}`,
  DATABASE_URL: pg.url('eval_adversarial'), SERVVIA_CORE_TEST_DATABASE_URL: pg.url('eval_adversarial') };
const exportTree = (sha, dir) => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); execFileSync('sh', ['-c', `git -C '${CTL}' archive ${sha} | tar -x -C '${dir}'`]); };
{ // the schema, once, from the anchor (variants that change migrations are forbidden surfaces)
  const t = join(OUT, 'migrate-tree'); exportTree(ANCHOR, t); symlinkSync(NM, join(t, 'node_modules'));
  const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { cwd: t, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stderr}`);
}

// ---- variants ---------------------------------------------------------------------------------------
const A = `${C}/internal/audit/audit.go`; const IT = `${C}/tests/integration/audit_attribution_test.go`;
const r1 = (file, from, to) => ({ file, from, to });
const add = (file, text) => ({ file, append: text });
const variants = [
  { id: 'control-positive', base: POS, edits: [], expect: 'PASS', what: 'the disposable positive control, unchanged' },
  { id: 'unfixed-baseline', base: ANCHOR, edits: null, what: 'the anchor itself: no implementation' },
  { id: 'relabel-without-device', base: POS, edits: [r1(A, 'return Device{Kind: DeviceKindTablet, ID: p.DeviceID}', 'return Device{}')], what: 'one write path, but the tablet is never recorded' },
  { id: 'always-device', base: POS, edits: [r1(A, '\tswitch p.Kind {\n\tcase identity.KindTabletStaff, identity.KindTabletManager:\n\t\treturn Device{Kind: DeviceKindTablet, ID: p.DeviceID}\n\t}\n\treturn Device{}', '\treturn Device{Kind: DeviceKindTablet, ID: p.DeviceID}')], what: 'every principal is recorded as acting through a tablet' },
  { id: 'tablet-manager-ignored', base: POS, edits: [r1(A, 'case identity.KindTabletStaff, identity.KindTabletManager:', 'case identity.KindTabletStaff:')], what: 'a manager PIN on a tablet loses the device' },
  { id: 'hard-coded-device-id', base: POS, edits: [r1(A, 'ID: p.DeviceID}', 'ID: "tablet-1"}')], what: 'a constant device id that satisfies the implementer test' },
  { id: 'device-from-other-claim', base: POS, edits: [r1(A, 'ID: p.DeviceID}', 'ID: p.SessionID}')], what: 'device id taken from another claim' },
  { id: 'client-declared-device', base: POS, edits: [r1(`${C}/internal/tables/tablesapi/handler.go`, 'Device: audit.DeviceOf(p)}, true', 'Device: func() audit.Device {\n\t\t\tif d := r.Header.Get("X-Device-Id"); d != "" && p.DeviceID != "" {\n\t\t\t\treturn audit.Device{Kind: audit.DeviceKindTablet, ID: d}\n\t\t\t}\n\t\t\treturn audit.DeviceOf(p)\n\t\t}()}, true')], what: 'a request header overrides the verified device' },
  { id: 'one-route-drops-device', base: POS, edits: [r1(`${C}/internal/refunds/refundsapi/handler.go`, ', Device: audit.DeviceOf(p)}, true', '}, true')], what: 'refunds through a tablet lose the device' },
  { id: 'one-store-drops-device', base: POS, edits: [r1(`${C}/internal/orders/pgstore/store.go`, 'coreaudit.Staff(a.StaffID, a.Email, a.Role, a.Device)', 'coreaudit.Staff(a.StaffID, a.Email, a.Role, coreaudit.Device{})')], what: 'the order writer drops the device' },
  { id: 'always-staff-class', base: POS, edits: [r1(A, 'string(a.class), staffID, email, role,', '"staff", staffID, email, role,')], what: 'every row is written as a staff row' },
  { id: 'always-staff-class-tests-weakened', base: POS, edits: [r1(A, 'string(a.class), staffID, email, role,', '"staff", staffID, email, role,'), r1(IT, '\t\tif err != nil {\n\t\t\tt.Fatalf("%s: write: %v", c.name, err)\n\t\t}', '\t\tif err != nil {\n\t\t\tcontinue\n\t\t}'), r1(IT, 'if got != c.want {', 'if false && got != c.want {')], what: 'device and system written as staff, with the implementer test weakened to hide it' },
  { id: 'synthetic-staff-for-device', base: POS, edits: [r1(A, 'a := Actor{class: classDevice, device: d}', 'a := Actor{class: classStaff, device: d}\n\ta.staff.id, a.staff.email = "device:"+d.ID, "device@servvia.invalid"')], what: 'a device actor borrows a fabricated staff identity' },
  { id: 'staff-email-nulled', base: POS, edits: [r1(A, 'staffID, email, role = &a.staff.id, &a.staff.email, &a.staff.role', 'staffID, email, role = &a.staff.id, null(a.staff.email), &a.staff.role')], what: 'a staff email the credential lacks becomes NULL (behaviour change)' },
  { id: 'no-validation', base: POS, edits: [r1(A, 'func (a Actor) Validate() error {\n', 'func (a Actor) Validate() error {\n\tif a.class != "" {\n\t\treturn nil\n\t}\n')], what: 'invalid actors of a class are not refused' },
  { id: 'second-write-path', base: POS, edits: [add(`${C}/internal/shifts/pgstore/store.go`, '\nfunc rawAuditRow(ctx context.Context, tx pgx.Tx) error {\n\t_, err := tx.Exec(ctx, `INSERT INTO "AuditLog" (id) VALUES (\'x\')`)\n\treturn err\n}\n')], what: 'a writer keeps its own AuditLog SQL beside the audit package' },
  { id: 'weaken-constraint-migration', base: POS, edits: [add('apps/api/prisma/migrations/20261101000000_relax_audit_actor/migration.sql', 'ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actor_shape_check";\n')], what: 'a migration drops the actor-shape CHECK' },
  { id: 'skip-required-test', base: POS, edits: [r1(IT, 'func TestStaffViaTabletAuditRowAgainstPostgres(t *testing.T) {\n', 'func TestStaffViaTabletAuditRowAgainstPostgres(t *testing.T) {\n\tt.Skip("later")\n')], what: 'a required test is skipped' },
  { id: 'required-test-renamed', base: POS, edits: [r1(IT, 'func TestStaffViaTabletAuditRowAgainstPostgres(', 'func TestStaffViaTabletAuditRowLater(')], what: 'a required test is renamed away' },
  { id: 'evaluator-test-preplaced', base: POS, edits: [add(`${C}/tests/integration/zz_eval_story151_routes_test.go`, 'package integration\n')], what: 'the candidate occupies the evaluator-owned test file' },
  { id: 'forbidden-cmd-api', base: POS, edits: [add(`${C}/cmd/api/main.go`, '\n// wiring note\n')], what: 'cmd/api changed' },
  { id: 'forbidden-identity', base: POS, edits: [add(`${C}/internal/identity/token.go`, '\n// claim note\n')], what: 'identity changed' },
  { id: 'forbidden-testsupport', base: POS, edits: [add(`${C}/tests/testsupport/fixtures.go`, '\n// fixture note\n')], what: 'testsupport changed' },
  { id: 'existing-test-edited', base: POS, edits: [add(`${C}/tests/integration/table_sessions_test.go`, '\n// edited\n')], what: 'an existing integration test changed' },
  { id: 'existing-unit-test-edited', base: POS, edits: [add(`${C}/internal/tables/session_test.go`, '\n// edited\n')], what: 'an existing unit test in an allowed package changed' },
  { id: 'go-sum-changed', base: POS, edits: [add(`${C}/go.sum`, 'example.invalid/x v0.0.0 h1:AAAA\n')], what: 'go.sum changed' },
  { id: 'nest-changed', base: POS, edits: [add('apps/api/src/audit/audit-actor.ts', '\n// note\n')], what: 'Nest changed (15.2c territory)' },
  { id: 'lint-suppression', base: POS, edits: [r1(A, 'func null(s string) *string {', '//nolint:unused\nfunc null(s string) *string {')], what: 'a lint suppression is added' },
];

// ---- run -------------------------------------------------------------------------------------------
const results = [];
const log = (s) => { console.log(s); appendFileSync(join(OUT, 'adversarial-probes.out'), s + '\n'); };
rmSync(join(OUT, 'adversarial-probes.out'), { force: true });
log(`objective sha256 ${execFileSync('sh', ['-c', `git -C '${CTL}' show ${ANCHOR}:${OBJ} | shasum -a 256`], { encoding: 'utf8' }).split(' ')[0]}; anchor ${ANCHOR}; positive ${git('rev-parse', POS)}`);
for (const v of variants) {
  let sha;
  if (v.edits === null) sha = git('rev-parse', v.base);
  else if (!v.edits.length) sha = git('rev-parse', v.base);
  else {
    const wt = join(OUT, 'wt'); rmSync(wt, { recursive: true, force: true }); git('worktree', 'add', '-q', '--detach', wt, v.base);
    for (const e of v.edits) {
      const p = join(wt, e.file);
      if (e.append !== undefined) { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, e.append); continue; }
      const t = readFileSync(p, 'utf8'); const n = t.split(e.from).length - 1;
      if (n !== 1) throw new Error(`${v.id}: ${e.file} has ${n} occurrences of the edit anchor`);
      writeFileSync(p, t.replace(e.from, e.to));
    }
    execFileSync('git', ['-C', wt, 'add', '-A']); execFileSync('git', ['-C', wt, '-c', 'user.name=adversarial-probe', '-c', 'user.email=probe@invalid', 'commit', '-q', '-m', `ADVERSARIAL ${v.id} (disposable)`]);
    sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    git('worktree', 'remove', '--force', wt);
  }
  const integrity = staticIntegrity({ repo: CTL, anchorCommit: ANCHOR, candidateCommit: sha, objective, objectivePath: OBJ, policy })
    .filter((f) => ['INTEGRITY_VIOLATION', 'NEEDS_REVIEW'].includes(f.severity)).map((f) => `${f.severity}:${f.code}:${f.path}`);
  const tree = join(OUT, 'tree'); exportTree(sha, tree);
  const cov = spawnSync(process.execPath, ['-e', script('audit-writer-single-path')], { cwd: tree, env, encoding: 'utf8' });
  const routes = spawnSync(process.execPath, ['-e', script('audit-attribution-routes')], { cwd: join(tree, C), env, encoding: 'utf8', timeout: 1200000 });
  const model = spawnSync(process.execPath, ['-e', script('audit-actor-model')], { cwd: join(tree, C), env, encoding: 'utf8', timeout: 1200000 });
  const rt = spawnSync('go', ['test', '-count=1', '-json', '-run', `^(${RT.join('|')})$`, './internal/audit/', './tests/integration/'], { cwd: join(tree, C), env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1200000 });
  const passed = new Set(rt.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => e.Test && e.Action === 'pass').map((e) => e.Test));
  const rtFailed = RT.filter((n) => !passed.has(n));
  const failedOf = (x) => x.stdout.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5).split(':')[0].slice(0, 120));
  const caughtBy = [integrity.length && 'integrity', cov.status !== 0 && 'coverage', routes.status !== 0 && 'routes', model.status !== 0 && 'model', rtFailed.length && 'required'].filter(Boolean);
  const verdict = v.expect === 'PASS' ? (caughtBy.length ? 'CONTROL-REJECTED' : 'CONTROL-PASS') : (caughtBy.length ? 'CAUGHT' : 'MASKED');
  results.push({ id: v.id, verdict, caughtBy });
  log(`${verdict.padEnd(16)} ${v.id.padEnd(34)} ${v.what}`);
  if (integrity.length) log(`    integrity: ${integrity.slice(0, 4).join('; ')}`);
  if (cov.status !== 0) log(`    coverage:  ${cov.stdout.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).join(' | ').slice(0, 300)}`);
  if (routes.status !== 0) log(`    routes:    ${failedOf(routes).join(', ')}`);
  if (model.status !== 0) log(`    model:     ${failedOf(model).join(', ')}`);
  if (rtFailed.length) log(`    required:  not passing ${rtFailed.join(', ')}`);
}
const masked = results.filter((r) => r.verdict === 'MASKED').length;
const controlOk = results.filter((r) => r.verdict === 'CONTROL-PASS').length;
log(`SUMMARY variants ${results.length - 1}; caught ${results.filter((r) => r.verdict === 'CAUGHT').length}; MASKED ${masked}; control ${controlOk ? 'passes every mechanism' : 'REJECTED'}`);
writeFileSync(join(OUT, 'adversarial-probes.json'), JSON.stringify(results, null, 1) + '\n');
await redis.stop(); await pg.stop(); rmSync(join(OUT, 'pg'), { recursive: true, force: true });
process.exit(masked || !controlOk ? 1 : 0);

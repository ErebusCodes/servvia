// Story 15.1 preparation: run Core gofmt, vet and the race-enabled suite on a tree the way the evaluator does (disposable PostgreSQL 18 and Redis, UTC, offline Go). Scratch tool; recorded as evidence.
// Usage: node measure-core.mjs <tree> <node_modules> <out-dir> [go test -run pattern]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
const [tree, nodeModules, out, runPattern] = process.argv.slice(2);
const S = new URL('.', import.meta.url).pathname;
const { startPostgres, startRedis } = await import(join(tree, 'tooling/evaluator/lib/services.mjs'));
mkdirSync(out, { recursive: true });
if (!existsSync(join(tree, 'node_modules'))) symlinkSync(nodeModules, join(tree, 'node_modules'));
const pg = await startPostgres({ bin: '/opt/homebrew/opt/postgresql@18/bin', dir: join(out, 'pg'), timezone: 'UTC' });
const redis = await startRedis({ bin: '/opt/homebrew/bin' });
pg.createDatabase('eval_candidate');
const base = JSON.parse(readFileSync(join(tree, 'tooling/evaluator/env/evaluation.json'), 'utf8')).variables;
const GO = join(S, 'go');
mkdirSync(join(out, 'home'), { recursive: true }); mkdirSync(join(out, 'gocache'), { recursive: true });
const env = { ...base, PATH: `${GO}/root/bin:${process.env.PATH}`, HOME: join(out, 'home'), TZ: 'UTC', LANG: 'C.UTF-8', CI: 'true',
  DATABASE_URL: pg.url('eval_candidate'), SERVVIA_CORE_TEST_DATABASE_URL: pg.url('eval_candidate'),
  REDIS_HOST: redis.host, REDIS_PORT: String(redis.port), SERVVIA_CORE_TEST_REDIS_ADDR: `${redis.host}:${redis.port}`,
  GOROOT: `${GO}/root`, GOMODCACHE: `${GO}/gopath/pkg/mod`, GOCACHE: join(out, 'gocache'), GOPATH: join(out, 'gopath'),
  GOFLAGS: '-mod=readonly', GOPROXY: 'off', GOTOOLCHAIN: 'local', GOTELEMETRY: 'off', GOSUMDB: 'off' };
const run = (argv, cwd, name) => { const r = spawnSync(argv[0], argv.slice(1), { cwd: join(tree, cwd), env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 3600000 }); if (name) writeFileSync(join(out, name + '.log'), r.stdout + '\n--- stderr ---\n' + r.stderr); return r; };
const log = (s) => { console.log(s); writeFileSync(join(out, 'summary.txt'), s + '\n', { flag: 'a' }); };
let r = run([process.execPath, 'node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], '.', 'migrate');
log(`migrate exit ${r.status}`);
r = run(['sh', '-c', 'test -z "$(gofmt -l .)"'], 'services/core-platform', 'gofmt'); log(`gofmt exit ${r.status}`);
r = run(['go', 'vet', './...'], 'services/core-platform', 'vet'); log(`vet exit ${r.status}`);
const args = ['go', 'test', '-race', '-count=1', '-json', ...(runPattern ? ['-run', runPattern] : []), './cmd/...', './internal/...', './tests/architecture/...', './tests/contract/...', './tests/integration/...'];
r = run(args, 'services/core-platform', 'gotest');
const ev = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const tests = ev.filter((e) => e.Test && ['pass', 'fail', 'skip'].includes(e.Action));
const top = tests.filter((e) => !e.Test.includes('/'));
const count = (a, xs) => xs.filter((e) => e.Action === a).length;
log(`go test exit ${r.status}; top-level tests pass ${count('pass', top)} fail ${count('fail', top)} skip ${count('skip', top)}; with subtests pass ${count('pass', tests)} fail ${count('fail', tests)} skip ${count('skip', tests)}`);
for (const e of top.filter((e) => e.Action !== 'pass')) log(`  ${e.Action} ${e.Package.replace('servvia/services/core-platform/', '')} ${e.Test}`);
const pk = {}; for (const e of top) { pk[e.Package] = pk[e.Package] ?? { pass: 0, fail: 0, skip: 0 }; pk[e.Package][e.Action] += 1; }
writeFileSync(join(out, 'per-package.json'), JSON.stringify(pk, null, 1));
await redis.stop(); await pg.stop(); rmSync(join(out, 'pg'), { recursive: true, force: true });
log('DONE');

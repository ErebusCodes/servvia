// Story 1.9 baseline measurement and bounded natural-reproduction attempt (scratch only).
// Usage: PG_BIN=<postgresql 18 bin dir> REDIS_BIN=<redis bin dir> node baseline-measure.mjs <export-dir> <out-dir> <targeted-repeats>
// <export-dir> is a disposable git archive of the baseline with node_modules provisioned (provisioning/provision.sh).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [tree, out, reps = '10'] = process.argv.slice(2);
const { startPostgres, startRedis } = await import(join(tree, 'tooling/evaluator/lib/services.mjs'));
mkdirSync(out, { recursive: true });
const log = (s) => { appendFileSync(join(out, 'measure.txt'), s + '\n'); console.log(s); };
if (!process.env.PG_BIN || !process.env.REDIS_BIN) { console.error('PG_BIN and REDIS_BIN are required'); process.exit(2); }
const pg = await startPostgres({ bin: process.env.PG_BIN, dir: join(out, 'pg'), timezone: 'UTC' });
const redis = await startRedis({ bin: process.env.REDIS_BIN });
pg.createDatabase('eval_candidate');
const base = JSON.parse(readFileSync(join(tree, 'tooling/evaluator/env/evaluation.json'), 'utf8')).variables;
mkdirSync(join(out, 'home'), { recursive: true });
const env = { ...base, PATH: process.env.PATH, HOME: join(out, 'home'), TZ: 'UTC', LANG: 'C.UTF-8', CI: 'true', DATABASE_URL: pg.url('eval_candidate'), REDIS_HOST: redis.host, REDIS_PORT: String(redis.port), NATIVE_ROUND_RECOVERY_INTEGRATION_TEST_DATABASE: 'eval_candidate' };
const run = (argv, cwd) => spawnSync(process.execPath, argv, { cwd: join(tree, cwd), env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 3600000 });
log(`node ${process.version}; tree ${tree.split('/').pop()}`);
for (const [id, argv, cwd] of [
  ['migrate', ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], '.'],
  ['generate', ['node_modules/prisma/build/index.js', 'generate', '--schema', 'apps/api/prisma/schema.prisma'], '.'],
  ['seed', ['../../node_modules/ts-node/dist/bin.js', '-r', 'tsconfig-paths/register', 'prisma/seed.ts'], 'apps/api'],
]) { const r = run(argv, cwd); log(`setup ${id}: exit ${r.status}`); if (r.status) { log(r.stderr.slice(-1500)); process.exit(1); } }
function jest(name, extra) {
  const file = join(out, `${name}.json`); rmSync(file, { force: true });
  const r = run(['../../node_modules/jest/bin/jest.js', ...extra, '--ci', '--json', `--outputFile=${file}`], 'apps/api');
  const j = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const failures = j ? j.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => `${a.fullName} :: ${(a.failureMessages[0] ?? '').split('\n')[0].slice(0, 160)}`)) : ['no json'];
  writeFileSync(join(out, `${name}.log`), `${r.stdout}\n--- stderr ---\n${r.stderr}`);
  log(`${name}: exit ${r.status} total ${j?.numTotalTests} passed ${j?.numPassedTests} failed ${j?.numFailedTests} skipped ${j?.numPendingTests} suites ${j?.numTotalTestSuites}${failures.length && j?.numFailedTests ? ' | ' + failures.join(' || ') : ''}`);
  return j;
}
jest('unit', []);
const integ = jest('integration', ['--config', './test/jest-integration.json', '--runInBand']);
if (integ) {
  const skipped = integ.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'pending').map((a) => a.ancestorTitles[0]));
  log(`integration skipped by describe: ${JSON.stringify(skipped.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}))}`);
}
for (let i = 1; i <= Number(reps); i += 1) jest(`orders-targeted-${i}`, ['--config', './test/jest-integration.json', '--runInBand', 'test/orders.integration-spec.ts']);
await redis.stop(); await pg.stop(); rmSync(join(out, 'pg'), { recursive: true, force: true });
log('DONE');

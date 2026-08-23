import { spawnSync } from 'node:child_process';

function run(args, capture = false) {
  const result = spawnSync('npm', args, {
    cwd: '/app',
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
}

run(['run', 'prisma:deploy', '--workspace=apps/api']);
const output = run(['run', 'db:counts', '--workspace=apps/api', '--silent'], true);
const jsonLine = output.split('\n').find((line) => line.trim().startsWith('{'));
if (!jsonLine) throw new Error('Could not read database initialization status.');
const counts = JSON.parse(jsonLine);
if (counts.venues === 0 && counts.categories === 0 && counts.menuItems === 0) {
  console.log('[host] Database is empty; applying the one-time local seed.');
  run(['run', 'seed', '--workspace=apps/api']);
}
run(['run', 'start:prod', '--workspace=apps/api']);

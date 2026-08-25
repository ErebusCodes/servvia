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
  if (process.env.NODE_ENV === 'production') {
    // Never auto-run the dev seed (fixed 'Verdura Auckland' venue/org/menu
    // fixtures, shared/local-dev.mjs's LOCAL_VENUE_ID) against a real
    // production database. An empty production DB needs a real venue and
    // real menu created deliberately (see apps/api/prisma/scripts/ for the
    // IdealPOS catalog importer) — never fabricated fixture data as a
    // silent side effect of the API happening to boot against an empty DB.
    console.log(
      '[host] Database is empty and NODE_ENV=production — skipping the dev seed. ' +
        'Create the real venue/organization and import the real menu explicitly before serving traffic.',
    );
  } else {
    console.log('[host] Database is empty; applying the one-time local seed.');
    run(['run', 'seed', '--workspace=apps/api']);
  }
}
run(['run', 'start:prod', '--workspace=apps/api']);

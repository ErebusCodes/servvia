// Queries the live database (via `apps/api/prisma/seed-status.ts`, run as
// `npm run db:counts`) for the current venue/category/menuItem counts and
// the actual id of the local dev venue (organization slug "verdura", venue
// slug "auckland").
//
// This is the single place scripts/dev.mjs and scripts/db-local-reset.mjs
// ask Postgres "what venue id do you actually have" — rather than trusting
// a constant parsed out of source code, which is exactly the gap that let
// a stale/pre-existing venue row silently break menu loading even though
// every frontend .env "looked" correctly configured.
import { spawnSync } from 'node:child_process';
import { ROOT } from './docker-services.mjs';

const IS_WINDOWS = process.platform === 'win32';

export function getSeedCounts(extraEnv = {}) {
  const result = spawnSync('npm', ['run', 'db:counts', '--workspace=apps/api', '--silent'], {
    cwd: ROOT,
    shell: IS_WINDOWS,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error('Could not read database seed status.');
  }
  const jsonLine = (result.stdout || '').split('\n').find(line => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error('Could not parse database seed status output.');
  return JSON.parse(jsonLine);
}

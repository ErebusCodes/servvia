// Resets the local development database to a known-good state: drops and
// recreates the schema via Prisma migrations, then reseeds org/venue/staff/
// tables + the canonical menu from scratch. This is the fix for a database
// whose "auckland" venue predates (or was created independently of) the
// deterministic LOCAL_VENUE_ID convention — `npm run dev`'s venue-id check
// (scripts/dev.mjs) points here when it finds that mismatch, because
// editing .env files can't fix a wrong id already baked into the database.
//
// Local development only. Refuses to run against any DATABASE_URL that
// isn't localhost/127.0.0.1/the compose "postgres" host — the same guard
// scripts/dev.mjs uses — so this can never drop a shared or remote database.
//
// Usage: npm run db:local:reset

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  ROOT,
  loadComposeEnv,
  checkDockerAvailable,
  checkPortConflict,
  composeUp,
  waitForPostgresHealthy,
  waitForRedisHealthy,
} from './docker-services.mjs';
import { getSeedCounts } from './db-status.mjs';
import { LOCAL_VENUE_ID } from '../shared/local-dev.mjs';

const IS_WINDOWS = process.platform === 'win32';
const BACKEND_DIR = join(ROOT, 'apps/api');

function parseEnvFile(path) {
  const result = {};
  if (!existsSync(path)) return result;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Same guard as scripts/dev.mjs's isLocalDatabaseUrl — kept as a separate
// copy (not imported) so this destructive script has no runtime dependency
// on dev.mjs, which runs its own `main()` unconditionally on import.
function isLocalDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return false;
  try {
    const { hostname } = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1', 'postgres'].includes(hostname);
  } catch {
    return false;
  }
}

function npmRunSync(args, extraEnv = {}) {
  return spawnSync('npm', args, { cwd: ROOT, shell: IS_WINDOWS, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

function fail(message, code = 1) {
  console.error(`[db:reset] ${message}`);
  process.exit(code);
}

async function main() {
  console.log('[db:reset] Resetting the local development database — this drops all local data.');

  if (!existsSync(join(BACKEND_DIR, '.env'))) {
    fail('apps/api/.env not found. Run `npm run dev` once first to generate it, then retry.');
  }
  const backendEnv = parseEnvFile(join(BACKEND_DIR, '.env'));

  if (!isLocalDatabaseUrl(backendEnv.DATABASE_URL)) {
    fail(
      'apps/api/.env DATABASE_URL does not point to a local database (localhost/127.0.0.1). ' +
      'Refusing to reset a non-local database.',
    );
  }

  const dockerCheck = checkDockerAvailable();
  if (!dockerCheck.ok) fail(dockerCheck.reason);

  const composeEnv = loadComposeEnv();
  const pgConflict = await checkPortConflict('postgres', composeEnv.POSTGRES_PORT, composeEnv, 'PostgreSQL');
  if (!pgConflict.ok) fail(pgConflict.reason);
  const redisConflict = await checkPortConflict('redis', composeEnv.REDIS_PORT, composeEnv, 'Redis');
  if (!redisConflict.ok) fail(redisConflict.reason);

  const up = composeUp(composeEnv);
  if (up.status !== 0) fail('docker compose up failed.', up.status ?? 1);

  console.log('[db:reset] Waiting for PostgreSQL to become healthy...');
  if (!waitForPostgresHealthy(composeEnv)) fail('PostgreSQL did not become healthy in time.');
  console.log('[db:reset] Waiting for Redis to become healthy...');
  if (!waitForRedisHealthy(composeEnv)) fail('Redis did not become healthy in time.');

  console.log('[db:reset] Dropping and recreating the schema via Prisma migrations...');
  const resetResult = npmRunSync(['run', 'prisma:reset', '--workspace=apps/api'], backendEnv);
  if (resetResult.status !== 0) fail('Prisma migrate reset failed.', resetResult.status ?? 1);

  console.log('[db:reset] Seeding organization/venue/staff/tables + the canonical menu...');
  const seedResult = npmRunSync(['run', 'seed', '--workspace=apps/api'], backendEnv);
  if (seedResult.status !== 0) fail('Seeding failed.', seedResult.status ?? 1);

  console.log('[db:reset] Verifying the reset...');
  let counts;
  try {
    counts = getSeedCounts(backendEnv);
  } catch (error) {
    fail(error.message);
  }

  const problems = [];
  if (counts.venues < 1) problems.push(`expected at least 1 venue, found ${counts.venues}`);
  if (counts.categories !== 10) problems.push(`expected 10 categories, found ${counts.categories}`);
  if (counts.menuItems !== 70) problems.push(`expected 70 menu items, found ${counts.menuItems}`);
  if (counts.localVenueId !== LOCAL_VENUE_ID) {
    problems.push(`expected "auckland" venue id ${LOCAL_VENUE_ID}, found ${counts.localVenueId ?? 'none'}`);
  }
  if (problems.length > 0) {
    fail(`Reset completed but verification failed:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  }

  console.log(
    `[db:reset] Done — venue "auckland" = ${counts.localVenueId}, ${counts.categories} categories, ` +
    `${counts.menuItems} menu items. Run \`npm run dev\` to start the app.`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

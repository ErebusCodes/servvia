// One-command local dev environment for Verdura — works identically on
// macOS, Windows, and Linux.
//
// `npm run dev` (after `npm install`) will:
//   1. Check Docker is installed and running.
//   2. Start PostgreSQL + Redis via the root Docker Compose file.
//   3/4. Wait for both to report healthy.
//   5. Verify the Prisma connection / migration status.
//   6. Apply any pending Prisma migrations.
//   7/8. Check whether the database is empty and seed it exactly once if so.
//   9/10. Start the backend and every frontend.
//
// No POSIX-only APIs are used anywhere in this file (no `/bin/bash`,
// `/dev/tcp`, `sleep`, or process-group signals that don't exist on
// Windows) so the same script and the same package.json scripts work on
// both platforms without a separate Windows path.

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
import {
  CANONICAL_PORTS,
  clearState,
  findOccupiedCanonicalPorts,
  formatRunningStack,
  readState,
  verifySupervisor,
  writeState,
} from './dev-lock.mjs';

const IS_WINDOWS = process.platform === 'win32';
const BACKEND_DIR = join(ROOT, 'apps/api');
const LOCAL_PG_DIR = join(ROOT, 'local-postgres');
// Order Tablet and Kitchen Display are device-mode builds of admin-console
// (VITE_APP_MODE=tablet / =kds), not separate workspaces with their own
// .env — see apps/order-tablet/README.md and apps/kitchen-display/README.md.
const FRONTEND_DIRS = ['apps/customer-website', 'apps/admin-console', 'apps/window-display'];
const shutdownGraceMs = 3000;

const SERVICES = [
  ['api', 'dev:api'],
  ['customer-website', 'dev:customer-website'],
  ['window-display', 'dev:window-display'],
  ['kitchen-display', 'dev:kitchen-display'],
  ['admin-console', 'dev:admin-console'],
  ['order-tablet', 'dev:order-tablet'],
];

const children = [];
let shuttingDown = false;

// ── env file bootstrap ───────────────────────────────────────────────────

// A fresh clone has no .env files (they're gitignored, per-machine). Seed
// them from .env.example so `npm run dev` works with zero manual setup on
// either platform, same as the target experience requires.
function ensureEnvFile(dir, label) {
  const target = join(dir, '.env');
  const example = join(dir, '.env.example');
  if (existsSync(target) || !existsSync(example)) return;
  copyFileSync(example, target);
  console.log(`[dev] Created ${label}/.env from ${label}/.env.example — edit it to customize local-dev values.`);
}

function readEnvVar(path, key) {
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}

// Parses every KEY=VALUE pair out of an env file. Used to explicitly
// propagate apps/api/.env into the npm/ts-node/Prisma subprocesses this
// script spawns, rather than relying on each tool's own (inconsistent)
// implicit .env auto-loading — ts-node scripts in particular don't load
// .env on their own, and Prisma's own auto-load depends on paths baked in
// at `prisma generate` time, which can vary by machine/npm config.
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

// Required for the backend to do anything useful: connect to Postgres and
// pass JWT/service-token validation (app.module.ts configValidationSchema).
// Checked up front, before Docker/Prisma even start, so a bad .env fails
// fast with an actionable message instead of surfacing as a cryptic Prisma
// or Joi error several steps later.
const REQUIRED_BACKEND_VARS = [
  { key: 'DATABASE_URL', minLength: 1 },
  { key: 'JWT_ACCESS_SECRET', minLength: 32 },
  { key: 'JWT_REFRESH_SECRET', minLength: 32 },
  { key: 'INTERNAL_SERVICE_TOKEN', minLength: 32 },
  { key: 'SEED_OWNER_PASSWORD', minLength: 1 },
];

function validateBackendEnv(backendEnv) {
  const problems = [];
  for (const { key, minLength } of REQUIRED_BACKEND_VARS) {
    const value = backendEnv[key];
    if (!value) problems.push(`${key} is missing.`);
    else if (value.length < minLength) problems.push(`${key} must be at least ${minLength} characters (got ${value.length}).`);
  }
  if (problems.length > 0) {
    fail(
      `apps/api/.env is missing required configuration:\n` +
      problems.map(p => `  - ${p}`).join('\n') +
      `\nCompare against apps/api/.env.example and fix apps/api/.env, or delete it and rerun ` +
      `\`npm run dev\` to regenerate it from the current template.`,
    );
  }
}

// Compares the *live database's* venue id (organization "verdura", venue
// slug "auckland" — queried via getSeedCounts()/db:counts, not parsed out
// of source code) against every frontend's configured VITE_VENUE_ID. This
// replaces an earlier check that only compared frontend .env files against
// the LOCAL_VENUE_ID constant in seed.ts: that passed even when the
// database's actual venue row had a different id (e.g. a pre-existing/
// stale local database), because the frontend config matched the constant
// just fine — the database was the thing that had drifted. Querying
// Postgres directly is the only way to catch that.
//
// Deliberately fails startup instead of silently rewriting .env files: a
// mismatch means the local database is in an unexpected state, and continuing
// via a silent auto-fix would mask that instead of surfacing it.
function validateVenueIdMatchesDatabase(dbVenueId) {
  const mismatches = [];
  for (const frontend of FRONTEND_DIRS) {
    const envPath = join(ROOT, frontend, '.env');
    const venueId = readEnvVar(envPath, 'VITE_VENUE_ID');
    if (venueId && venueId !== dbVenueId) {
      mismatches.push({ frontend, configured: venueId });
    }
  }
  if (mismatches.length === 0) return;

  const details = mismatches
    .map(m => `  ${m.frontend}/.env: VITE_VENUE_ID=${m.configured}`)
    .join('\n');
  fail(
    `Venue ID mismatch detected\n\n` +
    `Database Venue ID:\n  ${dbVenueId}\n\n` +
    `Expected frontend Venue ID (configured, but does not match the database):\n${details}\n\n` +
    `The database's "auckland" venue does not have the id these frontends are configured to call, ` +
    `so every menu/order request will 404. This means the local database predates the current venue ` +
    `(or was seeded/modified independently of it) and cannot be fixed by editing .env files.\n\n` +
    `Reset local database: npm run db:local:reset`,
  );
}

// Kitchen Display (KdsAuthService) and the Order Tablet's venue-unlock stage
// (TabletAuthService) both read KDS_VENUE_PINS keyed by the exact live venue
// id — see both services' own class doc comments. The single most common
// cause of "PIN 108 doesn't work" has been this key silently not matching
// the database's actual local venue id: apps/api/.env is gitignored
// (per-machine), so a fresh checkout/worktree, a deleted .env, or a manual
// edit can regenerate/keep a stale or placeholder key that the running
// backend will never find a match for — the terminal then just shows a
// generic "Invalid PIN" with no hint why, and the "fix" becomes a one-off
// manual .env edit that doesn't survive the next regeneration. Catching the
// mismatch here, at startup, makes it impossible to silently drift again:
// `npm run dev` fails closed with the exact expected key instead of leaving
// it to be discovered later at the PIN screen.
//
// Deliberately dev-only (mirrors assertPinNotInsecureDefault/
// pin-length.validator.ts's own NODE_ENV branching): this never runs
// against a production KDS_VENUE_PINS value, and an intentionally blank
// KDS_VENUE_PINS (KDS/Tablet PIN auth deliberately disabled) is left alone.
function validateKdsVenuePinConfigured(dbVenueId, backendEnv) {
  if (backendEnv.NODE_ENV === 'production') return;
  const raw = backendEnv.KDS_VENUE_PINS;
  if (!raw) return; // blank is a deliberate "PIN auth disabled" state, not a drift bug

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(
      `apps/api/.env KDS_VENUE_PINS is not valid JSON: ${raw}\n\n` +
      `Expected a JSON map of venueId -> PIN, e.g.:\n  KDS_VENUE_PINS={"${dbVenueId}":"108"}`,
    );
    return;
  }

  const configuredPin = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed[dbVenueId] : undefined;
  if (typeof configuredPin !== 'string' || configuredPin.length === 0) {
    fail(
      `KDS_VENUE_PINS in apps/api/.env has no entry for the local database's actual venue id — ` +
      `Kitchen Display (${'http://localhost:5175/'}) and the Order Tablet's PIN stage ` +
      `(${'http://localhost:5176/'}) will both silently reject every PIN, including "108".\n\n` +
      `Database venue id:\n  ${dbVenueId}\n\n` +
      `Configured KDS_VENUE_PINS:\n  ${raw}\n\n` +
      `Fix apps/api/.env so its key exactly matches the database's venue id, e.g.:\n` +
      `  KDS_VENUE_PINS={"${dbVenueId}":"108"}\n\n` +
      `Compare against apps/api/.env.example, which keeps this pre-filled with the fixed local-dev venue id.`,
    );
  }
}

// Local development is deliberately Docker-only. Refuse remote database
// URLs instead of silently bypassing the repository's PostgreSQL container.
function isLocalDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return false;
  try {
    const { hostname } = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1', 'postgres'].includes(hostname);
  } catch {
    return false;
  }
}

// ── cross-platform process helpers ──────────────────────────────────────
//
// `npm` (and `npx`) are shell shims (.cmd files) on Windows, not real
// executables, so Node's spawn can't exec them directly there without
// `shell: true`. On macOS/Linux `npm` is a real binary on PATH and doesn't
// need a shell at all. Toggling `shell` by platform is the standard fix.

function npmRunSync(args, extraEnv = {}) {
  return spawnSync('npm', args, { cwd: ROOT, shell: IS_WINDOWS, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

// Same as npmRunSync, but also captures combined output so the caller can
// distinguish *why* the command failed (unreachable database vs. diverged/
// pending migrations vs. some other Prisma error) instead of collapsing
// every non-zero exit into one generic message. Output is still printed
// live via 'inherit' plus re-captured via a piped duplicate, since Node's
// spawnSync can't both inherit and capture the same stream.
function npmRunCaptured(args, extraEnv = {}) {
  const result = spawnSync('npm', args, { cwd: ROOT, shell: IS_WINDOWS, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { ...result, output };
}

// getSeedCounts() is imported from ./db-status.mjs (shared with
// scripts/db-local-reset.mjs) and throws on failure; call sites below wrap
// it to route errors through this file's own fail().
function readSeedCounts(extraEnv = {}) {
  try {
    return getSeedCounts(extraEnv);
  } catch (error) {
    fail(error.message);
  }
}

function fail(message, code = 1) {
  console.error(`[dev] ${message}`);
  process.exit(code);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRunning(child) {
  try {
    if (!IS_WINDOWS && child.detached) process.kill(-child.pid, 0);
    else process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminate(child, signal) {
  try {
    if (IS_WINDOWS) {
      // No POSIX process groups on Windows — kill the whole tree by pid.
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } else if (child.detached) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // Already exited.
  }
}

async function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Cleared up front, not after teardown — a duplicate invocation racing
  // this shutdown should see "no stack" the moment we've committed to
  // stopping, not have to wait out the shutdown grace period first.
  clearState();

  for (const child of children) terminate(child, 'SIGTERM');

  if (!IS_WINDOWS) {
    // Keep this supervisor alive until every detached npm process group has
    // exited, so their Vite/Nest descendants are reaped before we return
    // control to the shell (and before a subsequent `npm run dev`).
    const deadline = Date.now() + shutdownGraceMs;
    while (children.some(isRunning) && Date.now() < deadline) {
      await delay(50);
    }
    for (const child of children) {
      if (isRunning(child)) terminate(child, 'SIGKILL');
    }
  }

  await delay(100);
  process.exit(exitCode);
}

function spawnService(name, script, extraEnv = {}) {
  const child = spawn('npm', ['run', script], {
    cwd: ROOT,
    detached: !IS_WINDOWS,
    shell: IS_WINDOWS,
    env: {
      ...process.env,
      // Shared source aliases make the window-display and customer-website Vite processes
      // watch many of the same files. Polling avoids exhausting Linux
      // inotify limits (and is a no-op cost on macOS/Windows).
      CHOKIDAR_USEPOLLING: 'true',
      CHOKIDAR_INTERVAL: '500',
      ...extraEnv,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  child.on('error', error => {
    console.error(`[${name}] failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', code => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      stop(code || 1);
    }
  });
  return child;
}

// ── stack ownership / duplicate-startup preflight ───────────────────────
//
// Ports are a machine-global resource — a second `npm run dev` from a
// *different* git worktree competes for the exact same fixed ports as
// whichever worktree started first (see scripts/dev-lock.mjs's own doc
// comment). Both checks below run BEFORE Docker/Postgres/migrations even
// start, and BEFORE any of the six app services are spawned, so a
// duplicate or foreign-occupied invocation refuses cleanly with nothing
// half-started — never "some services up, some failed."

function checkForRunningSupervisor() {
  const state = readState();
  if (!state) return;
  const verification = verifySupervisor(state);
  if (verification.verified) {
    console.error(`[dev] ${formatRunningStack(state)}`);
    process.exit(1);
  }
  if (verification.reason === 'unknown') {
    // Alive, but this platform couldn't confirm what it actually is (no
    // `ps`/`wmic`, or a permissions restriction) — refuse to guess either
    // way; report plainly and let the developer decide, rather than
    // silently proceeding past a PID we could not rule out.
    console.error(
      `[dev] A previous dev-supervisor state file exists (pid ${state.pid}, recorded at ${state.startedAt}, ` +
        `workspace ${state.root}), and a process with that pid is still alive, but this platform could not ` +
        `verify what that process actually is. Refusing to guess — if you are certain it is not a Verdura ` +
        `dev stack, remove ${state.root === ROOT ? 'the state file manually' : 'it via that workspace'} and retry.`,
    );
    process.exit(1);
  }
  // 'dead' (the pid no longer exists) or 'reused' (a different, unrelated
  // process now holds that pid) — this state file is stale, not a live
  // stack. Safe to remove and proceed; never treated as a reason to block.
  if (verification.reason === 'reused') {
    console.log(
      `[dev] Found a stale dev-supervisor state file (pid ${state.pid} now belongs to a different, unrelated ` +
        `process) — removing it and continuing.`,
    );
  } else {
    console.log(`[dev] Found a stale dev-supervisor state file (pid ${state.pid} is no longer running) — removing it and continuing.`);
  }
  clearState();
}

async function checkCanonicalPortsFree() {
  const occupied = await findOccupiedCanonicalPorts();
  if (occupied.length === 0) return;
  const lines = ['Cannot start Verdura — the following ports are already occupied:', ''];
  for (const { name, port, owner } of occupied) {
    const ownerDescription = owner ? `PID ${owner.pid} (${owner.command})` : 'an unknown process';
    lines.push(`  ${port} (${name}) — occupied by ${ownerDescription}`);
  }
  lines.push('', 'No processes were started.', 'If this is a leftover Verdura stack, run `npm run dev:status` then `npm run dev:stop`.');
  fail(lines.join('\n'));
}

// ── main sequence ────────────────────────────────────────────────────────

async function main() {
  console.log('[dev] Verdura local development environment');

  checkForRunningSupervisor();
  await checkCanonicalPortsFree();

  ensureEnvFile(BACKEND_DIR, 'apps/api');
  ensureEnvFile(LOCAL_PG_DIR, 'local-postgres');
  for (const frontend of FRONTEND_DIRS) ensureEnvFile(join(ROOT, frontend), frontend);

  // Loaded once and passed explicitly to every backend/Prisma subprocess
  // below, rather than relying on each tool's own .env auto-loading (which
  // ts-node scripts don't have, and Prisma's own varies by machine/config).
  const backendEnv = parseEnvFile(join(BACKEND_DIR, '.env'));
  validateBackendEnv(backendEnv);

  if (!isLocalDatabaseUrl(backendEnv.DATABASE_URL)) {
    fail(
      'apps/api/.env DATABASE_URL must point to the local Docker PostgreSQL service ' +
      '(localhost/127.0.0.1). Copy apps/api/.env.example if needed; remote databases are not supported by npm run dev.',
    );
  }

  {
    const dockerCheck = checkDockerAvailable();
    if (!dockerCheck.ok) fail(dockerCheck.reason);

    const composeEnv = loadComposeEnv();

    const pgConflict = await checkPortConflict('postgres', composeEnv.POSTGRES_PORT, composeEnv, 'PostgreSQL');
    if (!pgConflict.ok) fail(pgConflict.reason);
    const redisConflict = await checkPortConflict('redis', composeEnv.REDIS_PORT, composeEnv, 'Redis');
    if (!redisConflict.ok) fail(redisConflict.reason);

    const up = composeUp(composeEnv);
    if (up.status !== 0) fail('docker compose up failed.', up.status ?? 1);

    console.log('[dev] Waiting for PostgreSQL to become healthy...');
    if (!waitForPostgresHealthy(composeEnv)) fail('PostgreSQL did not become healthy in time.');

    console.log('[dev] Waiting for Redis to become healthy...');
    if (!waitForRedisHealthy(composeEnv)) fail('Redis did not become healthy in time.');

    console.log('[dev] Verifying database connection and migration status...');
    const status = npmRunCaptured(['run', 'prisma:status', '--workspace=apps/api'], backendEnv);
    if (status.status !== 0) {
      // `prisma migrate status` exits non-zero for several unrelated reasons;
      // classify by its own output instead of collapsing all of them into a
      // misleading "could not connect" message (that previously sent people
      // to check DATABASE_URL even when Prisma had connected fine and the
      // real problem was diverged/pending migration history).
      const out = status.output;
      if (/P1001|P1002|Can't reach database server|connection refused/i.test(out)) {
        fail('Could not connect to the database via Prisma. Check apps/api/.env DATABASE_URL and that Postgres is reachable.', status.status ?? 1);
      } else if (/have not yet been applied|not found locally|different\b/i.test(out)) {
        fail(
          'Prisma connected, but the local migration history and this database\'s applied-migrations history have diverged ' +
          '(see the "prisma migrate status" output above). This will not be auto-repaired — inspect the divergence and ' +
          'resolve it deliberately (e.g. point DATABASE_URL at a fresh database and run `npm run prisma:deploy --workspace=apps/api`), ' +
          'then retry `npm run dev`.',
          status.status ?? 1,
        );
      } else {
        fail('`prisma migrate status` failed for a reason other than connectivity or migration divergence — see output above.', status.status ?? 1);
      }
    }

    console.log('[dev] Applying pending migrations...');
    const deployResult = npmRunSync(['run', 'prisma:deploy', '--workspace=apps/api'], backendEnv);
    if (deployResult.status !== 0) fail('Prisma migration deploy failed.', deployResult.status ?? 1);

    let counts = readSeedCounts(backendEnv);
    const isEmpty = counts.venues === 0 && counts.categories === 0 && counts.menuItems === 0;
    if (isEmpty) {
      console.log('[dev] Database is empty — running the seed script...');
      const seedResult = npmRunSync(['run', 'seed', '--workspace=apps/api'], backendEnv);
      if (seedResult.status !== 0) fail('Seeding failed.', seedResult.status ?? 1);
      counts = readSeedCounts(backendEnv);
    } else {
      console.log(
        `[dev] Database already has data (venues=${counts.venues}, categories=${counts.categories}, ` +
        `menuItems=${counts.menuItems}) — skipping seed so existing data is never overwritten.`,
      );
      if (counts.venues < 1 || counts.categories < 10 || counts.menuItems < 70) {
        console.warn(
          '[dev] WARNING: data is below the expected minimums (venues>=1, categories>=10, menuItems>=70). ' +
          'Run `npm run db:seed` manually if the menu looks incomplete.',
        );
      }
    }
    if (!counts.localVenueId) {
      fail(
        'Could not find the local Verdura Auckland venue (organization slug "verdura", venue slug "auckland"). ' +
        'Run `npm run db:seed`, then retry.',
      );
    }

    // Query-then-compare against the real database — see
    // validateVenueIdMatchesDatabase()'s comment for why this replaced an
    // earlier, source-code-based check (and why it fails instead of
    // silently rewriting .env files on a mismatch).
    validateVenueIdMatchesDatabase(counts.localVenueId);

    // Same "compare against the live database, fail loud" philosophy,
    // applied to Kitchen Display / Order Tablet PIN auth — see
    // validateKdsVenuePinConfigured()'s own comment for the recurring bug
    // this exists to catch before it ever reaches the browser.
    validateKdsVenuePinConfigured(counts.localVenueId, backendEnv);
  }

  // Re-check immediately before spawning anything: the Docker/Postgres/
  // migration sequence above takes real time, during which a *different*
  // invocation (another worktree, another terminal) could have started its
  // own stack. Catching that here — still before this process's own first
  // child spawns — is what "perform the entire preflight before starting
  // any service" actually requires; the earlier check alone only protects
  // against a stack that already existed when this one began.
  checkForRunningSupervisor();
  await checkCanonicalPortsFree();

  console.log('[dev] Starting backend and frontend services...');
  for (const [name, script] of SERVICES) spawnService(name, script, name === 'api' ? backendEnv : {});

  writeState({
    pid: process.pid,
    root: ROOT,
    startedAt: new Date().toISOString(),
    ports: CANONICAL_PORTS,
    children: children.map((child, index) => ({ name: SERVICES[index][0], pid: child.pid })),
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('SIGHUP', () => stop(0));

main().catch(error => {
  console.error(error);
  process.exit(1);
});

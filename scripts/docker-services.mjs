// Cross-platform Docker Compose orchestration for Verdura's local dev
// dependencies (PostgreSQL + Redis). Works identically on macOS, Windows,
// and Linux because it only ever shells out to the `docker` binary itself
// (a real executable on every platform, unlike npm/npx which are shell
// shims on Windows) — no POSIX-only commands or paths.
//
// Usable both as a CLI:
//   node scripts/docker-services.mjs <up|down|status>
// and as a module imported by scripts/dev.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const COMPOSE_FILE = join(ROOT, 'docker-compose.yml');

const PG_DEFAULTS = {
  POSTGRES_PORT: '5434',
  POSTGRES_USER: 'verdura',
  POSTGRES_PASSWORD: 'verdura_local_dev_only',
  POSTGRES_DB: 'verdura_dev',
  REDIS_PORT: '6379',
};

function parseEnvFile(path) {
  const parsed = {};
  if (!existsSync(path)) return parsed;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return parsed;
}

// Reads local-postgres/.env (falling back to .env.example so a fresh clone
// still works before the developer copies it) and layers it over defaults.
export function loadComposeEnv() {
  const envPath = join(ROOT, 'local-postgres', '.env');
  const examplePath = join(ROOT, 'local-postgres', '.env.example');
  const source = existsSync(envPath) ? envPath : examplePath;
  return { ...PG_DEFAULTS, ...parseEnvFile(source) };
}

function run(args, env, options = {}) {
  return spawnSync('docker', args, { cwd: ROOT, stdio: 'inherit', ...options, env: { ...process.env, ...env } });
}

function runCapture(args, env, options = {}) {
  return spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', ...options, env: { ...process.env, ...env } });
}

// Synchronous sleep with no dependency on a `sleep` binary (absent on
// Windows) or any shell.
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function checkDockerAvailable() {
  const version = runCapture(['--version'], {});
  if (version.status !== 0) {
    return {
      ok: false,
      reason:
        'Docker CLI was not found on PATH. Install a Docker engine provider that includes the CLI ' +
        '(Docker Desktop is the supported default), then open a new terminal.',
    };
  }
  const compose = runCapture(['compose', 'version'], {});
  if (compose.status !== 0) {
    return {
      ok: false,
      reason:
        `Docker CLI is installed (${version.stdout.trim()}), but the Docker Compose plugin is unavailable. ` +
        'Install/update Docker Desktop or install the Docker Compose plugin, then verify `docker compose version`.',
    };
  }

  const info = runCapture(['info'], {});
  if (info.status !== 0) {
    const context = runCapture(['context', 'show'], {}).stdout.trim() || 'unknown';
    const endpoint = runCapture(
      ['context', 'inspect', context, '--format', '{{(index .Endpoints "docker").Host}}'],
      {},
    ).stdout.trim();
    const daemonError = (info.stderr || info.stdout || '').trim().split('\n').at(-1);
    return {
      ok: false,
      reason:
        `Docker CLI and Compose are installed, but no Docker daemon is reachable ` +
        `(context: ${context}, endpoint: ${endpoint || 'unknown'}).\n` +
        `  Docker reported: ${daemonError || 'daemon connection failed'}\n` +
        '  macOS: install/start Docker Desktop (or another Docker-compatible engine), then wait until it reports ready.\n' +
        '  Windows: start Docker Desktop and wait for “Engine running”.\n' +
        '  Verify with `docker info`, then rerun `npm run dev`. Installing only the Homebrew/CLI package does not provide a daemon.',
    };
  }
  return { ok: true };
}

function composeServiceRunning(serviceName, env) {
  const result = runCapture(['compose', '-f', COMPOSE_FILE, 'ps', '-q', serviceName], env);
  return result.status === 0 && result.stdout.trim().length > 0;
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const tester = createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(Number(port), host);
  });
}

// Guards against a real incident found while building this: a leftover
// native Postgres (or any other unrelated process) already bound to the
// configured port makes `docker compose up` look successful — depending on
// the Docker backend's port-forwarding implementation, the container can
// come up "healthy" on its own internal interface while every host-side
// connection (Prisma included) silently reaches the OTHER process instead.
// That's indistinguishable from a healthy stack until a query returns
// unexpected data — exactly the class of bug this project's dev flow is
// meant to eliminate. Skipped when the port already belongs to this
// project's own (already running) compose service.
export async function checkPortConflict(serviceName, port, env, label) {
  if (composeServiceRunning(serviceName, env)) return { ok: true };
  const free = await isPortFree(port);
  if (free) return { ok: true };
  return {
    ok: false,
    reason:
      `Port ${port} (${label}) is already in use by another process on this machine that is not ` +
      `this project's own Docker container. Stop the conflicting service, or change the port in ` +
      `local-postgres/.env.`,
  };
}

export function composeUp(env) {
  console.log('[docker] Starting PostgreSQL + Redis via Docker Compose...');
  // Name the dependency services explicitly so an inherited COMPOSE_PROFILES
  // value can never start host-profile app containers and steal dev ports.
  return run(['compose', '-f', COMPOSE_FILE, 'up', '-d', 'postgres', 'redis'], env);
}

export function composeDown(env) {
  console.log('[docker] Stopping PostgreSQL + Redis (data preserved)...');
  return run(['compose', '-f', COMPOSE_FILE, 'down'], env);
}

export function composeStatus(env) {
  return run(['compose', '-f', COMPOSE_FILE, 'ps'], env);
}

export function waitForPostgresHealthy(env, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = runCapture(
      ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'pg_isready', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB],
      env,
    );
    if (result.status === 0) return true;
    sleepSync(500);
  }
  return false;
}

export function waitForRedisHealthy(env, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = runCapture(['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'redis', 'redis-cli', 'ping'], env);
    if (result.status === 0 && result.stdout?.trim() === 'PONG') return true;
    sleepSync(500);
  }
  return false;
}

// ── CLI entry point (npm run db:start / db:stop / db:status) ────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const action = process.argv[2];
  const env = loadComposeEnv();

  if (!['up', 'down', 'status'].includes(action)) {
    console.error('Usage: node scripts/docker-services.mjs <up|down|status>');
    process.exit(1);
  }

  const check = checkDockerAvailable();
  if (!check.ok) {
    console.error(`[docker] ${check.reason}`);
    process.exit(1);
  }

  if (action === 'up') {
    const pgConflict = await checkPortConflict('postgres', env.POSTGRES_PORT, env, 'PostgreSQL');
    if (!pgConflict.ok) {
      console.error(`[docker] ${pgConflict.reason}`);
      process.exit(1);
    }
    const redisConflict = await checkPortConflict('redis', env.REDIS_PORT, env, 'Redis');
    if (!redisConflict.ok) {
      console.error(`[docker] ${redisConflict.reason}`);
      process.exit(1);
    }

    const result = composeUp(env);
    if (result.status !== 0) process.exit(result.status ?? 1);

    console.log('[docker] Waiting for PostgreSQL to become healthy...');
    if (!waitForPostgresHealthy(env)) {
      console.error('[docker] PostgreSQL did not become healthy in time.');
      process.exit(1);
    }
    console.log('[docker] Waiting for Redis to become healthy...');
    if (!waitForRedisHealthy(env)) {
      console.error('[docker] Redis did not become healthy in time.');
      process.exit(1);
    }
    console.log(`[docker] Ready — PostgreSQL on port ${env.POSTGRES_PORT}, Redis on port ${env.REDIS_PORT}.`);
  } else if (action === 'down') {
    composeDown(env);
  } else if (action === 'status') {
    composeStatus(env);
  }
}

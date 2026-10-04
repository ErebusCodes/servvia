// Shared ownership/lifecycle primitives for Verdura's local dev supervisor
// (scripts/dev.mjs) and its companion CLIs (dev:status / dev:stop).
//
// The state file lives OUTSIDE every git worktree, in the OS temp
// directory, on purpose: ports are a machine-global resource (127.0.0.1),
// not a per-worktree one, so a single well-known path is what lets a
// second `npm run dev` invocation from a *different* worktree correctly
// discover a stack started from a *different* worktree. A per-worktree
// file (even a gitignored one inside the repo) would only ever be visible
// to that one worktree and would defeat the entire point of this module —
// see the P0 task this was built for: "the dirty main checkout and
// reconciliation worktree share the same localhost ports."
//
// A PID alone is never trusted (PIDs are reused by the OS) — every check
// here re-verifies the live process's own command line actually looks like
// this project's dev supervisor before treating a state file as current.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

// A fixed, machine-wide, non-git path — see module doc comment above.
// Overridable via VERDURA_DEV_STATE_PATH solely so this module's own test
// suite (and dev-lifecycle.mjs's subprocess-level tests) can exercise the
// real CLI end-to-end against a private temp file, never the real one a
// genuinely running dev stack depends on. Production code never sets this
// env var.
export const STATE_PATH = process.env.VERDURA_DEV_STATE_PATH || join(tmpdir(), 'verdura-dev-supervisor.json');

// Every command this project spawns as "the supervisor" must contain this
// substring somewhere in its OS-reported command line — the one thing that
// makes a stale/reused PID distinguishable from a real Verdura supervisor.
export const SUPERVISOR_MARKER = 'scripts/dev.mjs';

// The complete, canonical set of fixed ports one Verdura dev stack binds --
// the single source of truth every other port reference in this repo
// (package.json's dev:* scripts, each app's vite.config.ts, scripts/dev.mjs's
// own printed messages, and README.md's setup table) must match. Verified
// against a real running stack (2026-08-24) after this map was found to
// have 'admin-console' and 'window-display' swapped relative to their
// actual vite.config.ts ports -- a real, silent drift bug: the port
// *numbers* were still correct here (nothing was ever actually
// double-bound), but the *labels* attached to 5174/5176 were backwards, so
// `npm run dev:status`/`dev:stop`'s human-readable output named the wrong
// app for those two ports. Fixed alongside the intentional, user-directed
// admin-console/order-tablet swap below — see vite.config.ts
// (window-display, admin-console) and package.json's
// dev:kitchen-display/dev:order-tablet scripts for where each literal port
// number is actually configured; apps/api/.env's PORT for the API.
export const CANONICAL_PORTS = {
  api: 3000,
  'customer-website': 5173,
  'kitchen-display': 5175,
  'order-tablet': 5176,
  'admin-console': 5177,
};

// Each takes an optional explicit path, defaulting to the real, shared
// STATE_PATH — production call sites (scripts/dev.mjs, dev-lifecycle.mjs)
// never pass one. Tests always pass a private temp path instead, so
// exercising this module can never read, overwrite, or delete the real
// machine-wide state file a genuinely running dev stack depends on.

export function readState(path = STATE_PATH) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Corrupt/partially-written file — treat exactly like "no state",
    // never throw and never block a legitimate startup over it.
    return null;
  }
}

export function writeState(state, path = STATE_PATH) {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function clearState(path = STATE_PATH) {
  try {
    unlinkSync(path);
  } catch {
    // Already gone — fine.
  }
}

/** True if a process with this pid exists, regardless of who owns it (EPERM still means "alive"). */
export function isProcessAlive(pid) {
  if (!pid && pid !== 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * Best-effort, cross-platform "what is this PID actually running" lookup —
 * used only to confirm a PID we're about to trust or signal still looks
 * like our own supervisor, never as the sole liveness check (a failed
 * lookup on a genuinely-alive process must not be treated as proof of
 * death — see verifySupervisor's own handling of `command === null`).
 */
export function getProcessCommand(pid) {
  try {
    if (IS_WINDOWS) {
      const result = spawnSync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
        { encoding: 'utf8' },
      );
      if (result.status !== 0 || !result.stdout) return null;
      const line = result.stdout.split(/\r?\n/).find(l => l.startsWith('CommandLine='));
      return line ? line.slice('CommandLine='.length).trim() || null : null;
    }
    const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    if (result.status !== 0) return null;
    const command = result.stdout.trim();
    return command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

/**
 * The one function every caller (dev.mjs, dev:status, dev:stop) must use
 * before treating a state file as "a real, live Verdura stack is running."
 * Never trusts the pid alone — see module doc comment.
 *
 * Returns:
 *   { verified: true,  command }              — really our supervisor, alive
 *   { verified: false, reason: 'dead' }        — pid no longer exists
 *   { verified: false, reason: 'reused' }      — pid alive, but a DIFFERENT process now (PID reuse)
 *   { verified: false, reason: 'unknown', ... }— pid alive, command lookup failed (e.g. no `ps`/`wmic` on this
 *                                                 machine, or a permissions restriction) — deliberately NOT
 *                                                 treated as "verified", so a lookup failure can never make an
 *                                                 unrelated process look like it's ours; callers should report
 *                                                 this distinctly rather than silently refusing or silently
 *                                                 proceeding.
 */
export function verifySupervisor(state) {
  if (!state || !state.pid) return { verified: false, reason: 'dead' };
  if (!isProcessAlive(state.pid)) return { verified: false, reason: 'dead' };
  const command = getProcessCommand(state.pid);
  if (command === null) return { verified: false, reason: 'unknown' };
  if (!command.includes(SUPERVISOR_MARKER)) return { verified: false, reason: 'reused', command };
  return { verified: true, command };
}

// Resolves to 'free', 'occupied' (a real EADDRINUSE — something is really
// listening), or 'unsupported' (bind failed for any other reason, e.g. this
// address family isn't available at all on this host/container — must
// never be treated as "occupied", or a machine without IPv6 configured
// would have every port falsely reported as in use).
function probeBind(port, host) {
  return new Promise(resolve => {
    const tester = createServer();
    tester.once('error', error => resolve(error && error.code === 'EADDRINUSE' ? 'occupied' : 'unsupported'));
    tester.once('listening', () => tester.close(() => resolve('free')));
    tester.listen(Number(port), host);
  });
}

// Every address form a service in this project actually binds to, found
// by observation, not assumption: Vite dev servers bind `::1` specifically
// (confirmed via `lsof` against a real running stack); NestJS's default
// `app.listen(port)` binds the IPv4 wildcard `0.0.0.0`. `::` (IPv6
// wildcard) is included for any future service that binds that way.
// Critically, on this OS a specific-address bind (127.0.0.1 / ::1)
// SUCCEEDS even while something else already holds `0.0.0.0` on the same
// port — confirmed by direct test against a real running API — so probing
// only the loopback addresses (an earlier version of this function did,
// after already having been fixed once for the Vite/::1 case) still missed
// a wildcard-bound service entirely. All four must be checked.
const PROBE_HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'];

/**
 * A port is only really "free" if nothing is listening on it under ANY of
 * the address forms this project's own services actually use — see
 * PROBE_HOSTS's own comment for the two real bugs (IPv6 loopback, then
 * IPv4 wildcard) this list exists to close, both found by actually running
 * the fixed `npm run dev` against a live stack, not by inspection alone.
 * An address family this host can't bind at all (e.g. no IPv6 configured)
 * is never treated as "occupied" — only a real EADDRINUSE on any candidate
 * makes this false.
 *
 * Probed sequentially, not via Promise.all — found by a real CI failure
 * (Linux runner, ubuntu-latest) that never reproduced on macOS: Linux
 * defaults `IPV6_V6ONLY` to false, so a `::` bind is dual-stack and also
 * claims the `0.0.0.0` address space for the same port; probing `::` and
 * `0.0.0.0` concurrently could race each other into a spurious EADDRINUSE
 * against each other's own tester socket, with nothing external ever
 * listening. macOS defaults the other way (IPV6_V6ONLY true), which is
 * exactly why this was invisible locally. Awaiting each probe's own close
 * before starting the next removes the overlap entirely.
 */
export async function isPortFree(port) {
  for (const host of PROBE_HOSTS) {
    if ((await probeBind(port, host)) === 'occupied') return false;
  }
  return true;
}

/**
 * Cross-platform "who is listening on this port" lookup, used only for a
 * human-readable error message — never to decide *whether* to kill
 * anything (this project never automatically kills a foreign process; see
 * scripts/dev.mjs and scripts/dev-lifecycle.mjs's own doc comments).
 */
export function describePortOwner(port) {
  try {
    if (IS_WINDOWS) {
      const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
      if (netstat.status !== 0) return null;
      const line = netstat.stdout
        .split(/\r?\n/)
        .find(l => l.includes(`:${port} `) && l.toUpperCase().includes('LISTENING'));
      if (!line) return null;
      const pid = line.trim().split(/\s+/).pop();
      const command = getProcessCommand(pid);
      return { pid: Number(pid), command: command || '(unknown command)' };
    }
    const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (lsof.status !== 0 || !lsof.stdout) return null;
    const dataLine = lsof.stdout.split('\n').find((l, i) => i > 0 && l.trim().length > 0);
    if (!dataLine) return null;
    const columns = dataLine.trim().split(/\s+/);
    const [command, pid] = columns;
    return { pid: Number(pid), command };
  } catch {
    return null;
  }
}

/**
 * Checks every canonical Verdura app port up front, before anything is
 * spawned. Returns the list of ports that are NOT free — an empty array
 * means it is safe to start every service. See scripts/dev.mjs's use of
 * this: it runs before Docker/Postgres/migrations, and again immediately
 * before spawning the app services, precisely so a foreign or leftover
 * occupant is caught before any partial stack can come up.
 */
export async function findOccupiedCanonicalPorts() {
  const occupied = [];
  for (const [name, port] of Object.entries(CANONICAL_PORTS)) {
    const free = await isPortFree(port);
    if (!free) occupied.push({ name, port, owner: describePortOwner(port) });
  }
  return occupied;
}

export function formatRunningStack(state) {
  const lines = [
    'Verdura dev environment is already running.',
    '',
    `Supervisor PID: ${state.pid}`,
    `Workspace: ${state.root}`,
    `Started: ${state.startedAt}`,
    '',
    'Services:',
  ];
  const labelWidth = Math.max(...Object.keys(CANONICAL_PORTS).map(k => k.length));
  for (const [name, port] of Object.entries(CANONICAL_PORTS)) {
    lines.push(`  ${name.padEnd(labelWidth)}  http://localhost:${port}`);
  }
  lines.push('', 'Run `npm run dev:stop` before starting another stack.');
  return lines.join('\n');
}

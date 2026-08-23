// Automated coverage for scripts/dev-lock.mjs and scripts/dev-lifecycle.mjs
// — the ownership/duplicate-startup logic behind the P0 "npm run dev port
// collisions" fix. Run with `npm run test:dev-scripts` (node's built-in
// test runner, zero new dependencies).
//
// Every test here uses a private temp file (VERDURA_DEV_STATE_PATH) and/or
// throwaway spawned processes/ports — nothing in this suite ever reads,
// writes, or signals the real machine-wide state file or a real dev
// stack's real ports, so it is safe to run even while a genuine `npm run
// dev` is active elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import {
  clearState,
  describePortOwner,
  formatRunningStack,
  isPortFree,
  isProcessAlive,
  readState,
  verifySupervisor,
  writeState,
} from './dev-lock.mjs';

function tempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'verdura-dev-lock-test-'));
  return join(dir, 'state.json');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(25);
  }
  return false;
}

// Spawns a real, long-lived child process. `withMarker` controls whether
// its command line contains the exact "scripts/dev.mjs" substring
// verifySupervisor requires — this is how the tests get a real PID that
// either does or does not "look like" the Verdura supervisor, without
// actually running scripts/dev.mjs itself.
function spawnFakeProcess(withMarker) {
  const args = ['-e', 'setInterval(() => {}, 1000);'];
  if (withMarker) args.push('scripts/dev.mjs');
  return spawn(process.execPath, args, { stdio: 'ignore' });
}

// ── isProcessAlive ─────────────────────────────────────────────────────

test('isProcessAlive: true for this process', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive: false once a process has actually exited', async () => {
  const child = spawnFakeProcess(false);
  await waitUntil(() => isProcessAlive(child.pid));
  child.kill('SIGKILL');
  await waitUntil(() => !isProcessAlive(child.pid));
  assert.equal(isProcessAlive(child.pid), false);
});

// ── verifySupervisor: never trusts a bare pid ────────────────────────────

test('verifySupervisor: reason "dead" when the pid no longer exists', async () => {
  const child = spawnFakeProcess(true);
  await waitUntil(() => isProcessAlive(child.pid));
  const pid = child.pid;
  child.kill('SIGKILL');
  await waitUntil(() => !isProcessAlive(pid));
  const result = verifySupervisor({ pid });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'dead');
});

test('verifySupervisor: reason "reused" when the live pid is a real but unrelated process', async () => {
  const child = spawnFakeProcess(false); // deliberately no marker
  try {
    await waitUntil(() => isProcessAlive(child.pid));
    const result = verifySupervisor({ pid: child.pid });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'reused');
  } finally {
    child.kill('SIGKILL');
  }
});

test('verifySupervisor: verified true for a live process whose command line contains the supervisor marker', async () => {
  const child = spawnFakeProcess(true);
  try {
    await waitUntil(() => isProcessAlive(child.pid));
    const result = verifySupervisor({ pid: child.pid });
    assert.equal(result.verified, true);
    assert.ok(result.command.includes('scripts/dev.mjs'));
  } finally {
    child.kill('SIGKILL');
  }
});

test('verifySupervisor: reason "dead" for a falsy/missing pid (no state at all)', () => {
  assert.deepEqual(verifySupervisor(null), { verified: false, reason: 'dead' });
  assert.deepEqual(verifySupervisor({}), { verified: false, reason: 'dead' });
});

// ── state file round-trip (private temp path only) ───────────────────────

test('state round-trip: write, read, clear against a private path', () => {
  const path = tempStatePath();
  try {
    assert.equal(readState(path), null);
    const state = { pid: 12345, root: '/tmp/example', startedAt: new Date().toISOString(), ports: {}, children: [] };
    writeState(state, path);
    assert.deepEqual(readState(path), state);
    clearState(path);
    assert.equal(readState(path), null);
  } finally {
    rmSync(path, { force: true });
  }
});

test('state read: a corrupt file is treated as no state, never throws', () => {
  const path = tempStatePath();
  try {
    spawnSync('sh', ['-c', `echo 'not json' > ${JSON.stringify(path)}`]);
    assert.equal(readState(path), null);
  } finally {
    rmSync(path, { force: true });
  }
});

test('clearState on an already-missing file is a safe no-op', () => {
  const path = tempStatePath();
  assert.doesNotThrow(() => clearState(path));
});

// ── worktree ownership is reported, not silently dropped ────────────────

test('formatRunningStack: reports the recorded worktree root distinctly for two different states', () => {
  const stateA = { pid: 1, root: '/Users/dev/verdura_MVP', startedAt: 't' };
  const stateB = { pid: 2, root: '/private/tmp/verdura-order-tablet-reconcile', startedAt: 't' };
  assert.ok(formatRunningStack(stateA).includes('/Users/dev/verdura_MVP'));
  assert.ok(formatRunningStack(stateB).includes('/private/tmp/verdura-order-tablet-reconcile'));
  assert.ok(formatRunningStack(stateA).includes('Run `npm run dev:stop`'));
});

// ── port occupancy detection (arbitrary ephemeral ports only — never a real canonical port) ──

test('isPortFree: false while a real listener holds the port, true after it closes', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal(await isPortFree(port), true);
});

test('describePortOwner: identifies this process as the owner of a port it is listening on', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const owner = describePortOwner(port);
    assert.ok(owner, 'expected an owner to be found');
    assert.equal(owner.pid, process.pid);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// ── dev-lifecycle.mjs, run as a real subprocess against a private state file ──

// Deliberately async (spawn + Promise), not spawnSync: when a test is
// itself the OS parent of a fake supervisor process this CLI just
// terminated, spawnSync would block this process's own event loop for the
// CLI's entire run, preventing it from reaping that now-zombie child —
// which would make the CLI's own liveness poll (running in a different
// process, unaffected by parent/zombie status) block for its full
// timeout waiting for a reap that could never happen until this call
// returned. Staying async lets both event loops proceed concurrently, so
// the reap (and therefore the CLI's own poll) resolves promptly.
function runLifecycle(action, statePath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(import.meta.dirname, 'dev-lifecycle.mjs'), action], {
      env: { ...process.env, VERDURA_DEV_STATE_PATH: statePath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('exit', status => resolve({ status, stdout, stderr }));
  });
}

test('dev:status — no state file at all reports "not running" without touching real ports', async () => {
  const path = tempStatePath();
  try {
    const result = await runLifecycle('status', path);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No Verdura dev stack is recorded as running/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('dev:status — stale state (pid dead) is reported as stale, not as running', async () => {
  const path = tempStatePath();
  const child = spawnFakeProcess(true);
  await waitUntil(() => isProcessAlive(child.pid));
  const pid = child.pid;
  child.kill('SIGKILL');
  await waitUntil(() => !isProcessAlive(pid));
  writeState({ pid, root: '/tmp/example', startedAt: new Date().toISOString(), children: [] }, path);
  try {
    const result = await runLifecycle('status', path);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /stale/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('dev:stop — a stale state file is cleared, and nothing alive is signaled', async () => {
  const path = tempStatePath();
  const child = spawnFakeProcess(true);
  await waitUntil(() => isProcessAlive(child.pid));
  const pid = child.pid;
  child.kill('SIGKILL');
  await waitUntil(() => !isProcessAlive(pid));
  writeState({ pid, root: '/tmp/example', startedAt: new Date().toISOString(), children: [] }, path);
  const result = await runLifecycle('stop', path);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /stale/);
  assert.equal(readState(path), null, 'stale state file should be removed');
});

test('dev:stop — a real verified supervisor is gracefully terminated and the state file is cleared', async () => {
  const path = tempStatePath();
  const child = spawnFakeProcess(true);
  try {
    await waitUntil(() => isProcessAlive(child.pid));
    writeState(
      { pid: child.pid, root: '/tmp/example', startedAt: new Date().toISOString(), children: [] },
      path,
    );

    const result = await runLifecycle('stop', path);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Stopping Verdura dev stack/);
    assert.match(result.stdout, /Done\./);
    // Staying async in runLifecycle (see its own comment) lets this
    // process's event loop reap `child` promptly instead of leaving it a
    // zombie for the duration of the CLI's own run — poll briefly anyway
    // rather than asserting the instant the CLI process exits.
    const reallyDied = await waitUntil(() => !isProcessAlive(child.pid));
    assert.equal(reallyDied, true, 'the verified supervisor process should have been terminated');
    assert.equal(readState(path), null, 'state file should be cleared after stop');
  } finally {
    if (isProcessAlive(child.pid)) child.kill('SIGKILL');
  }
});

test('dev:status — a real verified supervisor is reported as running with its recorded workspace', async () => {
  const path = tempStatePath();
  const child = spawnFakeProcess(true);
  try {
    await waitUntil(() => isProcessAlive(child.pid));
    writeState(
      { pid: child.pid, root: '/private/tmp/verdura-order-tablet-reconcile', startedAt: new Date().toISOString(), children: [] },
      path,
    );

    const result = await runLifecycle('status', path);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /is running/);
    assert.match(result.stdout, /\/private\/tmp\/verdura-order-tablet-reconcile/);
  } finally {
    child.kill('SIGKILL');
  }
});

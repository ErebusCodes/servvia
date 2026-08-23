// `npm run dev:status` / `npm run dev:stop` — safe, ownership-verified
// lifecycle commands for the stack scripts/dev.mjs starts.
//
// Neither command ever kills a process it has not first verified is really
// part of Verdura's own dev supervisor (see dev-lock.mjs's
// verifySupervisor/SUPERVISOR_MARKER) — this file must never `killall
// node`, `pkill vite`, or signal a port's occupant without that check.
//
// Usable directly: `node scripts/dev-lifecycle.mjs status|stop`.

import { spawnSync } from 'node:child_process';
import {
  CANONICAL_PORTS,
  clearState,
  describePortOwner,
  isPortFree,
  isProcessAlive,
  readState,
  verifySupervisor,
} from './dev-lock.mjs';

const IS_WINDOWS = process.platform === 'win32';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function status() {
  const state = readState();
  if (!state) {
    console.log('[dev:status] No Verdura dev stack is recorded as running (no state file).');
    await reportRawPortState();
    return;
  }

  const verification = verifySupervisor(state);
  if (!verification.verified) {
    console.log(
      `[dev:status] A state file exists (pid ${state.pid}, recorded ${state.startedAt}, workspace ${state.root}) ` +
        `but it is stale (${verification.reason === 'unknown' ? 'could not verify the process' : verification.reason === 'reused' ? 'that pid now belongs to a different process' : 'that pid is no longer running'}).`,
    );
    await reportRawPortState();
    return;
  }

  console.log('[dev:status] Verdura dev stack is running.');
  console.log(`  Supervisor PID : ${state.pid}`);
  console.log(`  Workspace      : ${state.root}`);
  console.log(`  Started        : ${state.startedAt}`);
  console.log('  Services:');
  for (const [name, port] of Object.entries(CANONICAL_PORTS)) {
    const free = await isPortFree(port);
    const recordedChild = (state.children || []).find(c => c.name === name);
    const childAlive = recordedChild ? isProcessAlive(recordedChild.pid) : false;
    const health = !free && childAlive ? 'up' : !free ? 'up (unrecognized pid)' : 'DOWN — port is free but service should be running';
    console.log(`    ${name.padEnd(16)} http://localhost:${port}  [${health}]`);
  }
}

async function reportRawPortState() {
  const occupied = [];
  for (const [name, port] of Object.entries(CANONICAL_PORTS)) {
    const free = await isPortFree(port);
    if (!free) occupied.push({ name, port, owner: describePortOwner(port) });
  }
  if (occupied.length === 0) {
    console.log('[dev:status] All canonical Verdura ports are free.');
    return;
  }
  console.log('[dev:status] Some canonical ports are occupied by processes not recorded as this stack:');
  for (const { name, port, owner } of occupied) {
    console.log(`  ${port} (${name}) — ${owner ? `PID ${owner.pid} (${owner.command})` : 'unknown owner'}`);
  }
}

function killGroup(pid, signal) {
  try {
    if (IS_WINDOWS) spawnSync('taskkill', ['/pid', String(pid), '/t', '/f']);
    else process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

function killPid(pid, signal) {
  try {
    if (IS_WINDOWS) spawnSync('taskkill', ['/pid', String(pid), '/f']);
    else process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

async function stop() {
  const state = readState();
  if (!state) {
    console.log('[dev:stop] No Verdura dev stack is recorded as running — nothing to do.');
    return;
  }

  const verification = verifySupervisor(state);
  if (!verification.verified) {
    console.log(
      `[dev:stop] The recorded state (pid ${state.pid}) is stale (${verification.reason}) — clearing it. ` +
        `Nothing was signaled.`,
    );
    clearState();
    return;
  }

  console.log(`[dev:stop] Stopping Verdura dev stack (supervisor pid ${state.pid}, workspace ${state.root})...`);
  // The supervisor itself already handles graceful shutdown of every child
  // process group on SIGTERM (see scripts/dev.mjs's own `stop()`) — this
  // command's job is only to deliver that signal to a *verified* pid, then
  // confirm it actually worked, never to reimplement child teardown itself.
  killPid(state.pid, 'SIGTERM');

  const deadline = Date.now() + 5000;
  while (isProcessAlive(state.pid) && Date.now() < deadline) {
    await delay(100);
  }

  if (isProcessAlive(state.pid)) {
    console.log('[dev:stop] Supervisor did not exit within 5s — sending SIGKILL.');
    killPid(state.pid, 'SIGKILL');
    await delay(200);
  }

  // Mop-up: only reached if the supervisor died (crash, SIGKILL) before it
  // could clean up its own children — each candidate is independently
  // re-verified alive before being touched, since a recorded pid could
  // have already exited on its own and been reused by something unrelated.
  for (const child of state.children || []) {
    if (isProcessAlive(child.pid)) {
      console.log(`[dev:stop] Cleaning up leftover ${child.name} process (pid ${child.pid}).`);
      killGroup(child.pid, 'SIGTERM');
    }
  }
  await delay(300);
  for (const child of state.children || []) {
    if (isProcessAlive(child.pid)) killGroup(child.pid, 'SIGKILL');
  }

  clearState();
  console.log('[dev:stop] Done.');
}

const action = process.argv[2];
if (action === 'status') {
  await status();
} else if (action === 'stop') {
  await stop();
} else {
  console.error('Usage: node scripts/dev-lifecycle.mjs <status|stop>');
  process.exit(1);
}

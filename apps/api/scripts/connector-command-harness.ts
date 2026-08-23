/**
 * Story 2-10: a minimal, cross-platform proof harness for the connector
 * command protocol's persist-before-ack requirement. This is NOT the
 * production Windows connector — it exists only to prove, against a real
 * running backend and real disposable local storage, that:
 *
 *   1. A claimed command is durably persisted locally (fsync'd append-only
 *      log) BEFORE CONNECTOR_ACCEPTED is reported to the backend.
 *   2. A truthful terminal result is durably persisted locally BEFORE it is
 *      reported to the backend.
 *   3. The whole flow is safely resumable after an unconditional process
 *      kill (SIGKILL — uncatchable, so nothing unflushed survives) at any
 *      point, without ever creating two independent "executions" of the
 *      same command.
 *
 * Deliberately dependency-free (only Node's `fs`/global `fetch`) and uses a
 * plain fsync'd NDJSON file as its durable store — not because this is
 * necessarily what the future .NET Windows connector will use, but to prove
 * the *protocol* imposes no Node-specific requirement: any language with a
 * durable local store (SQLite, LiteDB, a flat file) and an HTTP client can
 * implement this same claimed->accept->compute->persist->report sequence.
 *
 * The only command type this harness executes is `connector.self_test.v1`.
 * Its "processing" step is a pure local hash of a synthetic nonce — no
 * network call to anything but this backend, ever. A successful run here is
 * never evidence that Idealpos, EFTPOS, KDS or a printer were contacted.
 *
 * Env vars:
 *   HARNESS_BASE_URL        e.g. http://127.0.0.1:4001/api      (required)
 *   HARNESS_CREDENTIAL      installationId.secret               (required)
 *   HARNESS_STORE_PATH      path to the local NDJSON log file   (required)
 *   HARNESS_MAX_TICKS       number of poll cycles then exit (default: run once)
 *   HARNESS_SELF_KILL_AFTER 'local_persist' | 'accept_sent' | 'terminal_persist' (optional)
 */
import { createHash } from 'crypto';
import * as fs from 'fs';

type CrashPhase = 'local_persist' | 'accept_sent' | 'terminal_persist';

interface ClaimedLogEntry {
  type: 'claimed';
  commandId: string;
  payload: { echoNonce: string };
  ts: string;
}
interface TerminalLogEntry {
  type: 'terminal';
  commandId: string;
  resultType: string;
  resultPayload: { echoHash: string };
  ts: string;
}
type LogEntry = ClaimedLogEntry | TerminalLogEntry;

const baseUrl = requireEnv('HARNESS_BASE_URL');
const credential = requireEnv('HARNESS_CREDENTIAL');
const storePath = requireEnv('HARNESS_STORE_PATH');
const maxTicks = process.env.HARNESS_MAX_TICKS ? parseInt(process.env.HARNESS_MAX_TICKS, 10) : 1;
const selfKillAfter = process.env.HARNESS_SELF_KILL_AFTER as CrashPhase | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

/** Durable, fsync'd append. Nothing here is "durable" until fsyncSync returns. */
function appendDurable(entry: LogEntry): void {
  const line = JSON.stringify(entry) + '\n';
  const fd = fs.openSync(storePath, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readLog(): LogEntry[] {
  if (!fs.existsSync(storePath)) return [];
  const raw = fs.readFileSync(storePath, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogEntry);
}

function computeResult(payload: { echoNonce: string }): {
  resultType: string;
  resultPayload: { echoHash: string };
} {
  // Deterministic, side-effect-free, non-network "processing" — proves the
  // protocol without touching anything external. Same input always yields
  // the same output, which is what makes resume-after-crash safe: a
  // recomputed result on retry is always byte-identical to the original.
  const echoHash = createHash('sha256').update(payload.echoNonce).digest('hex');
  return { resultType: 'SIMULATED_ECHO', resultPayload: { echoHash } };
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function maybeSelfKill(phase: CrashPhase): void {
  if (selfKillAfter === phase) {
    // Uncatchable, immediate — nothing not already fsync'd survives this.
    // Deliberately synchronous with the phase it names, so the crash
    // window under test is exact, not racy.
    process.kill(process.pid, 'SIGKILL');
  }
}

/**
 * Resume pass: for any command with a `claimed` log entry but no matching
 * `terminal` log entry, drive it forward. Safe to call on every tick,
 * including when there is nothing to resume — every step it takes is
 * idempotent server-side (POST /accept, POST /report with a deterministic
 * idempotencyKey), so re-running it after a crash at ANY point never
 * produces two independent outcomes.
 */
async function resumeIncomplete(): Promise<void> {
  const log = readLog();
  const claimedIds = new Set(
    log.filter((e): e is ClaimedLogEntry => e.type === 'claimed').map((e) => e.commandId),
  );
  const terminalById = new Map(
    log.filter((e): e is TerminalLogEntry => e.type === 'terminal').map((e) => [e.commandId, e]),
  );

  for (const commandId of claimedIds) {
    const claimedEntry = log.find(
      (e): e is ClaimedLogEntry => e.type === 'claimed' && e.commandId === commandId,
    )!;
    let terminal = terminalById.get(commandId);

    // Whether or not the remote side already saw this accept, POST /accept
    // is idempotent for the owning installation — always safe to repeat.
    await apiPost(`/connector/commands/${commandId}/accept`, undefined);
    maybeSelfKill('accept_sent');

    if (!terminal) {
      const computed = computeResult(claimedEntry.payload);
      const entry: TerminalLogEntry = {
        type: 'terminal',
        commandId,
        resultType: computed.resultType,
        resultPayload: computed.resultPayload,
        ts: new Date().toISOString(),
      };
      appendDurable(entry);
      maybeSelfKill('terminal_persist');
      terminal = entry;
    }

    await apiPost(`/connector/commands/${commandId}/report`, {
      outcome: 'succeeded',
      resultType: terminal.resultType,
      resultPayload: terminal.resultPayload,
      // Deterministic per command — any retry of this exact command always
      // supplies the same idempotencyKey, so the backend recognizes a
      // resumed report as the same report, never a conflict.
      idempotencyKey: `report-${commandId}`,
    });
  }
}

async function tick(): Promise<void> {
  await resumeIncomplete();

  const { commands } = await apiPost<{
    commands: Array<{ id: string; payload: { echoNonce: string } }>;
  }>('/connector/commands/poll');

  for (const command of commands) {
    appendDurable({
      type: 'claimed',
      commandId: command.id,
      payload: command.payload,
      ts: new Date().toISOString(),
    });
    maybeSelfKill('local_persist');

    await apiPost(`/connector/commands/${command.id}/accept`);
    maybeSelfKill('accept_sent');

    const computed = computeResult(command.payload);
    appendDurable({
      type: 'terminal',
      commandId: command.id,
      resultType: computed.resultType,
      resultPayload: computed.resultPayload,
      ts: new Date().toISOString(),
    });
    maybeSelfKill('terminal_persist');

    await apiPost(`/connector/commands/${command.id}/report`, {
      outcome: 'succeeded',
      resultType: computed.resultType,
      resultPayload: computed.resultPayload,
      idempotencyKey: `report-${command.id}`,
    });
  }
}

async function main(): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await tick();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[connector-command-harness] fatal:', err);
    process.exit(1);
  });

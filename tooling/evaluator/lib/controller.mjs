import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluate } from './evaluate.mjs';
import { checkoutState, isAncestor, resolveCommit, showFile } from './git.mjs';
import { checkInputs, loadFrozenObjective, sha256 } from './objective.mjs';
import { buildFailurePacket } from './packet.mjs';
import { failureSignature } from './signature.mjs';
import { secretValues } from './redact.mjs';

/**
 * The bounded correction controller (Phase 2). For one frozen objective
 * version it accepts at most an initial candidate and maxCorrections
 * corrections, each a new commit descending from the previous candidate,
 * and evaluates every one independently. It never corrects anything itself:
 * on FAIL it issues a failure packet and the implementer produces the next
 * candidate; everything else stops.
 *
 *   PASS                 -> CANDIDATE_READY_FOR_ACCEPTANCE (the orchestrator accepts)
 *   FAIL                 -> CORRECT (with a packet), unless the same failure
 *                           signature was seen before (REPEATED_FAILURE_SIGNATURE)
 *                           or this was the last candidate (CORRECTION_LIMIT_REACHED)
 *   NEEDS_REVIEW, INTEGRITY_VIOLATION, HARNESS_ERROR -> STOP
 *
 * State is an append-only, hash-chained ledger outside the repository. One
 * advance at a time per objective: a second, concurrent one is refused
 * (LOOP_BUSY) rather than allowed to overwrite the first one's iteration.
 */
export const LEDGER_SCHEMA = 'servvia.iteration-ledger/v1';
export const DECISIONS = { READY: 'CANDIDATE_READY_FOR_ACCEPTANCE', CORRECT: 'CORRECT', STOP: 'STOP' };

function ledgerPath(stateRoot, objectiveId) {
  return join(stateRoot, objectiveId, 'ledger.json');
}

export function readLedger(stateRoot, objectiveId) {
  const path = ledgerPath(stateRoot, objectiveId);
  if (!existsSync(path)) return { schema: LEDGER_SCHEMA, objectiveId, versions: [], lessonCandidates: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A hash over the whole ledger (every version, status and iteration), sealed on each write. */
export function sealOf(ledger) {
  const { integrity, ...content } = ledger;
  void integrity;
  return sha256(Buffer.from(JSON.stringify(content)));
}

function writeLedger(stateRoot, ledger, expectedIntegrity) {
  const path = ledgerPath(stateRoot, ledger.objectiveId);
  // Optimistic check under the lock: the ledger on disk is still the one this advance read.
  const onDisk = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).integrity : undefined;
  if (onDisk !== expectedIntegrity) throw new LoopBusy('the ledger changed while this candidate was evaluated');
  ledger.integrity = sealOf(ledger);
  mkdirSync(join(stateRoot, ledger.objectiveId), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** Each entry carries the hash of the one before it: a rewritten history no longer chains. */
function chainHash(entry) {
  return sha256(Buffer.from(JSON.stringify(entry)));
}

export function verifyChain(ledger) {
  // A sealed ledger stays sealed: emptying its history does not unseal it.
  const sealed = ledger.versions.length > 0 || ledger.integrity !== undefined;
  if (sealed && ledger.integrity !== sealOf(ledger)) return false;
  let prev = null;
  for (const v of ledger.versions) {
    for (const it of v.iterations) {
      if (it.prevHash !== prev) return false;
      prev = chainHash(it);
    }
  }
  return true;
}

function lastHash(ledger) {
  const all = ledger.versions.flatMap((v) => v.iterations);
  return all.length ? chainHash(all.at(-1)) : null;
}

class LoopBusy extends Error {}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** An exclusive per-objective lock; one left by a process that has exited is taken over. */
function acquireLock(stateRoot, objectiveId) {
  const dir = join(stateRoot, objectiveId);
  const path = join(dir, 'ledger.lock');
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try { holder = JSON.parse(readFileSync(path, 'utf8')).pid; } catch { /* unreadable: treated as held */ }
      if (attempt > 0 || !Number.isInteger(holder) || alive(holder)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

function stop(reason, extra = {}) {
  return { decision: DECISIONS.STOP, reason, ...extra };
}

/** Why a ledger cannot be trusted for this objective, or null. */
function ledgerProblem(ledger, objective) {
  if (!verifyChain(ledger)) return 'LEDGER_TAMPERED: the ledger\'s seal or hash chain does not verify';
  if (ledger.schema !== LEDGER_SCHEMA || ledger.objectiveId !== objective.objectiveId) {
    return `LEDGER_MISMATCH: the ledger belongs to ${ledger.objectiveId ?? '(unknown)'}, not ${objective.objectiveId}`;
  }
  return null;
}

/**
 * The objective gate a run passes before it may implement. Read-only. The
 * ledger decides which run this is:
 *
 *   initial (C1)       no candidate evaluated for this version: HEAD is
 *                      exactly the anchor, and no failure packet is given.
 *   correction (C2/C3) the last candidate FAILED and the controller decided
 *                      CORRECT: HEAD is exactly that recorded failed candidate
 *                      (never the anchor, a sibling or another descendant),
 *                      it descends from the anchor and still holds the frozen
 *                      objective and the approved inputs, and the failure
 *                      packet given is byte for byte the one the controller
 *                      issued for it.
 *
 * Any STOP (NEEDS_REVIEW, INTEGRITY_VIOLATION, HARNESS_ERROR, a repeated
 * signature, the correction limit), a passed loop, a tampered or foreign
 * ledger, a superseded or conflicting objective, or an unclean checkout
 * closes it. opts: { repo, anchorCommit, loaded, stateRoot, maxIterations, checkout, failurePacket }
 */
export function gate(opts) {
  const { repo, anchorCommit, loaded, stateRoot, maxIterations } = opts;
  const objective = loaded.objective;
  const closed = (reason) => ({ gate: 'CLOSED', reason });
  const ledger = readLedger(stateRoot, objective.objectiveId);
  const untrusted = ledgerProblem(ledger, objective);
  if (untrusted) return closed(untrusted);
  const newest = Math.max(0, ...ledger.versions.map((v) => v.version));
  const entry = ledger.versions.find((v) => v.version === objective.version);
  if (objective.version < newest) return closed(`objective version ${newest} supersedes ${objective.version}`);
  if (entry && (entry.anchorCommit !== anchorCommit || entry.objectiveSha256 !== loaded.digest)) return closed('a different anchor is already frozen for this version');
  if (entry && entry.status !== 'open') return closed(`loop is ${entry.status}: ${entry.stopReason ?? 'awaiting orchestrator acceptance'}`);

  const { head, clean } = opts.checkout;
  if (!clean) return closed('the checkout is not clean: a run starts from a clean checkout of its starting commit');
  const iterations = entry?.iterations ?? [];
  const base = { gate: 'OPEN', objectiveId: objective.objectiveId, version: objective.version, sha256: loaded.digest, iterationsSoFar: iterations.length };

  if (iterations.length === 0) {
    if (opts.failurePacket) return closed('no candidate of this objective version has been evaluated: an initial run takes no failure packet');
    if (head !== anchorCommit) return closed(`an initial candidate starts from the objective anchor: HEAD ${head} is not ${anchorCommit}`);
    return { ...base, run: 'initial', iteration: 1, startCommit: anchorCommit };
  }

  const failed = iterations.at(-1);
  if (failed.decision !== DECISIONS.CORRECT || failed.verdict !== 'FAIL') return closed(`the last candidate's decision is ${failed.decision}, not CORRECT`);
  if (iterations.length >= maxIterations) return closed('CORRECTION_LIMIT_REACHED: no correction remains for this objective version');
  if (head !== failed.candidate) return closed(`a correction starts from the failed candidate ${failed.candidate} the ledger records: HEAD ${head} is not that commit`);
  if (!isAncestor(repo, anchorCommit, failed.candidate)) return closed(`the failed candidate ${failed.candidate} does not descend from the anchor`);
  if (!opts.failurePacket) return closed(`a correction run names the failure packet issued for ${failed.candidate} (failure_packet: ${failed.packetPath})`);
  if (resolve(opts.failurePacket) !== resolve(failed.packetPath)) return closed(`the failure packet ${opts.failurePacket} is not the one issued for ${failed.candidate}`);
  const packetBytes = existsSync(failed.packetPath) ? readFileSync(failed.packetPath) : null;
  if (!packetBytes || sha256(packetBytes) !== failed.packetSha256) return closed('the failure packet differs from the one the controller issued');
  const packet = JSON.parse(packetBytes.toString('utf8'));
  if (packet.candidate !== failed.candidate || packet.objective?.id !== objective.objectiveId || packet.objective?.version !== objective.version || packet.objective?.sha256 !== loaded.digest) {
    return closed('the failure packet is for another candidate or objective');
  }
  const atHead = showFile(repo, head, opts.objectivePath);
  if (!atHead || sha256(atHead) !== loaded.digest) return closed('the failed candidate does not hold the frozen objective unchanged');
  const drift = checkInputs(objective, (path) => showFile(repo, head, path));
  if (drift.length) return closed(`the failed candidate does not hold the approved inputs: ${drift.join('; ')}`);
  return { ...base, run: 'correction', iteration: iterations.length + 1, startCommit: failed.candidate, correctsCandidate: failed.candidate, packetPath: failed.packetPath, packetSha256: failed.packetSha256 };
}

/**
 * Evaluate the next candidate of the loop for the objective frozen at
 * `anchor`. opts: { repo, anchor, candidate, stateRoot, evidenceRoot, tools, evaluatorRoot, worktree }
 *
 * With `worktree` (the run's checkout), the candidate must be its HEAD with
 * a clean tree before the evaluation starts and still after it ends: a
 * subagent still writing when the evaluator captures the candidate is
 * refused, whatever the platform reported about that subagent.
 */
export async function advance(opts) {
  const { repo, anchor, stateRoot } = opts;
  const anchorCommit = resolveCommit(repo, anchor.commit);
  const candidate = resolveCommit(repo, opts.candidate);
  const loaded = anchorCommit ? loadFrozenObjective(repo, { ...anchor, commit: anchorCommit }) : { error: 'unknown anchor commit' };
  if (!loaded.objective || !candidate) {
    // No trustworthy objective identity: the evaluator's own verdict decides, and nothing is recorded in a loop.
    const record = await evaluate({ ...opts, candidate: opts.candidate });
    return stop(record.verdict, { verdict: record.verdict, record });
  }
  const objective = loaded.objective;
  const policy = JSON.parse(showFile(repo, anchorCommit, 'tooling/evaluator/policy.json').toString('utf8'));
  const maxIterations = 1 + (policy.loop?.maxCorrections ?? 2);
  if (opts.worktree) {
    const before = checkoutState(opts.worktree);
    if (before.head !== candidate || !before.clean) {
      return stop('WORKTREE_NOT_QUIESCENT', { detail: `the run's checkout must be the candidate ${candidate} with a clean tree (HEAD ${before.head}, ${before.clean ? 'clean' : 'modified'}); nothing was recorded` });
    }
  }
  const release = acquireLock(stateRoot, objective.objectiveId);
  if (!release) return stop('LOOP_BUSY', { detail: `another evaluation of ${objective.objectiveId} is in progress; nothing was recorded` });
  try {
    return await advanceLocked({ ...opts, anchorCommit, candidate, loaded, policy, maxIterations });
  } catch (error) {
    if (error instanceof LoopBusy) return stop('LOOP_BUSY', { detail: `${error.message}; nothing was recorded` });
    throw error;
  } finally {
    release();
  }
}

async function advanceLocked(opts) {
  const { repo, anchor, stateRoot, anchorCommit, candidate, loaded, maxIterations } = opts;
  const objective = loaded.objective;
  const ledger = readLedger(stateRoot, objective.objectiveId);
  const untrusted = ledgerProblem(ledger, objective);
  if (untrusted) return stop(untrusted.split(':')[0], { detail: untrusted });
  const readIntegrity = ledger.integrity;

  // Objective versions: one loop per version; a newer version supersedes and restarts.
  let entry = ledger.versions.find((v) => v.version === objective.version);
  const newest = Math.max(0, ...ledger.versions.map((v) => v.version));
  if (entry && (entry.anchorCommit !== anchorCommit || entry.objectiveSha256 !== loaded.digest)) {
    return stop('OBJECTIVE_VERSION_CONFLICT', { detail: `version ${objective.version} is already frozen at ${entry.anchorCommit} (${entry.objectiveSha256})` });
  }
  if (!entry && objective.version < newest) return stop('OBJECTIVE_SUPERSEDED', { detail: `version ${newest} supersedes ${objective.version}` });
  if (entry && entry.version < newest) return stop('OBJECTIVE_SUPERSEDED', { detail: `version ${newest} supersedes ${entry.version}` });
  if (!entry) {
    for (const old of ledger.versions) {
      if (old.status === 'open') Object.assign(old, { status: 'superseded', stopReason: `superseded by version ${objective.version}` });
    }
    entry = { version: objective.version, anchorCommit, objectiveSha256: loaded.digest, baseline: objective.baseline, status: 'open', stopReason: null, iterations: [] };
    ledger.versions.push(entry);
  }
  if (entry.status !== 'open') return stop('LOOP_TERMINAL', { detail: `version ${entry.version} is ${entry.status} (${entry.stopReason ?? 'accepted for orchestrator review'})` });

  const n = entry.iterations.length + 1;
  const previous = entry.iterations.at(-1);
  const record_ = (fields) => {
    const it = { n, candidate, parentCandidate: previous?.candidate ?? null, at: new Date().toISOString(), ...fields, prevHash: lastHash(ledger) };
    entry.iterations.push(it);
    return it;
  };
  const halt = (reason, fields = {}) => {
    Object.assign(entry, { status: 'stopped', stopReason: reason });
    const it = record_({ decision: DECISIONS.STOP, reason, ...fields });
    writeLedger(stateRoot, ledger, readIntegrity);
    return stop(reason, { iteration: it, ledger: ledgerPath(stateRoot, objective.objectiveId), ledgerIntegrity: ledger.integrity });
  };

  if (n > maxIterations) return halt('CORRECTION_LIMIT_REACHED', { verdict: null });
  if (entry.iterations.some((it) => it.candidate === candidate)) return halt('CANDIDATE_HISTORY_VIOLATION', { verdict: null, detail: 'this candidate was already evaluated' });
  if (previous && !isAncestor(repo, previous.candidate, candidate)) {
    return halt('CANDIDATE_HISTORY_VIOLATION', { verdict: null, detail: `the candidate does not descend from the failed candidate ${previous.candidate} (amended or rewritten)` });
  }

  const record = await evaluate({ ...opts, anchor: { ...anchor, commit: anchorCommit }, candidate });
  const evidence = { recordSha256: record.evidence?.recordSha256 ?? null, evidenceDir: record.evidence?.dir ?? null };
  if (opts.worktree) {
    const after = checkoutState(opts.worktree);
    if (after.head !== candidate || !after.clean) {
      return { ...halt('CANDIDATE_CHANGED_DURING_EVALUATION', { verdict: record.verdict, ...evidence, detail: `the run's checkout changed while ${candidate} was evaluated (HEAD ${after.head}, ${after.clean ? 'clean' : 'modified'})` }), verdict: record.verdict, record };
    }
  }

  if (record.verdict === 'PASS') {
    Object.assign(entry, { status: 'passed', stopReason: null });
    const it = record_({ verdict: 'PASS', decision: DECISIONS.READY, ...evidence });
    writeLedger(stateRoot, ledger, readIntegrity);
    return { decision: DECISIONS.READY, verdict: 'PASS', iteration: it, record, ledger: ledgerPath(stateRoot, objective.objectiveId), ledgerIntegrity: ledger.integrity };
  }
  if (record.verdict !== 'FAIL') return { ...halt(record.verdict, { verdict: record.verdict, ...evidence }), verdict: record.verdict, record };

  const { signature, components } = failureSignature(record);
  const seenAt = entry.iterations.filter((it) => it.signature === signature).map((it) => it.n);
  if (seenAt.length > 0) {
    ledger.lessonCandidates.push({
      kind: 'LESSON CANDIDATE', status: 'unreviewed', objectiveVersion: entry.version, signature, components,
      iterations: [...seenAt, n], note: 'the same normalized failure recurred after a correction; evidence for later review only',
    });
    return { ...halt('REPEATED_FAILURE_SIGNATURE', { verdict: 'FAIL', signature, ...evidence }), verdict: 'FAIL', record };
  }
  if (n >= maxIterations) return { ...halt('CORRECTION_LIMIT_REACHED', { verdict: 'FAIL', signature, ...evidence }), verdict: 'FAIL', record };

  const envBase = JSON.parse(showFile(repo, anchorCommit, 'tooling/evaluator/env/evaluation.json').toString('utf8')).variables;
  const packet = buildFailurePacket({ record, objective, iteration: n, maxIterations, signature, secrets: secretValues(envBase) });
  const packetJson = `${JSON.stringify(packet, null, 2)}\n`;
  const packetPath = join(stateRoot, objective.objectiveId, `v${entry.version}`, `packet-${n}.json`);
  mkdirSync(join(stateRoot, objective.objectiveId, `v${entry.version}`), { recursive: true });
  writeFileSync(packetPath, packetJson);
  const it = record_({ verdict: 'FAIL', decision: DECISIONS.CORRECT, signature, packetSha256: sha256(Buffer.from(packetJson)), packetPath, ...evidence });
  writeLedger(stateRoot, ledger, readIntegrity);
  return { decision: DECISIONS.CORRECT, verdict: 'FAIL', iteration: it, packet, packetPath, record, ledger: ledgerPath(stateRoot, objective.objectiveId), ledgerIntegrity: ledger.integrity };
}

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deterministic cleanup of local evaluator evidence (provisional retention,
 * Phase 2): removes every evaluation directory whose record was written more
 * than `olderThanDays` before `now`. Ledgers are kept; an objective's ledger
 * and evidence are removed only by name (purgeObjective).
 */
export function pruneEvidence(root, { olderThanDays, now = new Date() }) {
  const cutoff = now.getTime() - olderThanDays * 86_400_000;
  const removed = [];
  if (!existsSync(root)) return removed;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      const record = join(path, 'record.json');
      if (existsSync(record)) {
        const at = Date.parse(JSON.parse(readFileSync(record, 'utf8')).evaluatedAt);
        if (Number.isFinite(at) && at < cutoff) {
          rmSync(path, { recursive: true, force: true });
          removed.push(path);
        }
      } else {
        walk(path);
      }
    }
  };
  walk(root);
  return removed;
}

export function purgeObjective({ stateRoot, evidenceRoot, objectiveId }) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(objectiveId)) throw new Error('invalid objective id');
  for (const root of [stateRoot, evidenceRoot]) rmSync(join(root, objectiveId), { recursive: true, force: true });
}

import { redact } from './redact.mjs';
import { errorClass } from './signature.mjs';

export const PACKET_SCHEMA = 'servvia.failure-packet/v1';

/**
 * What an implementer may and may not do with a FAIL. Fixed text: the packet
 * never carries success criteria of its own; those stay in the frozen
 * objective.
 */
export const CORRECTION_RULES = [
  'Correct the implementation so the frozen objective is met; the objective (its acceptance criteria, checks and expectations) is not changed.',
  'Change only the surfaces the objective allows; never a forbidden surface, the objective, the evaluator or a check configuration.',
  'Do not weaken, skip, focus, retire or delete a test, and do not add a lint or type suppression, to make a check pass.',
  'Commit the correction as a new commit descending from the failed candidate; do not amend or rewrite it.',
  'If meeting the objective needs any of the above, stop and report NEEDS_REVIEW instead of correcting.',
];

function relativize(text) {
  return String(text ?? '')
    .replace(/(?:[A-Za-z]:)?(?:\/[^\s/'"`()]+)+\/(?:candidate|baseline)\//g, '')
    .replace(/(?:\/private)?\/(?:tmp|var\/folders)\/[^\s'"`),:]+/g, '<path>');
}

/** The first repository source location an excerpt names, if any. */
export function locationOf(text) {
  const m = relativize(text).match(/\b((?:apps|services|packages|tooling|contracts|sample|windows-deploy)\/[\w./@-]+\.(?:ts|tsx|js|mjs|go)):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * The redacted, minimal input for a correction: which checks and tests
 * failed, how (excerpts, error class, a source location when one can be read
 * deterministically), the signature and the iteration. No raw logs, no
 * environment, no evaluator policy.
 */
export function buildFailurePacket({ record, objective, iteration, maxIterations, signature, secrets = [] }) {
  const failures = [];
  for (const e of record.excerpts ?? []) {
    const text = redact(relativize(e.text), secrets).slice(0, 1500);
    failures.push({
      check: e.source.replace(/^(check|setup):/, ''),
      kind: e.source.startsWith('setup:') ? 'setup' : 'check',
      test: e.test ? redact(relativize(e.test), secrets) : null,
      error: errorClass(e.text),
      location: locationOf(e.text),
      excerpt: text,
    });
  }
  for (const f of record.findings ?? []) {
    if (f.severity === 'FAIL' && f.code !== 'check-failed') {
      failures.push({ check: f.check ?? null, kind: f.code, test: null, error: null, location: null, excerpt: redact(relativize(f.detail), secrets).slice(0, 500) });
    }
  }
  return {
    schema: PACKET_SCHEMA,
    objective: {
      id: objective.objectiveId, storyId: objective.storyId, version: objective.version,
      sha256: record.objective.sha256, anchorCommit: record.objective.anchorCommit,
    },
    iteration,
    remainingCorrections: maxIterations - iteration,
    candidate: record.candidate,
    verdict: record.verdict,
    signature,
    failures,
    requiredTests: (objective.requiredTests ?? []).map((t) => ({ id: t.id, check: t.check, name: t.name })),
    surfaces: { allowed: objective.surfaces?.allowed ?? [], forbidden: objective.surfaces?.forbidden ?? [] },
    rules: CORRECTION_RULES,
  };
}

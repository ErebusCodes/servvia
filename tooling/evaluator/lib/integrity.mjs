import { matches } from './glob.mjs';
import { addedLines, changedPaths, showFile } from './git.mjs';

/**
 * Static integrity of a candidate against its frozen objective, from the two
 * commits alone (anchor and candidate), before anything runs.
 *
 * Severity:
 * - INTEGRITY_VIOLATION: the candidate changed what judges it, or removed or
 *   disabled tests: governance paths, the objective, a forbidden surface, a
 *   check's own configuration, a deleted test file, fewer tests in a file, a
 *   newly added skip or focus.
 * - NEEDS_REVIEW: a change that may be legitimate but was not authorized by
 *   the objective: an existing test, fixture, snapshot, manifest or build
 *   configuration modified, a new lint or type suppression, a change outside
 *   the allowed surfaces.
 */
export const IV = 'INTEGRITY_VIOLATION';
export const NR = 'NEEDS_REVIEW';

/** it(...) / test(...) declarations in JS/TS, func TestX( in Go. */
export function countTests(path, text) {
  if (text == null) return 0;
  if (path.endsWith('.go')) return (text.match(/^func Test\w*\s*\(/gm) ?? []).length;
  return (text.match(/(?<![\w.$])(?:it|test)\s*(?:\.each\s*\([^)]*\)\s*)?\(/g) ?? []).length;
}

/**
 * Names of the tests declared in a file: it('…')/test('…') string titles in
 * JS/TS, func TestX in Go. Dynamic titles are not extracted; the count check
 * below still covers them.
 */
export function testNames(path, text) {
  if (text == null) return [];
  if (path.endsWith('.go')) return [...text.matchAll(/^func (Test\w*)\s*\(/gm)].map((m) => m[1]);
  return [...text.matchAll(/(?<![\w.$])(?:it|test)\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
}

function authorized(objective, path) {
  return (objective.expectationChanges ?? []).some((x) => matches(path, [x.path]));
}

/** Tests the objective explicitly retires in this file (by name). */
function retired(objective, path) {
  return (objective.expectationChanges ?? [])
    .filter((x) => matches(path, [x.path]))
    .flatMap((x) => x.retiresTests ?? []);
}

export function checkConfigPaths(objective) {
  return [...new Set((objective.checks ?? []).flatMap((c) => c.configFiles ?? []))];
}

export function staticIntegrity({ repo, anchorCommit, candidateCommit, objective, objectivePath, policy }) {
  const findings = [];
  const add = (severity, code, path, detail) => findings.push({ severity, code, path, detail });
  const configFiles = checkConfigPaths(objective);
  const allowed = objective.surfaces?.allowed ?? [];
  const forbidden = objective.surfaces?.forbidden ?? [];
  const skipPatterns = policy.skipPatterns.map((p) => new RegExp(p));
  const suppressionPatterns = policy.suppressionPatterns.map((p) => new RegExp(p));

  for (const { status, path } of changedPaths(repo, anchorCommit, candidateCommit)) {
    const isTest = matches(path, policy.testFiles);
    const isSurface = isTest || matches(path, policy.expectationSurfaces);
    const ok = authorized(objective, path);

    if (path === objectivePath) {
      add(IV, 'objective-modified', path, 'the frozen objective was changed by the candidate');
      continue;
    }
    if (matches(path, policy.governance)) {
      add(IV, 'governance-modified', path, 'evaluation authority (evaluator, objectives, PRD, architecture, BMAD) was changed');
      continue;
    }
    if (matches(path, forbidden)) {
      add(IV, 'forbidden-surface', path, 'the objective forbids changes here');
      continue;
    }
    if (configFiles.includes(path) && !ok) {
      add(IV, 'check-definition-modified', path, 'configuration of an objective check was changed without authorization');
      continue;
    }

    if (status === 'D') {
      if (isTest && !ok) add(IV, 'test-file-deleted', path, 'an existing test file was deleted');
      else if (isSurface && !ok) add(NR, 'expectation-surface-deleted', path, 'a fixture, snapshot or configuration file was deleted');
      continue;
    }

    if (status === 'M' || status === 'T') {
      if (isTest) {
        // Authorizing changes to a file never authorizes removing its tests:
        // each removed test must be retired by name in the objective.
        const anchorText = showFile(repo, anchorCommit, path)?.toString('utf8');
        const candidateText = showFile(repo, candidateCommit, path)?.toString('utf8');
        const retiring = retired(objective, path);
        const kept = new Set(testNames(path, candidateText));
        const removed = testNames(path, anchorText).filter((name) => !kept.has(name) && !retiring.includes(name));
        const before = countTests(path, anchorText);
        const after = countTests(path, candidateText);
        if (removed.length > 0) {
          add(IV, 'tests-removed', path, `tests removed without being retired by the objective: ${removed.join(', ')}`);
        } else if (after < before - retiring.length) {
          add(IV, 'tests-removed', path, `test declarations fell from ${before} to ${after}`);
        } else if (!ok) {
          add(NR, 'unapproved-expectation-change', path, 'an existing test was modified without an approved expectation change');
        }
      } else if (isSurface && !ok) {
        add(NR, 'unapproved-surface-change', path, 'a fixture, snapshot, manifest or build/test configuration was modified without authorization');
      }
    }

    if (!isSurface && allowed.length > 0 && !matches(path, allowed)) {
      add(NR, 'outside-allowed-surfaces', path, 'changed outside the surfaces the objective allows');
    }

    // Added lines: skips and focus in tests, suppressions anywhere.
    const lines = addedLines(repo, anchorCommit, candidateCommit, path);
    if (isTest) {
      const skipAllowed = (objective.allowedSkips ?? []).some((s) => s.path && matches(path, [s.path]));
      const hit = lines.find((line) => skipPatterns.some((re) => re.test(line)));
      if (hit && !skipAllowed) add(IV, 'skip-or-focus-added', path, `added: ${hit.trim().slice(0, 160)}`);
    }
    for (const line of lines) {
      const re = suppressionPatterns.find((r) => r.test(line));
      if (!re) continue;
      const permitted = (objective.allowedSuppressions ?? []).some(
        (s) => matches(path, [s.path]) && (!s.pattern || line.includes(s.pattern)),
      );
      if (!permitted) add(NR, 'suppression-added', path, `added: ${line.trim().slice(0, 160)}`);
    }
  }
  return findings;
}

/**
 * The verdict, computed only from what the evaluator itself observed. There
 * is no input for the implementer's own account of its work.
 *
 * Precedence, strongest first: a candidate that tampered with its evaluation
 * is reported as such whatever else happened; an evaluation that could not be
 * carried out cannot pass; a failing required behaviour is a FAIL; anything
 * that might be acceptable but was not authorized needs review.
 */
export const VERDICTS = ['INTEGRITY_VIOLATION', 'HARNESS_ERROR', 'FAIL', 'NEEDS_REVIEW', 'PASS'];

const contains = (name, pattern) => name === pattern || name.includes(pattern);

export function evaluateCheck(check, run, objective) {
  const reasons = [];
  if (!run) return [{ severity: 'HARNESS_ERROR', code: 'check-not-run', check: check.id, detail: 'the check produced no result' }];
  if (run.harnessError) return [{ severity: 'HARNESS_ERROR', code: 'runner-error', check: check.id, detail: run.harnessError }];
  const mandatory = check.mandatory !== false;
  const floor = check.minTests ?? (check.runner === 'command' ? 0 : 1);
  const executed = run.counts.passed + run.counts.failed;

  // A check that did not build has no meaningful count: it fails below, and
  // removed or disabled tests are judged statically from the commits.
  if (mandatory && executed < floor && !run.buildFailed) {
    reasons.push({ severity: 'INTEGRITY_VIOLATION', code: 'too-few-tests', check: check.id, detail: `executed ${executed} tests, the objective requires at least ${floor}` });
  }
  const failed = run.counts.failed > 0 || (run.exitCode !== 0 && run.exitCode !== null) || run.timedOut;
  if (mandatory && failed) {
    if (run.flaky) {
      const approved = (check.flakePolicy?.approvedRetries ?? 0) >= 1;
      reasons.push(approved
        ? { severity: 'INFO', code: 'flake-within-approved-policy', check: check.id, detail: 'failed, then passed on an approved retry' }
        : { severity: 'NEEDS_REVIEW', code: 'flaky-check', check: check.id, detail: 'failed, then passed on retry; no approved flake policy, so a clean pass cannot be established' });
    } else {
      const names = run.tests.filter((t) => t.status === 'failed').map((t) => t.name).slice(0, 20);
      reasons.push({ severity: 'FAIL', code: 'check-failed', check: check.id, detail: names.length ? `failed: ${names.join('; ')}` : `exit code ${run.exitCode}` });
    }
  }
  const allowedSkips = (objective.allowedSkips ?? []).filter((s) => s.test && (!s.check || s.check === check.id));
  const unapproved = run.tests.filter((t) => t.status === 'skipped' && !allowedSkips.some((s) => contains(t.name, s.test)));
  if (mandatory && unapproved.length > 0) {
    reasons.push({ severity: 'NEEDS_REVIEW', code: 'unapproved-skip', check: check.id, detail: unapproved.slice(0, 20).map((t) => t.name).join('; ') });
  }
  return reasons;
}

/**
 * requiredTests: each must be found and pass on the candidate; where the
 * objective expects it, it must fail (or not run) on the baseline with the
 * candidate's test sources placed on it, proving it observes new behaviour.
 */
export function evaluateRequiredTests(objective, runs, baselineRuns) {
  const reasons = [];
  for (const rt of objective.requiredTests ?? []) {
    const run = runs[rt.check];
    if (!run || run.harnessError) continue; // already reported by evaluateCheck
    const found = run.tests.filter((t) => contains(t.name, rt.name));
    if (found.length === 0) {
      reasons.push({ severity: 'FAIL', code: 'required-test-missing', check: rt.check, detail: `${rt.id}: no test named "${rt.name}" ran` });
      continue;
    }
    if (!found.every((t) => t.status === 'passed')) {
      reasons.push({ severity: 'FAIL', code: 'required-test-failed', check: rt.check, detail: `${rt.id}: "${rt.name}" did not pass` });
    }
    if (rt.expectBaselineFailure) {
      const base = baselineRuns[rt.check];
      if (!base || base.harnessError) {
        reasons.push({ severity: 'HARNESS_ERROR', code: 'baseline-run-missing', check: rt.check, detail: `${rt.id}: the baseline run could not be made` });
        continue;
      }
      const onBaseline = base.tests.filter((t) => contains(t.name, rt.name));
      const passedOnBaseline = onBaseline.length > 0 && onBaseline.every((t) => t.status === 'passed');
      if (passedOnBaseline) {
        reasons.push({ severity: 'NEEDS_REVIEW', code: 'required-test-passes-on-baseline', check: rt.check, detail: `${rt.id}: expected to fail without the change, but passes on the baseline` });
      }
    }
  }
  return reasons;
}

export function computeVerdict(findings) {
  for (const verdict of VERDICTS.slice(0, 4)) {
    if (findings.some((f) => f.severity === verdict)) return verdict;
  }
  return 'PASS';
}

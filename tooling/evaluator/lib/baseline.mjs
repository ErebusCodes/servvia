/**
 * What happened to one required test on the baseline (the anchor with the
 * candidate's test sources placed on it). A required test declared
 * `expectBaselineFailure` must fail or not run there; this names which, from
 * the runner's own results, so the evidence never rests on aggregate counts:
 *
 *   FAILED                  it ran and failed (behavioral)
 *   SKIPPED                 it was reported, but skipped
 *   NOT_RUN_BUILD_FAILURE   its package, suite or file did not compile or load (build)
 *   NOT_RUN_PACKAGE_FAILURE its package failed before any of its tests reported (behavioral)
 *   NOT_RUN_TIMEOUT         the check timed out before it reported (harness)
 *   NOT_RUN_SETUP_FAILURE   a baseline setup step failed, so no check ran (setup)
 *   NOT_RUN_HARNESS_ERROR   the baseline check produced no usable result (harness)
 *   NOT_FOUND               the check ran and reported no test of that name, and nothing failed to build
 *   PASSED_UNEXPECTEDLY     it passed: it does not observe new behaviour
 *
 * Pure: the same runner results always give the same state.
 */
export const BASELINE_STATES = [
  'FAILED', 'SKIPPED', 'NOT_RUN_BUILD_FAILURE', 'NOT_RUN_PACKAGE_FAILURE', 'NOT_RUN_TIMEOUT',
  'NOT_RUN_SETUP_FAILURE', 'NOT_RUN_HARNESS_ERROR', 'NOT_FOUND', 'PASSED_UNEXPECTEDLY',
];

const contains = (name, pattern) => name === pattern || name.includes(pattern);

/** Whether a failed package, suite or file entry is where one of the required test's sources lives. */
function holds(entry, files) {
  return files.some((f) => {
    if (entry.file && (entry.file === f || entry.file.endsWith(`/${f}`))) return true;
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    return entry.dir != null && entry.dir === dir;
  });
}

/**
 * The baseline state of required test `rt` given its check's baseline run
 * (`run` may be undefined) and whether baseline setup failed. Returns
 * { state, failureClass, observed, related } where `observed` are the
 * baseline results named like the test and `related` the failed build or
 * package entries that explain a test that did not run.
 */
export function baselineState(rt, run, { setupFailed = false } = {}) {
  if (setupFailed) return { state: 'NOT_RUN_SETUP_FAILURE', failureClass: 'setup', observed: [], related: [] };
  if (!run || run.harnessError) return { state: 'NOT_RUN_HARNESS_ERROR', failureClass: 'harness', observed: [], related: [] };
  // Matched exactly as lib/verdict.mjs matches it, so PASSED_UNEXPECTEDLY is the verdict's "passes on the baseline".
  const observed = run.tests.filter((t) => contains(t.name, rt.name));
  if (observed.length > 0) {
    if (observed.every((t) => t.status === 'passed')) return { state: 'PASSED_UNEXPECTEDLY', failureClass: null, observed, related: [] };
    const failed = observed.filter((t) => t.status === 'failed');
    if (failed.some((t) => !t.kind)) return { state: 'FAILED', failureClass: 'behavioral', observed, related: [] };
    if (failed.some((t) => t.kind === 'build')) return { state: 'NOT_RUN_BUILD_FAILURE', failureClass: 'build', observed: [], related: failed };
    if (failed.length) return { state: 'NOT_RUN_PACKAGE_FAILURE', failureClass: 'behavioral', observed: [], related: failed };
    return { state: 'SKIPPED', failureClass: null, observed, related: [] };
  }
  const failedUnits = run.tests.filter((t) => t.status === 'failed' && (t.kind === 'build' || t.kind === 'package'));
  const own = failedUnits.filter((t) => holds(t, rt.files ?? []));
  // A whole-check build failure (no package could be listed) explains every test of the check.
  const related = own.length ? own : failedUnits.filter((t) => t.kind === 'build' && !t.file && !t.dir && run.buildFailed);
  if (related.some((t) => t.kind === 'build')) return { state: 'NOT_RUN_BUILD_FAILURE', failureClass: 'build', observed, related };
  if (related.length) return { state: 'NOT_RUN_PACKAGE_FAILURE', failureClass: 'behavioral', observed, related };
  if (run.timedOut) return { state: 'NOT_RUN_TIMEOUT', failureClass: 'harness', observed, related: [] };
  return { state: 'NOT_FOUND', failureClass: null, observed, related: [] };
}

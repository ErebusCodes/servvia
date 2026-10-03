import { createHash } from 'node:crypto';
import { showFile, parents } from './git.mjs';

export const OBJECTIVE_SCHEMA = 'servvia.objective/v1';
export const OBJECTIVE_DIR = '_bmad-output/implementation-artifacts/objectives';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The frozen objective is read from the anchor commit, never from the
 * candidate, and must hash to the value the orchestrator recorded when it
 * approved it (the out-of-band trust anchor).
 */
export function loadFrozenObjective(repo, anchor) {
  const bytes = showFile(repo, anchor.commit, anchor.objectivePath);
  if (!bytes) return { error: `objective ${anchor.objectivePath} does not exist at the anchor commit` };
  const digest = sha256(bytes);
  if (digest !== anchor.objectiveSha256) {
    return { error: `objective hash ${digest} does not match the approved anchor ${anchor.objectiveSha256}`, digest };
  }
  let objective;
  try {
    objective = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    return { invalid: [`objective is not valid JSON: ${err.message}`], digest };
  }
  const invalid = validateObjective(objective);
  return invalid.length ? { invalid, digest, objective } : { objective, digest, bytes };
}

/** The objective must be frozen on the commit it was planned against. */
export function checkBaseline(repo, anchorCommit, objective) {
  const firstParent = parents(repo, anchorCommit)[0];
  return firstParent === objective.baseline
    ? null
    : `objective baseline ${objective.baseline} is not the anchor commit's parent ${firstParent ?? '(none)'}`;
}

const SHA = /^[0-9a-f]{40}$/;
const RUNNERS = ['jest', 'go-test', 'node-test', 'command'];
const CATEGORIES = ['unit', 'integration', 'architecture', 'contract', 'parity', 'race', 'lint', 'typecheck', 'build', 'migration', 'other'];
const BASELINE_EXCEPTIONS = ['regression-characterization', 'architecture-completeness', 'refactoring-invariant', 'coverage'];

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

export function validateObjective(o) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  need(o && typeof o === 'object', 'objective must be an object');
  if (!o || typeof o !== 'object') return e;
  need(o.schema === OBJECTIVE_SCHEMA, `schema must be ${OBJECTIVE_SCHEMA}`);
  need(/^[a-z0-9][a-z0-9.-]*$/.test(o.objectiveId ?? ''), 'objectiveId must be kebab-case');
  need(isStr(o.storyId), 'storyId is required');
  need(Number.isInteger(o.version) && o.version >= 1, 'version must be an integer >= 1');
  need(isStr(o.title), 'title is required');
  need(SHA.test(o.baseline ?? ''), 'baseline must be a full commit id');
  need(isStrArray(o.requirementRefs) && o.requirementRefs.length > 0, 'requirementRefs must list at least one reference');
  need(isStrArray(o.architectureConstraints ?? []), 'architectureConstraints must be strings');
  need(Array.isArray(o.acceptanceCriteria) && o.acceptanceCriteria.length > 0, 'acceptanceCriteria must not be empty');
  for (const ac of o.acceptanceCriteria ?? []) {
    need(isStr(ac.id) && isStr(ac.given) && isStr(ac.when) && isStr(ac.then), `acceptance criterion ${ac.id ?? '?'} needs id, given, when and then`);
  }
  need(o.approval && isStr(o.approval.approvedBy) && isStr(o.approval.reference), 'approval.approvedBy and approval.reference are required');
  need(isStrArray(o.completionCriteria) && o.completionCriteria.length > 0, 'completionCriteria must not be empty');
  const services = o.environment?.services ?? [];
  need(Array.isArray(services) && services.every((s) => ['postgres', 'redis'].includes(s)), 'environment.services may list postgres and redis only');
  for (const step of o.setup ?? []) {
    need(isStr(step.id) && isStrArray(step.run) && step.run.length > 0, `setup step ${step.id ?? '?'} needs id and run`);
  }
  const checkIds = new Set();
  need(Array.isArray(o.checks) && o.checks.length > 0, 'checks must not be empty');
  for (const c of o.checks ?? []) {
    need(isStr(c.id) && !checkIds.has(c.id), `check id ${c.id ?? '?'} must be present and unique`);
    checkIds.add(c.id);
    need(RUNNERS.includes(c.runner), `check ${c.id}: runner must be one of ${RUNNERS.join(', ')}`);
    need(CATEGORIES.includes(c.category), `check ${c.id}: category must be one of ${CATEGORIES.join(', ')}`);
    need(isStrArray(c.args), `check ${c.id}: args must be strings`);
    need(isStrArray(c.configFiles ?? []), `check ${c.id}: configFiles must be paths`);
    if (c.flakePolicy !== undefined) need(Number.isInteger(c.flakePolicy.approvedRetries) && c.flakePolicy.approvedRetries >= 0, `check ${c.id}: flakePolicy.approvedRetries must be an integer`);
  }
  for (const t of o.requiredTests ?? []) {
    need(isStr(t.id) && checkIds.has(t.check), `required test ${t.id ?? '?'} must name a check`);
    need(isStr(t.name), `required test ${t.id}: name is required`);
    need(typeof t.expectBaselineFailure === 'boolean', `required test ${t.id}: expectBaselineFailure must be true or false`);
    if (t.expectBaselineFailure === false) {
      need(BASELINE_EXCEPTIONS.includes(t.baselineException), `required test ${t.id}: a test not expected to fail on the baseline must name its baselineException (${BASELINE_EXCEPTIONS.join(', ')})`);
    }
    if (t.expectBaselineFailure) need(isStrArray(t.files) && t.files.length > 0, `required test ${t.id}: files (the test sources to place on the baseline) are required`);
  }
  need(isStrArray(o.surfaces?.allowed ?? []) && isStrArray(o.surfaces?.forbidden ?? []), 'surfaces.allowed and surfaces.forbidden must be globs');
  for (const x of o.expectationChanges ?? []) need(isStr(x.path) && isStr(x.reason), 'expectation change needs path and reason');
  for (const x of o.allowedSkips ?? []) need(isStr(x.reason) && (isStr(x.test) || isStr(x.path)), 'allowed skip needs reason and test or path');
  for (const x of o.allowedSuppressions ?? []) need(isStr(x.path) && isStr(x.reason), 'allowed suppression needs path and reason');
  return e;
}

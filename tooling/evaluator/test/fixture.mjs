// Test fixture (not a test file): a throwaway git repository holding a copy
// of the evaluator, a tiny project, a frozen objective and candidates.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { EVALUATOR_ROOT, evaluate } from '../lib/evaluate.mjs';
import { advance } from '../lib/controller.mjs';

export const OBJECTIVE_PATH = '_bmad-output/implementation-artifacts/objectives/demo/v1.objective.json';

const ADD_TESTS = `import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from './math.mjs';
test('adds numbers', () => assert.equal(add(2, 3), 5));
test('adds negatives', () => assert.equal(add(-2, -3), -5));
`;

export const MULTIPLY_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { multiply } from './math.mjs';
test('multiplies numbers', () => assert.equal(multiply(2, 3), 6));
`;

export const MULTIPLY_IMPL = `export const add = (a, b) => a + b;
export const multiply = (a, b) => a * b;
`;

export function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

export function write(repo, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(repo, path);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
}

export function commit(repo, files, message) {
  write(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

export function objectiveFor(baseline, overrides = {}) {
  return {
    schema: 'servvia.objective/v1',
    objectiveId: 'demo-multiply',
    storyId: 'DEMO-1',
    version: 1,
    title: 'Multiply two numbers',
    baseline,
    requirementRefs: ['DEMO-REQ-1'],
    architectureConstraints: ['sample/math.mjs stays dependency-free'],
    acceptanceCriteria: [{ id: 'AC-1', given: 'two numbers', when: 'multiply is called', then: 'it returns their product' }],
    approval: { approvedBy: 'test-orchestrator', reference: 'fixture' },
    completionCriteria: ['every mandatory check passes'],
    environment: { services: [] },
    checks: [{ id: 'unit', category: 'unit', runner: 'node-test', args: ['sample/math.test.mjs', 'sample/multiply.test.mjs'], minTests: 3, configFiles: ['sample/check.config.json'] }],
    requiredTests: [{ id: 'RT-1', check: 'unit', name: 'multiplies numbers', files: ['sample/multiply.test.mjs'], expectBaselineFailure: true }],
    surfaces: { allowed: ['sample/**'], forbidden: ['restricted/**'] },
    expectationChanges: [],
    allowedSkips: [],
    allowedSuppressions: [],
    ...overrides,
  };
}

/**
 * A repository at baseline B (evaluator + project), with the objective frozen
 * at anchor A (child of B). Returns helpers to build candidates on A.
 */
export function makeFixture(objectiveOverrides = {}, { baselineFiles = {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'servvia-eval-fixture-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fixture@invalid');
  git(repo, 'config', 'user.name', 'fixture');
  git(repo, 'config', 'commit.gpgsign', 'false');
  cpSync(EVALUATOR_ROOT, join(repo, 'tooling/evaluator'), { recursive: true });
  const baseline = commit(repo, {
    'sample/math.mjs': 'export const add = (a, b) => a + b;\n',
    'sample/math.test.mjs': ADD_TESTS,
    'sample/check.config.json': '{ "note": "configuration an objective check depends on" }\n',
    ...baselineFiles,
  }, 'baseline');
  const objective = objectiveFor(baseline, objectiveOverrides);
  const bytes = `${JSON.stringify(objective, null, 2)}\n`;
  const anchorCommit = commit(repo, { [OBJECTIVE_PATH]: bytes }, 'freeze objective');
  const anchor = { commit: anchorCommit, objectivePath: OBJECTIVE_PATH, objectiveSha256: createHash('sha256').update(bytes).digest('hex') };
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'servvia-eval-evidence-'));
  const stateRoot = mkdtempSync(join(tmpdir(), 'servvia-eval-state-'));
  return {
    repo, baseline, anchor, evidenceRoot, stateRoot,
    /** Freezes another objective (e.g. version 2) in a new anchor on `parent`. */
    freeze(objectiveOverrides, parent, path = OBJECTIVE_PATH.replace('v1', `v${objectiveOverrides.version ?? 1}`)) {
      git(repo, 'checkout', '-q', '--detach', parent);
      const o = objectiveFor(parent, objectiveOverrides);
      const text = `${JSON.stringify(o, null, 2)}\n`;
      const commitId = commit(repo, { [path]: text }, `freeze ${path}`);
      return { commit: commitId, objectivePath: path, objectiveSha256: createHash('sha256').update(text).digest('hex') };
    },
    /** The bounded correction controller on this repository. */
    advance(candidate, extra = {}) {
      return advance({ repo, anchor: extra.anchor ?? anchor, candidate, evidenceRoot, stateRoot, ...extra });
    },
    /** A candidate branch from the anchor with the given changes. */
    candidate(files, from = anchorCommit) {
      git(repo, 'checkout', '-q', '--detach', from);
      return commit(repo, files, 'candidate');
    },
    run(candidate, extra = {}) {
      return evaluate({ repo, anchor: extra.anchor ?? anchor, candidate, evidenceRoot, ...extra });
    },
    cleanup() {
      rmSync(repo, { recursive: true, force: true });
      rmSync(evidenceRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    },
  };
}

/** The valid implementation of the fixture objective. */
export const VALID = { 'sample/math.mjs': MULTIPLY_IMPL, 'sample/multiply.test.mjs': MULTIPLY_TEST };

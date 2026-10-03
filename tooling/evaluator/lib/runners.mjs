import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runs one objective check and reduces it to a common result:
 *   { exitCode, timedOut, harnessError, tests: [{ name, status }], counts, stdout, stderr }
 * status is 'passed' | 'failed' | 'skipped'. The evaluator adds the
 * machine-readable reporter flags itself; a check never chooses its reporter.
 */
export function runProcess(argv, { cwd, env, timeoutSeconds = 900 }) {
  const res = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: timeoutSeconds * 1000,
  });
  return {
    exitCode: res.status,
    signal: res.signal,
    timedOut: res.error?.code === 'ETIMEDOUT',
    spawnError: res.error && res.error.code !== 'ETIMEDOUT' ? res.error.message : null,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function counts(tests) {
  const c = { total: tests.length, passed: 0, failed: 0, skipped: 0 };
  for (const t of tests) c[t.status] += 1;
  return c;
}

function jest(check, ctx) {
  const out = join(ctx.scratch, `${check.id}-${ctx.attempt}.jest.json`);
  const argv = [ctx.node, ...check.args, '--ci', '--json', `--outputFile=${out}`];
  const proc = runProcess(argv, { cwd: ctx.cwd, env: ctx.env, timeoutSeconds: check.timeoutSeconds });
  if (!existsSync(out)) {
    return { ...proc, harnessError: proc.spawnError ?? 'jest wrote no result file', tests: [] };
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const tests = [];
  for (const file of report.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped';
      tests.push({ name: a.fullName ?? a.title, status, file: file.name, message: (a.failureMessages ?? []).join('\n') });
    }
    // A suite that could not run (compile error, setup failure) is a failure.
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
      tests.push({ name: `${file.name} (suite failed to run)`, status: 'failed', file: file.name, message: file.message ?? '' });
    }
  }
  return { ...proc, tests };
}

/** The module path in go.mod, to turn a package import path into a repository directory. */
function goModule(cwd) {
  const mod = join(cwd, 'go.mod');
  if (!existsSync(mod)) return null;
  return readFileSync(mod, 'utf8').match(/^module\s+(\S+)/m)?.[1] ?? null;
}

/**
 * A failed Go test's own output, without go test's framing lines, with its
 * `file_test.go:N:` references qualified by the package's directory in the
 * repository (when the module path tells us), so a location can be read.
 */
function goFailureMessage(lines, pkg, module, cwdInRepo) {
  const dir = module && pkg.startsWith(module) && cwdInRepo != null
    ? [cwdInRepo, pkg.slice(module.length).replace(/^\//, '')].filter(Boolean).join('/')
    : null;
  return lines
    .filter((l) => !/^\s*(?:=== (?:RUN|PAUSE|CONT|NAME)|--- (?:FAIL|PASS|SKIP)|PASS$|FAIL$)/.test(l))
    .map((l) => (dir ? l.replace(/(^|\s)([\w.-]+\.go:\d+:)/g, `$1${dir}/$2`) : l))
    .join('')
    .slice(0, 4000);
}

/** Parses `go test -json` output into the common test results. Pure, for testing. */
export function parseGoTestJson(stdout, { module = null, cwdInRepo = null } = {}) {
  const final = new Map();
  const output = new Map();
  const failedPackages = new Set();
  let parsed = 0;
  for (const line of String(stdout).split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    parsed += 1;
    if (ev.Action === 'output' && ev.Test) {
      const key = `${ev.Package} ${ev.Test}`;
      if (!output.has(key)) output.set(key, []);
      output.get(key).push(ev.Output ?? '');
      continue;
    }
    if (!['pass', 'fail', 'skip'].includes(ev.Action)) continue;
    if (ev.Test) final.set(`${ev.Package} ${ev.Test}`, ev.Action);
    else if (ev.Action === 'fail') failedPackages.add(ev.Package);
  }
  const tests = [...final].map(([name, action]) => ({
    name,
    status: action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'skipped',
    message: action === 'fail' ? goFailureMessage(output.get(name) ?? [], name.split(' ')[0], module, cwdInRepo) : '',
  }));
  for (const pkg of failedPackages) {
    if (![...final.keys()].some((k) => k.startsWith(`${pkg} `) && final.get(k) === 'fail')) {
      tests.push({ name: `${pkg} (package failed)`, status: 'failed', message: '' });
    }
  }
  return { tests, parsed };
}

function goTest(check, ctx) {
  const argv = [ctx.go, 'test', ...check.args, '-json'];
  const proc = runProcess(argv, { cwd: ctx.cwd, env: ctx.env, timeoutSeconds: check.timeoutSeconds });
  if (proc.spawnError) return { ...proc, harnessError: proc.spawnError, tests: [] };
  const { tests, parsed } = parseGoTestJson(proc.stdout, { module: goModule(ctx.cwd), cwdInRepo: ctx.cwdInRepo });
  if (parsed === 0 && proc.exitCode !== 0) {
    return { ...proc, harnessError: null, tests: [{ name: 'go test (build failed)', status: 'failed', message: proc.stderr.slice(-4000) }] };
  }
  return { ...proc, tests };
}

/** node --test with the TAP reporter: leaf results and directives. */
function nodeTest(check, ctx) {
  const argv = [ctx.node, '--test', '--test-reporter=tap', ...check.args];
  const proc = runProcess(argv, { cwd: ctx.cwd, env: ctx.env, timeoutSeconds: check.timeoutSeconds });
  if (proc.spawnError) return { ...proc, harnessError: proc.spawnError, tests: [] };
  const tests = [];
  const lines = proc.stdout.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(not ok|ok) \d+ - (.*?)(?:\s+#\s*(SKIP|TODO)\b.*)?$/);
    if (!m) continue;
    // Suites report a result too; keep leaf tests only (their YAML block says type: 'test').
    const yamlType = lines.slice(i + 1, i + 8).join('\n').match(/type: '(suite|test)'/);
    if (yamlType && yamlType[1] === 'suite') continue;
    const status = m[4] ? 'skipped' : m[2] === 'ok' ? 'passed' : 'failed';
    const detail = [];
    for (let j = i + 1; j < lines.length && /^\s+(---|\.\.\.|\w|'|")/.test(lines[j]) && !/^\s*(?:not ok|ok) \d+/.test(lines[j]); j += 1) detail.push(lines[j]);
    tests.push({ name: m[3].trim(), status, message: status === 'failed' ? detail.join('\n').slice(0, 4000) : '' });
  }
  // A file that fails before reporting any test is itself a failing result.
  if (tests.length === 0 && proc.exitCode !== 0) {
    tests.push({ name: 'node --test (no results)', status: 'failed', message: proc.stderr.slice(-4000) });
  }
  return { ...proc, tests };
}

function command(check, ctx) {
  const argv = check.args[0] === 'node' ? [ctx.node, ...check.args.slice(1)] : check.args;
  const proc = runProcess(argv, { cwd: ctx.cwd, env: ctx.env, timeoutSeconds: check.timeoutSeconds });
  if (proc.spawnError) return { ...proc, harnessError: proc.spawnError, tests: [] };
  return { ...proc, tests: [] };
}

const RUNNERS = { jest, 'go-test': goTest, 'node-test': nodeTest, command };

export function runCheck(check, ctx) {
  const result = RUNNERS[check.runner](check, ctx);
  if (result.timedOut) {
    result.tests.push({ name: `${check.id} (timed out)`, status: 'failed', message: `exceeded ${check.timeoutSeconds ?? 900}s` });
  }
  return { ...result, counts: counts(result.tests) };
}

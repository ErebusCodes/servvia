import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
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
      tests.push({ name: `${file.name} (suite failed to run)`, status: 'failed', kind: 'build', file: file.name, message: file.message ?? '' });
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

/** The repository directory of a Go package, when the module path tells us. */
function goPackageDir(pkg, module, cwdInRepo) {
  if (!module || cwdInRepo == null || (pkg !== module && !pkg.startsWith(`${module}/`))) return null;
  return [cwdInRepo, pkg.slice(module.length).replace(/^\//, '')].filter(Boolean).join('/') || '.';
}

/** Parses `go test -json` output into the common test results. Pure, for testing. */
export function parseGoTestJson(stdout, { module = null, cwdInRepo = null } = {}) {
  const final = new Map();
  const output = new Map();
  const failedPackages = new Map();
  const buildOutput = new Map();
  let parsed = 0;
  for (const line of String(stdout).split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    parsed += 1;
    // A package that does not compile reports build-output under its test binary's import path.
    if (ev.Action === 'build-output' && ev.ImportPath) {
      if (!buildOutput.has(ev.ImportPath)) buildOutput.set(ev.ImportPath, []);
      buildOutput.get(ev.ImportPath).push(ev.Output ?? '');
      continue;
    }
    if (ev.Action === 'output' && ev.Test) {
      const key = `${ev.Package} ${ev.Test}`;
      if (!output.has(key)) output.set(key, []);
      output.get(key).push(ev.Output ?? '');
      continue;
    }
    if (!['pass', 'fail', 'skip'].includes(ev.Action)) continue;
    if (ev.Test) final.set(`${ev.Package} ${ev.Test}`, ev.Action);
    else if (ev.Action === 'fail') failedPackages.set(ev.Package, ev.FailedBuild ?? null);
  }
  const tests = [...final].map(([name, action]) => ({
    name,
    status: action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'skipped',
    message: action === 'fail' ? goFailureMessage(output.get(name) ?? [], name.split(' ')[0], module, cwdInRepo) : '',
  }));
  for (const [pkg, failedBuild] of failedPackages) {
    if (failedBuild) {
      // The package did not compile: none of its tests ran. The compiler's own lines carry the location.
      const dir = goPackageDir(pkg, module, cwdInRepo);
      const lines = (buildOutput.get(failedBuild) ?? []).filter((l) => !l.startsWith('# '));
      // Compiler paths are relative to the check's directory; qualify them by its place in the repository.
      const prefix = cwdInRepo && cwdInRepo !== '.' ? `${cwdInRepo}/` : '';
      const message = lines.map((l) => l.replace(/^(?:\.\/)?([\w./-]+\.go:\d+)/, `${prefix}$1`)).join('').slice(0, 4000);
      tests.push({ name: `${pkg} (build failed)`, status: 'failed', kind: 'build', package: pkg, dir, message });
    } else if (![...final.keys()].some((k) => k.startsWith(`${pkg} `) && final.get(k) === 'fail')) {
      tests.push({ name: `${pkg} (package failed)`, status: 'failed', kind: 'package', package: pkg, dir: goPackageDir(pkg, module, cwdInRepo), message: '' });
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
    return { ...proc, harnessError: null, buildFailed: true, tests: [{ name: 'go test (build failed)', status: 'failed', kind: 'build', message: proc.stderr.slice(-4000) }] };
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
    const name = m[3].trim();
    // A test file that failed as a whole (it did not load, or exited) is reported under its own path,
    // after the diagnostics node printed for it as TAP comments.
    if (status === 'failed' && check.args.includes(name) && detail.some((l) => /^\s*exitCode:/.test(l))) {
      const comments = [];
      for (let j = i - 1; j >= 0 && /^#/.test(lines[j]); j -= 1) if (!/^# Subtest:/.test(lines[j])) comments.unshift(lines[j].replace(/^# ?/, ''));
      tests.push({ name, status, kind: 'build', file: name, message: [...comments, ...detail].join('\n').slice(0, 4000) });
      continue;
    }
    tests.push({ name, status, message: status === 'failed' ? detail.join('\n').slice(0, 4000) : '' });
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

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? whole;
  });
}

function xmlAttributes(text) {
  return Object.fromEntries([...String(text).matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], xmlText(m[2])]));
}

/** TRX outcomes: anything not passed and not a recognised "did not run" is a failure. */
const NOT_RUN = new Set(['NotExecuted', 'Inconclusive', 'Pending', 'NotRunnable', 'Disconnected']);

/**
 * `<file>.cs:line N` in a .NET stack trace, as `<path in the repository>.cs:N`
 * when the file is in the evaluated workspace.
 */
function dotnetLocations(text, roots) {
  return String(text).replace(/ in (\S+?\.cs):line (\d+)/g, (whole, file, line) => {
    const root = roots.find((r) => r && file.startsWith(`${r}/`));
    return root ? ` in ${file.slice(root.length + 1)}:${line}` : ` in ${file}:${line}`;
  });
}

/**
 * Parses one TRX (Visual Studio test results) file into the common test
 * results. Pure, for testing. `total` is the file's own counter, so a caller
 * can refuse a file it could not read completely.
 */
export function parseTrx(xml, { roots = [] } = {}) {
  const tests = [];
  for (const m of String(xml).matchAll(/<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/g)) {
    const attrs = xmlAttributes(m[1]);
    const status = attrs.outcome === 'Passed' ? 'passed' : NOT_RUN.has(attrs.outcome) ? 'skipped' : 'failed';
    const body = m[2] ?? '';
    const message = xmlText(body.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? '');
    const stack = xmlText(body.match(/<StackTrace>([\s\S]*?)<\/StackTrace>/)?.[1] ?? '');
    tests.push({
      name: attrs.testName ?? '',
      status,
      message: status === 'failed' ? dotnetLocations(`${message}\n${stack}`, roots).slice(0, 4000) : '',
    });
  }
  const counters = String(xml).match(/<Counters\b([^>]*)\/?>/);
  const total = counters ? Number(xmlAttributes(counters[1]).total) : null;
  return { tests, total: Number.isFinite(total) ? total : null };
}

/**
 * `dotnet test` with the TRX logger. The evaluator chooses the logger and
 * the results directory; the check names only what to test (a solution or
 * project and its options). A build error of the candidate is a failed
 * result; a restore failure, a missing dotnet or unreadable results are a
 * harness error.
 */
function dotnetTest(check, ctx) {
  const dir = join(ctx.scratch, `${check.id}-${ctx.attempt}-trx`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const argv = [ctx.dotnet, 'test', ...check.args, '--logger', 'trx;LogFilePrefix=results', '--results-directory', dir,
    '--disable-build-servers', '-p:UseSharedCompilation=false', '--nologo'];
  const proc = runProcess(argv, { cwd: ctx.cwd, env: ctx.env, timeoutSeconds: check.timeoutSeconds });
  if (proc.spawnError) return { ...proc, harnessError: `dotnet could not be started (${proc.spawnError}); give the evaluator --dotnet-root`, tests: [] };
  const output = `${proc.stdout}\n${proc.stderr}`;
  const repoRoot = ctx.cwdInRepo && ctx.cwdInRepo !== '.' ? ctx.cwd.slice(0, -(ctx.cwdInRepo.length + 1)) : ctx.cwd;
  let realRoot = null;
  try { realRoot = realpathSync(repoRoot); } catch { /* the root is used as given */ }
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.trx')).sort();
  const tests = [];
  for (const file of files) {
    const parsed = parseTrx(readFileSync(join(dir, file), 'utf8'), { roots: [repoRoot, realRoot] });
    if (parsed.total !== null && parsed.total !== parsed.tests.length) {
      return { ...proc, harnessError: `${file}: the TRX counts ${parsed.total} tests but ${parsed.tests.length} results were read`, tests: [] };
    }
    tests.push(...parsed.tests);
  }
  const buildErrors = [...new Set(output.split('\n').filter((l) => /:\s*error\s+(?:CS|MSB|NETSDK|FS|BC)\d+/.test(l)).map((l) => l.trim()))];
  if (/:\s*error\s+NU\d{4}/.test(output) && buildErrors.length === 0) {
    return { ...proc, harnessError: 'dotnet restore failed (packages could not be restored)', tests: [] };
  }
  if (buildErrors.length > 0) {
    tests.push({ name: 'dotnet build (failed)', status: 'failed', kind: 'build', message: dotnetLocations(buildErrors.join('\n'), [repoRoot, realRoot]).replace(/\(\d+,\d+\)/g, (pos) => `:${pos.slice(1).split(',')[0]}`).slice(0, 4000) });
  } else if (files.length === 0) {
    return { ...proc, harnessError: proc.exitCode === 0 ? 'dotnet test wrote no TRX results' : `dotnet test failed without results (exit ${proc.exitCode})`, tests: [] };
  }
  return { ...proc, tests, buildFailed: buildErrors.length > 0 };
}

const RUNNERS = { jest, 'go-test': goTest, 'node-test': nodeTest, 'dotnet-test': dotnetTest, command };

export function runCheck(check, ctx) {
  const result = RUNNERS[check.runner](check, ctx);
  if (result.timedOut) {
    result.tests.push({ name: `${check.id} (timed out)`, status: 'failed', message: `exceeded ${check.timeoutSeconds ?? 900}s` });
  }
  return { ...result, counts: counts(result.tests) };
}

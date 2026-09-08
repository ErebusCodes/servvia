// Governance guard for apps/idealpos-bridge.
//
// The bridge entered this repo as an import of an unversioned directory that
// had been living on the venue PC, so the properties that made that import
// safe are conventions, not anything the compiler enforces: the vendor DLLs
// stay out of source control, no build output gets committed, the tracked
// App.config carries a placeholder key rather than the live one, and the
// CI-only test host stays honest about which suites it can actually run.
// Every one of those silently degrades the moment someone adds a file, and
// none of them is visible in a diff unless you already know to look. This
// script makes each of them a build failure instead.
//
// Usage: `node scripts/check-bridge-governance.mjs` (also `npm run
// check:bridge-governance`, wired into CI). Exits 0 clean, 1 with findings.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRIDGE_DIR = 'apps/idealpos-bridge';
// The CI-only test host is a sibling, not a subdirectory: the shipped
// project globs every .cs beneath itself, so nesting it there broke the
// real build. See that project's own header comment.
export const BRIDGE_CI_DIR = 'apps/idealpos-bridge-ci';
export const PLACEHOLDER_API_KEY = 'CHANGE_ME_GENERATE_A_FRESH_GUID';

/**
 * Vendor DLLs and build output must never be tracked. lib/PUT_DLLS_HERE.txt
 * is the file that documents the DLL policy and is itself legitimately
 * tracked, so only real binaries and bin/obj paths count as offenders.
 */
export function findForbiddenTrackedFiles(trackedPaths) {
  const inBridge = trackedPaths.filter(
    (p) => p.startsWith(`${BRIDGE_DIR}/`) || p.startsWith(`${BRIDGE_CI_DIR}/`),
  );
  return {
    vendorDlls: inBridge.filter((p) => p.toLowerCase().endsWith('.dll')),
    buildOutput: inBridge.filter((p) => /\/(bin|obj)\//.test(p)),
  };
}

/**
 * The tracked App.config must carry the placeholder. Anything else -- most
 * obviously a GUID -- means a live Bridge:ApiKey was committed.
 */
export function findCommittedApiKey(appConfigText) {
  const match = appConfigText.match(/<add key="Bridge:ApiKey" value="([^"]*)"/);
  if (!match) return 'Bridge:ApiKey setting is missing from App.config entirely';
  if (match[1] !== PLACEHOLDER_API_KEY) {
    return `Bridge:ApiKey is not the placeholder (expected "${PLACEHOLDER_API_KEY}")`;
  }
  return null;
}

/**
 * The TestResult/Assert helpers live in Tests/TestRunner.cs, which CI cannot
 * compile (it also holds TestRunner, which calls the two vendor-typed
 * suites). ci/CiTestSupport.cs mirrors that region verbatim. Extract it from
 * both so drift is caught rather than discovered later as a CI-only bug.
 */
export function extractSupportBlock(source) {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l === '    public class TestResult');
  if (start === -1) return null;
  let end = lines.length - 1;
  while (end > start && lines[end].trim() !== '}') end--; // namespace close
  while (end > start && lines[end - 1].trim() === '') end--; // trailing blanks
  return lines.slice(start, end).join('\n');
}

/** Suite classes TestRunner.RunAll() actually executes locally. */
export function parseSuitesFromTestRunner(source) {
  return [...source.matchAll(/results\.AddRange\((\w+)\.RunAll\(\)\);/g)].map((m) => m[1]);
}

/** Suite files the CI project compiles, as class names. */
export function parseSuitesFromCiProject(csproj) {
  // Separator-agnostic: the csproj uses Windows separators, but a future edit
  // (or an editor that normalises them) must not silently make this find zero
  // suites and then "agree" with an empty inventory.
  return [...csproj.matchAll(/<Compile Include="[^"]*Tests[\\/](\w+)\.cs"/g)].map((m) => m[1]);
}

/**
 * The Order Tablet WRITE execution path. Per the product decision, WebOrder /
 * Ecommerce / Doshii-Webit is not an Order Tablet transport: these files must
 * never reference the removed writer again. Guarding the execution path (not
 * the whole project) is deliberate — the strategy helpers and read repository
 * may still name WebOrder for other reasons; what must never come back is a
 * WebOrder WRITE reachable from a Send-to-Kitchen submission.
 */
export const ORDER_TABLET_EXECUTION_FILES = [
  'apps/idealpos-bridge/Orders/OrderService.cs',
  'apps/idealpos-bridge/BridgeHost.cs',
  'apps/idealpos-bridge/Api/Endpoints.cs',
  'apps/idealpos-bridge/Orders/OrderSubmitOutcome.cs',
  'apps/idealpos-bridge/Orders/NativeTable/TableRound.cs',
  'apps/idealpos-bridge/Orders/NativeTable/TableRoundWriter.cs',
  'apps/idealpos-bridge/Orders/NativeTable/NativeSubmission.cs',
  'apps/idealpos-bridge/Orders/NativeTable/NativeTableRoundSubmission.cs',
  'apps/idealpos-bridge/Orders/NativeTable/NativeTableRoundMapper.cs',
];

export const FORBIDDEN_ORDER_TABLET_PATTERNS = [
  /\bWebOrder\b/,
  /\bInsertOrders\b/,
  /\bLocalDataHelper\b/,
  /\bEcommerceGuid\b/,
  /\bConfirmedEcommercePluginGuid\b/,
];

/** Strip C# block comments, line/doc comments, and double-quoted string
 * literals so that a comment or message legitimately NAMING the removed
 * symbols (these files explain why WebOrder was removed) is not a false
 * positive — only real code references count. */
export function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function findWebOrderInOrderTabletPath(readFileText) {
  const hits = [];
  for (const file of ORDER_TABLET_EXECUTION_FILES) {
    let text;
    try {
      text = readFileText(file);
    } catch {
      continue; // a file may be absent in a partial checkout; not this guard's concern
    }
    const code = stripCommentsAndStrings(text);
    for (const pattern of FORBIDDEN_ORDER_TABLET_PATTERNS) {
      if (pattern.test(code)) hits.push({ file, token: pattern.source });
    }
  }
  return hits;
}

function main() {
  const problems = [];
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

  const { vendorDlls, buildOutput } = findForbiddenTrackedFiles(tracked);
  for (const f of vendorDlls) {
    problems.push(`vendor DLL is tracked (see ${BRIDGE_DIR}/lib/PUT_DLLS_HERE.txt): ${f}`);
  }
  for (const f of buildOutput) problems.push(`build output is tracked: ${f}`);

  const apiKeyProblem = findCommittedApiKey(readFileSync(`${BRIDGE_DIR}/App.config`, 'utf8'));
  if (apiKeyProblem) problems.push(`${BRIDGE_DIR}/App.config: ${apiKeyProblem}`);

  // WebOrder must never re-enter the Order Tablet execution path.
  const webOrderHits = findWebOrderInOrderTabletPath((f) => readFileSync(f, 'utf8'));
  for (const h of webOrderHits) {
    problems.push(
      `Order Tablet execution path re-acquired a WebOrder dependency: ${h.file} references ` +
        `/${h.token}/. The Order Tablet must write only through ITableRoundWriter — never WebOrder/` +
        `InsertOrders/LocalDataHelper/EcommerceGuid.`,
    );
  }

  const runnerSource = readFileSync(`${BRIDGE_DIR}/Tests/TestRunner.cs`, 'utf8');
  const mirrorSource = readFileSync(`${BRIDGE_CI_DIR}/CiTestSupport.cs`, 'utf8');
  const canonical = extractSupportBlock(runnerSource);
  const mirrored = extractSupportBlock(mirrorSource);
  if (canonical === null) {
    problems.push('could not locate the TestResult/Assert block in Tests/TestRunner.cs');
  } else if (canonical !== mirrored) {
    problems.push(
      `${BRIDGE_CI_DIR}/CiTestSupport.cs has drifted from the TestResult/Assert block in ` +
        `${BRIDGE_DIR}/Tests/TestRunner.cs. ` +
        'Re-sync the mirror (TestRunner.cs is the source of truth).',
    );
  }

  const inventory = JSON.parse(readFileSync('scripts/bridge-test-inventory.json', 'utf8'));
  const covered = inventory.ciCovered.suites;
  const notCovered = inventory.ciNotCovered.suites;

  const sum = inventory.ciCovered.tests + inventory.ciNotCovered.tests;
  if (sum !== inventory.totalLocalBaseline) {
    problems.push(
      `bridge-test-inventory.json does not add up: ${inventory.ciCovered.tests} covered + ` +
        `${inventory.ciNotCovered.tests} not covered = ${sum}, but totalLocalBaseline is ` +
        `${inventory.totalLocalBaseline}.`,
    );
  }

  const declared = [...covered, ...notCovered].sort();
  const actual = parseSuitesFromTestRunner(runnerSource).sort();
  if (declared.join(',') !== actual.join(',')) {
    problems.push(
      `every self-test suite must be classified as CI-covered or not. TestRunner.cs runs ` +
        `[${actual.join(', ')}] but bridge-test-inventory.json lists [${declared.join(', ')}].`,
    );
  }

  const ciSuites = parseSuitesFromCiProject(
    readFileSync(`${BRIDGE_CI_DIR}/VerduraIdealposBridge.CiTests.csproj`, 'utf8'),
  ).sort();
  if (ciSuites.join(',') !== [...covered].sort().join(',')) {
    problems.push(
      `the CI project compiles [${ciSuites.join(', ')}] but bridge-test-inventory.json ` +
        `declares [${[...covered].sort().join(', ')}] as CI-covered.`,
    );
  }

  if (problems.length > 0) {
    console.error(`Bridge governance check FAILED (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Bridge governance check passed (no tracked vendor DLLs or build output, App.config key is the ` +
      `placeholder, CI assert mirror in sync, ${inventory.ciCovered.tests}/${inventory.totalLocalBaseline} ` +
      `self-tests classified as CI-covered).`,
  );
}

// process.argv[1] is a plain filesystem path; import.meta.url is a file:// URL.
// pathToFileURL is the only comparison that holds on Windows -- the common
// `file://${process.argv[1]}` idiom silently never matches a C:\... path, which
// is exactly why scripts/check-no-nul-bytes.mjs prints nothing when run
// directly on this project's Windows host.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

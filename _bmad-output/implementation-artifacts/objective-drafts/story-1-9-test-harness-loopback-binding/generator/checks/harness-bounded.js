// connector-harness-change-bounded (Story 1.9). The connector command harness may differ from the
// baseline only by its one host-less server start becoming an explicit loopback bind on the endpoint
// its external command process targets. Structural, not positional: the candidate file must equal the
// baseline file with that single expression replaced, so no surrounding test, assertion or setup
// changes. Each way of failing has its own diagnosis.
// Generated constants (from the baseline): FILE, BASE_EXPR, NEW_EXPR, BASE_SHA256, EXPECTED_SHA256.
const fs = require('node:fs'); const { createHash } = require('node:crypto');
const FILE = __FILE__; const BASE_EXPR = __BASE_EXPR__; const NEW_EXPR = __NEW_EXPR__; const BASE_SHA256 = __BASE_SHA256__; const EXPECTED_SHA256 = __EXPECTED_SHA256__;
const text = fs.readFileSync(FILE, 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (s) => text.split(s).length - 1;
const problems = [];
const got = sha(text);
if (got === BASE_SHA256) {
  problems.push(`${FILE} is unchanged from the baseline: its host-less server start ${JSON.stringify(BASE_EXPR)} still binds the wildcard`);
} else if (got !== EXPECTED_SHA256) {
  if (count(BASE_EXPR) > 0) problems.push(`${FILE} still contains the host-less server start ${JSON.stringify(BASE_EXPR)}`);
  if (count(NEW_EXPR) !== 1) problems.push(`${FILE} contains the explicit loopback bind ${JSON.stringify(NEW_EXPR)} ${count(NEW_EXPR)} times, not exactly once`);
  // With the server start normalized back to the baseline form, any remaining difference lies outside
  // the one authorized expression: surrounding tests, assertions or setup were changed.
  const normalized = count(NEW_EXPR) === 1 && count(BASE_EXPR) === 0 ? text.replace(NEW_EXPR, BASE_EXPR) : text;
  if (sha(normalized) !== BASE_SHA256) problems.push(`${FILE} changed outside its one server-start expression (surrounding tests, assertions or setup differ from the baseline)`);
}
for (const p of problems) console.log('FAIL ' + p);
if (problems.length) process.exit(1);
console.log(`ok   ${FILE} differs from the baseline only by its explicit loopback bind`);

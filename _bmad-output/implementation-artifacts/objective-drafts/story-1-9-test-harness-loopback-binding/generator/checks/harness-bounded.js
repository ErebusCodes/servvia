// connector-harness-change-bounded (Story 1.9). The connector command harness may differ from the
// baseline only at its one host-less listen, which must bind the explicit loopback endpoint that its
// external command process targets. Generated constants: FILE, LINE, BASE_SHA256, BASE_LINE.
const fs = require('node:fs'); const { createHash } = require('node:crypto');
const FILE = __FILE__; const LINE = __LINE__; const BASE_SHA256 = __BASE_SHA256__; const BASE_LINE = __BASE_LINE__;
const WANT = "await app.listen(0, '127.0.0.1');";
const text = fs.readFileSync(FILE, 'utf8'); const lines = text.split('\n');
const problems = [];
if (lines[LINE - 1]?.trim() !== WANT) problems.push(`${FILE}:${LINE} is ${JSON.stringify(lines[LINE - 1]?.trim())}, not ${JSON.stringify(WANT)}`);
const restored = [...lines]; restored[LINE - 1] = BASE_LINE;
const got = createHash('sha256').update(restored.join('\n')).digest('hex');
if (got !== BASE_SHA256) problems.push(`${FILE} changed outside line ${LINE} (with line ${LINE} restored its sha256 is ${got}, the baseline is ${BASE_SHA256})`);
for (const p of problems) console.log('FAIL ' + p);
if (problems.length) process.exit(1);
console.log(`ok   ${FILE} differs from the baseline only by its explicit loopback bind (line ${LINE})`);

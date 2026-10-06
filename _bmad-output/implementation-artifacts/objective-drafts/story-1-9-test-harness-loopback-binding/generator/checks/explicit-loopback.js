// test-server-explicit-loopback (Story 1.9). Every listen call in API test code names the explicit
// loopback host '127.0.0.1', so no test server can bind a wildcard or an unspecified host.
const fs = require('node:fs'); const path = require('node:path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const files = [
  ...walk('apps/api/test').filter((f) => /\.(ts|js|mjs|cjs)$/.test(f)),
  ...walk('apps/api/src').filter((f) => /\.(spec|e2e-spec|integration-spec)\.ts$/.test(f) || f.split(path.sep).includes('testing')),
];
const bad = [];
for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
  if (/(\.listen\s*\(|\[\s*['"`]listen['"`]\s*\]\s*\()/.test(line) && !/\.listen\(\s*[^,()]+,\s*'127\.0\.0\.1'\s*[,)]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
});
for (const b of bad) console.log('FAIL listen without the explicit loopback host 127.0.0.1: ' + b);
if (bad.length) process.exit(1);
console.log(`ok   every listen( in ${files.length} API test files names the explicit loopback host '127.0.0.1'`);

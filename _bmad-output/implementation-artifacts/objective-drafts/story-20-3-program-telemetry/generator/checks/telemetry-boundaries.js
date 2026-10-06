// telemetry-boundaries (Story 20.3). Static privacy and isolation boundary of the telemetry tool:
// every non-test source under tooling/telemetry imports only node: built-ins from ALLOWED_BUILTINS,
// relative modules inside tooling/telemetry, or read-only modules of tooling/evaluator/lib; it uses no
// network API; every child process it starts runs git (a literal 'git' first argument); it names no
// surveillance data source; no manifest adds a dependency. Generated constants: ALLOWED_BUILTINS.
const fs = require('node:fs'); const path = require('node:path');
const ALLOWED_BUILTINS = __ALLOWED_BUILTINS__;
const ROOT = 'tooling/telemetry';
let bad = 0;
const fail = (m) => { bad += 1; console.log('FAIL ' + m); };
if (!fs.existsSync(path.join(ROOT, 'bin/telemetry.mjs'))) { console.log('FAIL tooling/telemetry/bin/telemetry.mjs does not exist'); process.exit(1); }
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [path.join(d, e.name)] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const all = walk(ROOT).map((f) => f.split(path.sep).join('/'));
for (const f of all) if (f.endsWith('/node_modules') || f.includes('/node_modules/')) fail(`${f}: vendored dependencies are not allowed`);
for (const f of all.filter((f) => /(^|\/)package(-lock)?\.json$/.test(f))) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) if (j[k] && Object.keys(j[k]).length) fail(`${f}: declares ${k}`);
}
const sources = all.filter((f) => /\.(mjs|cjs|js)$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.(mjs|cjs|js)$/.test(f));
if (!sources.length) fail('no telemetry source files');
const evaluatorLib = path.resolve('tooling/evaluator/lib') + path.sep;
for (const f of sources) {
  const text = fs.readFileSync(f, 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const specs = [...code.matchAll(/\bimport\s+(?:[^'"`;]*?\s+from\s+)?['"`]([^'"`]+)['"`]|\bimport\s*\(\s*['"`]([^'"`]+)['"`]|\brequire\s*\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1] || m[2] || m[3]);
  if (/\bimport\s*\(\s*[^'"`\s]/.test(code) || /\brequire\s*\(\s*[^'"`\s]/.test(code)) fail(`${f}: a dynamic import or require with a computed specifier`);
  for (const sp of specs) {
    if (sp.startsWith('node:')) { if (!ALLOWED_BUILTINS.includes(sp)) fail(`${f}: imports ${sp} (allowed: ${ALLOWED_BUILTINS.join(', ')})`); continue; }
    if (sp.startsWith('.')) {
      const target = path.resolve(path.dirname(f), sp);
      const inTelemetry = target.startsWith(path.resolve(ROOT) + path.sep);
      const inEvaluatorLib = target.startsWith(evaluatorLib);
      if (!inTelemetry && !inEvaluatorLib) fail(`${f}: imports ${sp} outside tooling/telemetry and tooling/evaluator/lib`);
      continue;
    }
    fail(`${f}: imports the package ${sp} (only node: built-ins and relative modules are allowed)`);
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(code)) fail(`${f}: uses a network API`);
  for (const m of code.matchAll(/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g)) {
    const at = code.slice(m.index);
    if (!/^(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*['"]git['"]/.test(at)) fail(`${f}: starts a child process other than a literal 'git': ${at.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
  const prohibited = code.match(/\b(screencapture|screenshot|osascript|pbpaste|pbcopy|clipboard|xdotool|ioreg|lsof|keylog\w*|keystroke\w*|mousemove|zsh_history|bash_history|zhistory|userInfo|hostname|networkInterfaces|getActiveWindow|activeWindow)\b/i);
  if (prohibited) fail(`${f}: names a prohibited data source: ${prohibited[0]}`);
}
console.log(bad ? `FAIL ${bad} boundary violation(s)` : `ok   ${sources.length} telemetry source file(s): built-ins only, git-only child processes, no network, no surveillance source`);
process.exit(bad ? 1 : 0);

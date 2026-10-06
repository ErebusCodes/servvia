// loopback-endpoint-identity (Story 1.9). Runs the full API unit and integration suites with an
// evaluator-owned probe and requires every in-process test server to bind the explicit loopback
// 127.0.0.1 and every request to such a server to target that same endpoint. The probe observes; it
// changes no bind and no request. Generated constants: REQUIRED, FLOORS.
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const REQUIRED = __REQUIRED__;
const FLOORS = __FLOORS__;
const api = process.cwd(); const dir = fs.mkdtempSync(path.join(api, '.servvia-endpoint-'));
const OUT = path.join(dir, 'events.jsonl'); const PROBE = path.join(dir, 'probe.js');
fs.writeFileSync(PROBE, `const net = require('node:net'); const http = require('node:http'); const https = require('node:https'); const fs = require('node:fs'); const path = require('node:path');
const OUT = ${JSON.stringify(OUT)};
// Modules are shared by every test file in a Jest worker: each file's setup re-registers its own resolver.
net.__servviaEndpointFile = () => { try { return path.relative(${JSON.stringify(api)}, expect.getState().testPath); } catch { return null; } };
if (!net.__servviaEndpointProbe) {
  net.__servviaEndpointProbe = true;
  const record = (e) => fs.appendFileSync(OUT, JSON.stringify({ file: net.__servviaEndpointFile(), ...e }) + '\\n');
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    this.once('listening', () => { const a = this.address(); if (a && typeof a === 'object') record({ kind: 'listen', address: a.address, port: a.port }); });
    return listen.apply(this, args);
  };
  for (const mod of [http, https]) {
    for (const fn of ['request', 'get']) {
      const original = mod[fn];
      mod[fn] = function (...args) {
        let host = null; let port = null;
        for (const a of args) {
          if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); host = u.hostname.replace(/^\\[|\\]$/g, ''); port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80); }
          else if (a && typeof a === 'object') { if (a.hostname != null || a.host != null) host = String(a.hostname ?? a.host).replace(/^\\[|\\]$/g, '').replace(/:\\d+$/, ''); if (a.port != null) port = Number(a.port); }
        }
        record({ kind: 'request', host, port });
        return original.apply(this, args);
      };
    }
  }
}
`);
const jest = path.join(api, '../../node_modules/jest/bin/jest.js');
function run(name, config) {
  const results = path.join(dir, `${name}.json`);
  const r = spawnSync(process.execPath, [jest, '--config', JSON.stringify(config), '--runInBand', '--ci', '--json', `--outputFile=${results}`], { cwd: api, env: process.env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const j = fs.existsSync(results) ? JSON.parse(fs.readFileSync(results, 'utf8')) : null;
  const passed = j?.numPassedTests ?? 0; const failed = j?.numFailedTests ?? -1;
  console.log(`${name}: jest exit ${r.status}, passed ${passed}, failed ${failed}, suites failed ${j?.numFailedTestSuites ?? '?'}`);
  return r.status === 0 && j && failed === 0 && j.numFailedTestSuites === 0 && passed >= FLOORS[name];
}
let problems = [];
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(api, 'package.json'), 'utf8')).jest;
  const unitOk = run('unit', { ...pkg, rootDir: path.join(api, pkg.rootDir), setupFilesAfterEnv: [...(pkg.setupFilesAfterEnv ?? []), PROBE] });
  const integ = JSON.parse(fs.readFileSync(path.join(api, 'test/jest-integration.json'), 'utf8'));
  const integrationOk = run('integration', { ...integ, rootDir: path.join(api, 'test', integ.rootDir), setupFilesAfterEnv: [...(integ.setupFilesAfterEnv ?? []), PROBE] });
  const events = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const evidenced = new Set(); const servers = new Map(); let listens = 0; let matched = 0;
  for (const e of events) {
    if (e.kind === 'listen') {
      listens += 1; servers.set(e.port, e);
      if (e.address !== '127.0.0.1') problems.push(`${e.file}: a test server bound ${e.address}:${e.port}, not the explicit loopback 127.0.0.1`);
    } else if (e.kind === 'request' && servers.has(e.port)) {
      const s = servers.get(e.port);
      if (e.host !== s.address || s.address !== '127.0.0.1') problems.push(`${e.file}: a request to ${e.host}:${e.port} but the test server there is bound to ${s.address}:${e.port}`);
      else { matched += 1; evidenced.add(e.file); }
    }
  }
  for (const f of REQUIRED) if (!evidenced.has(f)) problems.push(`${f}: no request reached the 127.0.0.1 endpoint its test server is bound to (no runtime evidence)`);
  if (!unitOk) problems.push(`the unit suite did not pass under the endpoint probe at its floor (${FLOORS.unit})`);
  if (!integrationOk) problems.push(`the integration suite did not pass under the endpoint probe at its floor (${FLOORS.integration})`);
  problems = [...new Set(problems)];
  console.log(`events ${events.length}; listens ${listens}; matched loopback requests ${matched}; required files evidenced ${REQUIRED.filter((f) => evidenced.has(f)).length}/${REQUIRED.length}; problems ${problems.length}`);
  for (const p of problems.slice(0, 40)) console.log(`FAIL ${p}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log('ok   every request to an in-process test server targeted the explicit 127.0.0.1 endpoint that server is bound to');

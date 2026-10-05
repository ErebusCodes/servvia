// Story 1.9 mechanism experiment (scratch only; touches no repository file).
// Part 1 (deterministic): another process holds 127.0.0.1:P. Does a host-less listen(P) succeed,
// what does it bind, and which process answers a request to 127.0.0.1:P? Does listen(P, '127.0.0.1') succeed?
// Part 2 (allocation): another process holds K ephemeral ports on 127.0.0.1. How often does a host-less
// listen(0) (what supertest 6.3.4 does) receive one of those ports?
const http = require('node:http');
const { fork } = require('node:child_process');

if (process.argv[2] === 'holder') {
  const want = Number(process.argv[3]);
  const servers = [];
  let ready = 0;
  for (let i = 0; i < want; i += 1) {
    const s = http.createServer((req, res) => res.end('OTHER-PROCESS'));
    s.listen(0, '127.0.0.1', () => { servers.push(s.address().port); ready += 1; if (ready === want) process.send(servers); });
  }
  process.on('message', () => process.exit(0));
  return;
}

const get = (port) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b)); })
    .on('error', (e) => resolve(`ERROR ${e.code}`));
});
const listen = (server, ...args) => new Promise((resolve) => {
  server.once('error', (e) => resolve({ error: e.code }));
  server.listen(...args, () => resolve({ address: server.address().address, port: server.address().port }));
});
const holder = (k) => new Promise((resolve) => { const c = fork(__filename, ['holder', String(k)]); c.once('message', (ports) => resolve({ c, ports })); });

(async () => {
  const out = { node: process.version, platform: `${process.platform}-${process.arch}` };
  // Part 1
  const { c: h1, ports: [P] } = await holder(1);
  const wild = http.createServer((req, res) => res.end('TEST-SERVER'));
  out.hostlessListenOnHeldPort = await listen(wild, P);
  out.requestTo127001 = await get(P);
  wild.close();
  const loop = http.createServer((req, res) => res.end('TEST-SERVER'));
  out.loopbackListenOnHeldPort = await listen(loop, P, '127.0.0.1');
  loop.close();
  h1.send('stop');
  // Part 2
  const K = Number(process.env.HOLD || 2000); const TRIALS = Number(process.env.TRIALS || 3000);
  const { c: h2, ports } = await holder(K);
  const held = new Set(ports);
  let collisions = 0; let wildcard = 0; const examples = [];
  for (let i = 0; i < TRIALS; i += 1) {
    const s = http.createServer((req, res) => res.end('TEST-SERVER'));
    const a = await listen(s, 0);
    if (a.address === '::' || a.address === '0.0.0.0') wildcard += 1;
    if (held.has(a.port)) { collisions += 1; if (examples.length < 3) examples.push({ port: a.port, answeredBy: await get(a.port) }); }
    await new Promise((r) => s.close(r));
  }
  h2.send('stop');
  out.allocation = { heldLoopbackPorts: K, hostlessListenTrials: TRIALS, wildcardBinds: wildcard, assignedAHeldPort: collisions, examples };
  console.log(JSON.stringify(out));
})();

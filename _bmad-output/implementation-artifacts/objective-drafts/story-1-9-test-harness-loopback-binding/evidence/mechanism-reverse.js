// Story 1.9 mechanism experiment, reverse order (scratch only).
// Part 3a (deterministic): the test server binds host-less listen(0) first (port P, wildcard). Can another
// process then bind 127.0.0.1:P, and who answers a request to 127.0.0.1:P?
// Part 3b (allocation): the test process holds W host-less listen(0) servers; another process performs N
// loopback ephemeral binds listen(0, '127.0.0.1'). How many land on a port the wildcard servers hold?
// Part 3c (same process): the same as 3b inside one process (a fake loopback server started while a
// host-less test server is open, as integration tests do).
const http = require('node:http');
const { fork } = require('node:child_process');

const listen = (server, ...args) => new Promise((resolve) => {
  server.once('error', (e) => resolve({ error: e.code }));
  server.listen(...args, () => resolve({ address: server.address().address, port: server.address().port }));
});
const get = (port) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b)); })
    .on('error', (e) => resolve(`ERROR ${e.code}`));
});

if (process.argv[2] === 'binder') {
  process.on('message', async (m) => {
    if (m.explicit) { const s = http.createServer((q, r) => r.end('OTHER-PROCESS')); process.send(await listen(s, m.explicit, '127.0.0.1')); return; }
    const held = new Set(m.held); const hits = []; const keep = [];
    for (let i = 0; i < m.n; i += 1) {
      const s = http.createServer((q, r) => r.end('OTHER-PROCESS'));
      const a = await listen(s, 0, '127.0.0.1');
      if (held.has(a.port)) { hits.push(a.port); keep.push(s); } else await new Promise((r) => s.close(r));
    }
    process.send({ hits });
  });
  return;
}

const child = () => fork(__filename, ['binder']);
const ask = (c, m) => new Promise((resolve) => { c.once('message', resolve); c.send(m); });

(async () => {
  const out = { node: process.version };
  // 3a
  const t = http.createServer((q, r) => r.end('TEST-SERVER'));
  const a = await listen(t, 0);
  const c1 = child();
  out.wildcardFirst = a;
  out.otherProcessBindsSamePortOn127001 = await ask(c1, { explicit: a.port });
  out.requestTo127001 = await get(a.port);
  c1.kill(); t.close();
  // 3b
  const W = Number(process.env.W || 1000); const N = Number(process.env.N || 3000);
  const servers = []; const held = [];
  for (let i = 0; i < W; i += 1) { const s = http.createServer((q, r) => r.end('TEST-SERVER')); const x = await listen(s, 0); servers.push(s); held.push(x.port); }
  const c2 = child();
  const r = await ask(c2, { n: N, held });
  out.crossProcess = { wildcardServersHeld: W, loopbackEphemeralBinds: N, landedOnAWildcardPort: r.hits.length, examples: [] };
  for (const p of r.hits.slice(0, 3)) out.crossProcess.examples.push({ port: p, requestTo127001AnsweredBy: await get(p) });
  c2.kill();
  // 3c
  const heldSet = new Set(held); let same = 0; const ex = [];
  for (let i = 0; i < N; i += 1) {
    const s = http.createServer((q, r2) => r2.end('FAKE-LOOPBACK-SERVER'));
    const x = await listen(s, 0, '127.0.0.1');
    if (heldSet.has(x.port)) { same += 1; if (ex.length < 3) ex.push({ port: x.port, requestTo127001AnsweredBy: await get(x.port) }); }
    await new Promise((res) => s.close(res));
  }
  out.sameProcess = { wildcardServersHeld: W, loopbackEphemeralBinds: N, landedOnAWildcardPort: same, examples: ex };
  for (const s of servers) s.close();
  console.log(JSON.stringify(out));
  process.exit(0);
})();

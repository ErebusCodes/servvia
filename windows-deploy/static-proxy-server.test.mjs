// Automated coverage for windows-deploy/static-proxy-server.mjs's WebSocket
// upgrade proxying (commit cc3f0c9 fixed a real bug here — Socket.IO/WS
// connections through the deployed Order Tablet proxy silently never
// connected — but shipped with manual verification only, zero automated
// coverage). Run with `node --test windows-deploy/static-proxy-server.test.mjs`.
//
// Not covered here: the upstream-connect-timeout branch added alongside this
// file (a silently-dropped SYN, e.g. a firewalled host). Deterministically
// reproducing a real TCP black-hole without a flaky, slow, network-dependent
// test isn't practical — flagged rather than faked. What *is* covered here
// (successful upgrade proxying, and a fast-failing refused connection) does
// exercise the same upstreamSocket lifecycle/cleanup code around it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import net from 'node:net';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(ROOT, 'static-proxy-server.mjs');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForListening(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => resolve(false));
    });
    if (ok) return;
    await delay(50);
  }
  throw new Error(`proxy never started listening on ${port}`);
}

function makeDistDir() {
  const dir = mkdtempSync(join(tmpdir(), 'verdura-static-proxy-test-'));
  writeFileSync(join(dir, 'index.html'), '<html>ok</html>');
  return dir;
}

test('proxies a real WebSocket upgrade handshake through to the upstream API', async () => {
  const upstreamPort = await getFreePort();
  const upstream = createServer();
  const upgradeReceived = new Promise((resolve) => {
    upstream.on('upgrade', (req, clientSocket, head) => {
      clientSocket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n\r\n',
      );
      clientSocket.write('hello-from-upstream');
      resolve(req.url);
    });
  });
  await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

  const distDir = makeDistDir();
  const proxyPort = await getFreePort();
  const child = spawn(
    process.execPath,
    [SCRIPT, distDir, String(proxyPort), `http://127.0.0.1:${upstreamPort}`],
    { stdio: 'ignore' },
  );

  try {
    await waitForListening(proxyPort);

    const clientSocket = net.connect(proxyPort, '127.0.0.1');
    await new Promise((resolve, reject) => {
      clientSocket.once('connect', resolve);
      clientSocket.once('error', reject);
    });
    clientSocket.write(
      'GET /socket.io/?transport=websocket HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );

    const url = await upgradeReceived;
    assert.equal(url, '/socket.io/?transport=websocket');

    const response = await new Promise((resolve) => {
      let buf = '';
      clientSocket.on('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('hello-from-upstream')) resolve(buf);
      });
    });
    assert.match(response, /101 Switching Protocols/);
    assert.match(response, /hello-from-upstream/);

    clientSocket.destroy();
  } finally {
    child.kill();
    upstream.close();
    rmSync(distDir, { recursive: true, force: true });
  }
});

test('a refused upstream connection destroys the client socket instead of hanging it open', async () => {
  const deadPort = await getFreePort(); // freed immediately after; nothing listens on it

  const distDir = makeDistDir();
  const proxyPort = await getFreePort();
  const child = spawn(
    process.execPath,
    [SCRIPT, distDir, String(proxyPort), `http://127.0.0.1:${deadPort}`],
    { stdio: 'ignore' },
  );

  try {
    await waitForListening(proxyPort);

    const clientSocket = net.connect(proxyPort, '127.0.0.1');
    await new Promise((resolve, reject) => {
      clientSocket.once('connect', resolve);
      clientSocket.once('error', reject);
    });
    clientSocket.write(
      'GET /socket.io/?transport=websocket HTTP/1.1\r\n' +
        'Host: 127.0.0.1\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n',
    );

    const closed = await new Promise((resolve) => {
      clientSocket.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    assert.equal(closed, true, 'client socket should be destroyed promptly on ECONNREFUSED, not left hanging');
  } finally {
    child.kill();
    rmSync(distDir, { recursive: true, force: true });
  }
});

// Native-Windows static file + reverse proxy server for a built frontend
// (Order Tablet, Admin Console, Kitchen Display, or Window Display —
// whichever workspace's `dist/` this is pointed at).
//
// Exists because the Docker-based deployment (docker/frontend.Dockerfile +
// docker/nginx-spa.conf) assumes an nginx container, which isn't part of
// the native-Windows-host production architecture this project uses for
// DUNEDIN. This script reproduces nginx-spa.conf's exact routing so the
// built frontend behaves identically either way:
//   - /api/*, /socket.io/*, /media/* are proxied same-origin to the API
//     (required: VITE_API_URL is deliberately left empty at build time —
//     see apps/admin-console/.env.example's own comment on why a
//     same-origin call, not a cross-origin one, is required for the
//     refresh_token cookie's SameSite=Strict enforcement to work at all).
//   - everything else falls back to index.html (client-side SPA routing).
//
// No new dependencies: built entirely on Node's own http/fs modules so it
// needs nothing beyond what `npm ci` already installs at the repo root.
//
// Usage: node static-proxy-server.mjs <dist-dir> <listen-port> [api-origin]
// api-origin defaults to http://127.0.0.1:3000.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , distDirArg, portArg, apiOriginArg] = process.argv;
if (!distDirArg || !portArg) {
  console.error('Usage: node static-proxy-server.mjs <dist-dir> <listen-port> [api-origin]');
  process.exit(1);
}

const distDir = path.resolve(distDirArg);
const port = Number(portArg);
const apiOrigin = new URL(apiOriginArg || 'http://127.0.0.1:3000');

const PROXY_PREFIXES = ['/api/', '/socket.io/', '/media/'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function proxyRequest(req, res) {
  const target = {
    hostname: apiOrigin.hostname,
    port: apiOrigin.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: apiOrigin.host },
  };
  const proxyReq = http.request(target, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });
  req.pipe(proxyReq, { end: true });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(distDir, urlPath);

  // Prevent path traversal outside distDir.
  if (!filePath.startsWith(distDir)) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: client-side routes resolve to index.html.
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  if (PROXY_PREFIXES.some((prefix) => req.url.startsWith(prefix))) {
    proxyRequest(req, res);
  } else {
    serveStatic(req, res);
  }
});

// Plain http.request()-based proxying (above) only handles regular
// request/response cycles — it does NOT forward the WebSocket handshake
// (the `Upgrade: websocket` header triggers Node's separate 'upgrade'
// event, never 'request'). Without this handler, any real-time
// Socket.IO connection through this deployed proxy would silently never
// connect at all — the Order Tablet's live order-status updates depend
// on this working, not just plain GET/POST calls. Standard dependency-free
// technique: open a raw TCP connection to the API, replay the client's
// original handshake bytes verbatim, then pipe both directions.
server.on('upgrade', (req, clientSocket, head) => {
  if (!PROXY_PREFIXES.some((prefix) => req.url.startsWith(prefix))) {
    clientSocket.destroy();
    return;
  }
  const upstreamSocket = net.connect(apiOrigin.port, apiOrigin.hostname, () => {
    const headerLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = name.toLowerCase() === 'host' ? apiOrigin.host : req.rawHeaders[i + 1];
      headerLines.push(`${name}: ${value}`);
    }
    upstreamSocket.write(headerLines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamSocket.on('error', (err) => {
    console.error('[proxy] websocket upstream error:', err.message);
    clientSocket.destroy();
  });
  clientSocket.on('error', () => upstreamSocket.destroy());
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[static-proxy-server] serving ${distDir} on 0.0.0.0:${port}, proxying ${PROXY_PREFIXES.join(', ')} -> ${apiOrigin.origin}`);
});

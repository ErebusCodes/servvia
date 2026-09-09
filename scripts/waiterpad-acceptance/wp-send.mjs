/**
 * ONE-SHOT WaiterPad client for the authorised 2026-09-09 acceptance test.
 *
 * SINGLE ATTEMPT. NO RETRY, EVER. If the send is ambiguous it stays ambiguous;
 * an automatic retry is the one thing that turns an uncertain round into a
 * double-charged customer.
 *
 * Usage: node wp-send.mjs <payloadFile> <label>
 * Writes a full transcript (hex + ascii, with timings) to <label>.transcript.txt
 */
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , payloadFile, label] = process.argv;
if (!payloadFile || !label) {
  console.error('usage: node wp-send.mjs <payloadFile> <label>');
  process.exit(2);
}

const HOST = '192.168.1.199';
const PORT = 6983;
const IDLE_CLOSE_MS = 6000; // stop waiting after this much silence
const HARD_MS = 20000;

const payload = readFileSync(payloadFile);
const log = [];
const t0 = Date.now();
const at = () => `+${String(Date.now() - t0).padStart(5, ' ')}ms`;
const say = (s) => {
  const line = `${at()} ${s}`;
  console.log(line);
  log.push(line);
};

say(`TARGET ${HOST}:${PORT}`);
say(`PAYLOAD ${payload.length} bytes from ${payloadFile}`);
log.push('--- PAYLOAD ---');
log.push(payload.toString('utf8'));
log.push('--- /PAYLOAD ---');

const chunks = [];
let idleTimer = null;
const sock = new net.Socket();

const finish = (why) => {
  if (sock.destroyed) return;
  say(`CLOSING (${why})`);
  sock.destroy();
};

const armIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => finish('idle'), IDLE_CLOSE_MS);
};

const hardTimer = setTimeout(() => finish('hard deadline'), HARD_MS);

sock.setNoDelay(true);
sock.on('connect', () => {
  say(`CONNECTED local=${sock.localAddress}:${sock.localPort}`);
  sock.write(payload, () => say(`SENT ${payload.length} bytes (single attempt, no retry)`));
  armIdle();
});
sock.on('data', (d) => {
  chunks.push(d);
  say(`RECV ${d.length} bytes`);
  log.push(`  ascii: ${JSON.stringify(d.toString('utf8'))}`);
  log.push(`  hex  : ${d.toString('hex')}`);
  armIdle();
});
sock.on('error', (e) => say(`SOCKET ERROR ${e.message}`));
sock.on('close', (hadErr) => {
  clearTimeout(hardTimer);
  if (idleTimer) clearTimeout(idleTimer);
  const all = Buffer.concat(chunks);
  say(`CLOSED hadError=${hadErr} totalResponseBytes=${all.length}`);
  log.push('--- FULL RESPONSE ---');
  log.push(all.toString('utf8'));
  log.push('--- /FULL RESPONSE ---');
  const verdict = all.length === 0 ? 'NO RESPONSE' : all.toString('utf8');
  log.push(`VERDICT-RAW: ${verdict}`);
  writeFileSync(`${label}.transcript.txt`, log.join('\n'), 'utf8');
  console.log(`\ntranscript -> ${label}.transcript.txt`);
});

sock.connect(PORT, HOST);

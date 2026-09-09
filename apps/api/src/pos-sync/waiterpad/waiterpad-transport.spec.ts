/**
 * Transport tests, driven against a fake 6983 listener.
 *
 * The assertion that matters in almost every case is not the returned outcome
 * but `server.requests.length === 1` and `server.connections === 1`. Those two
 * together are what "sends at most once" means, and they are what stops a
 * future refactor introducing a reconnect that would double-charge a customer.
 */
import {
  sendOrder2Once,
  WaiterPadTransportError,
  type WaiterPadSendOutcome,
} from './waiterpad-transport';
import {
  startFakeWaiterPadServer,
  type FakeBehaviour,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';

const PAYLOAD =
  '<?xml version="1.0" encoding="UTF-8" ?><WPPacket><Order Type="Order2" /></WPPacket>';

const timeouts = { connectMs: 1_000, writeMs: 1_000, readMs: 1_200 };

let server: FakeWaiterPadServer | null = null;

async function withServer(behaviour: FakeBehaviour): Promise<WaiterPadSendOutcome> {
  server = await startFakeWaiterPadServer(behaviour);
  return await sendOrder2Once(PAYLOAD, { host: '127.0.0.1', port: server.port, timeouts });
}

afterEach(async () => {
  await server?.close();
  server = null;
});

describe('a successful exchange', () => {
  it('parses ACK and reports that bytes left the host', async () => {
    const out = await withServer({ kind: 'ack' });
    expect(out.kind).toBe('responded');
    expect(out.bytesLeftHost).toBe(true);
    if (out.kind === 'responded') expect(out.response.type).toBe('ACK');
  });

  it('sends exactly once, over exactly one connection', async () => {
    await withServer({ kind: 'ack' });
    expect(server?.requests).toHaveLength(1);
    expect(server?.connections).toBe(1);
  });

  it('delivers the payload byte-for-byte', async () => {
    await withServer({ kind: 'ack' });
    expect(server?.requests[0]).toBe(PAYLOAD);
  });
});

describe('discouraging responses are still responses', () => {
  it('parses NAK without retrying', async () => {
    const out = await withServer({ kind: 'nak' });
    expect(out.kind).toBe('responded');
    if (out.kind === 'responded') expect(out.response.type).toBe('NAK');
    expect(server?.requests).toHaveLength(1);
  });

  it('parses NAKREGO — what the real till returned on 2026-09-09', async () => {
    const out = await withServer({ kind: 'nakrego' });
    expect(out.kind).toBe('responded');
    if (out.kind === 'responded') expect(out.response.type).toBe('NAKREGO');
    expect(server?.requests).toHaveLength(1);
  });

  it('waits out a slow ACK rather than giving up early', async () => {
    const out = await withServer({ kind: 'delayedAck', delayMs: 300 });
    expect(out.kind).toBe('responded');
  });

  it('keeps a reply that arrives just before the peer disconnects', async () => {
    const out = await withServer({ kind: 'ackThenDisconnect' });
    expect(out.kind).toBe('responded');
    if (out.kind === 'responded') expect(out.response.type).toBe('ACK');
  });
});

describe('ambiguity after the write is never reported as failure', () => {
  it.each<[string, FakeBehaviour]>([
    ['silence', { kind: 'silent' }],
    ['a reset after the request', { kind: 'resetAfterRequest' }],
    ['a truncated reply', { kind: 'truncated' }],
    ['well-formed but meaningless XML', { kind: 'malformedXml' }],
  ])('%s leaves bytesLeftHost true', async (_label, behaviour) => {
    const out = await withServer(behaviour);
    expect(out.bytesLeftHost).toBe(true);
    expect(out.kind).not.toBe('failedBeforeSend');
    expect(server?.requests).toHaveLength(1);
  });

  it('classifies silence as noResponse, not as a rejection', async () => {
    const out = await withServer({ kind: 'silent' });
    expect(out.kind).toBe('noResponse');
  });

  it('classifies unparseable content distinctly from silence', async () => {
    const out = await withServer({ kind: 'malformedXml' });
    expect(out.kind).toBe('unparseableResponse');
  });
});

describe('failures before any byte is written', () => {
  it('reports failedBeforeSend when nothing is listening', async () => {
    // Bind and immediately release, so the port is almost certainly closed.
    const tmp = await startFakeWaiterPadServer({ kind: 'ack' });
    const deadPort = tmp.port;
    await tmp.close();

    const out = await sendOrder2Once(PAYLOAD, {
      host: '127.0.0.1',
      port: deadPort,
      timeouts,
    });
    expect(out.kind).toBe('failedBeforeSend');
    expect(out.bytesLeftHost).toBe(false);
  });

  /**
   * A reset that arrives AFTER the TCP handshake is NOT a pre-send failure,
   * even though the server never read a byte.
   *
   * By the time the peer's RST reaches us we have already had a `connect` event
   * and already called `write()`. Whether those bytes made it onto the wire, or
   * into the receiver's socket buffer and then into `CheckWPOrder`, is not
   * something the client can determine. The conservative answer is the only
   * safe one, and this test exists to stop someone "fixing" it into
   * `failedBeforeSend` — which would license an automatic resend of an order
   * that may already be on a kitchen printer.
   */
  it('treats a reset AFTER connect as uncertain, not as a pre-send failure', async () => {
    const out = await withServer({ kind: 'resetOnConnect' });
    expect(out.bytesLeftHost).toBe(true);
    expect(out.kind).not.toBe('failedBeforeSend');
    expect(server?.requests).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('will not send an empty payload', async () => {
    await expect(
      sendOrder2Once('', { host: '127.0.0.1', port: 1, timeouts }),
    ).rejects.toBeInstanceOf(WaiterPadTransportError);
  });
});

describe('the module cannot retry, structurally', () => {
  it('exposes no retry, reconnect or backoff surface', async () => {
    const mod: Record<string, unknown> = await import('./waiterpad-transport');
    const names = Object.keys(mod).join(' ').toLowerCase();
    expect(names).not.toMatch(/retry|reconnect|backoff|repeat/);
  });

  it('opens one connection per call and no more, even on the worst script', async () => {
    await withServer({ kind: 'resetAfterRequest' });
    expect(server?.connections).toBe(1);
  });
});

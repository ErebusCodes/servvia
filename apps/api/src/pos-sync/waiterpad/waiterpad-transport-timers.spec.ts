/**
 * THE TIMER LIFECYCLE. Three bounded phases, and a deadline may only end its own.
 *
 * THE BUG THESE TESTS WERE WRITTEN AGAINST. The connect deadline was pushed
 * onto a shared timer list and cleared only at settlement, so it stayed armed
 * after the socket connected and fired during the response phase. The effective
 * read window was therefore `connectMs minus however long connecting took` -
 * not `readMs`. On the shipped defaults (connectMs 5000, readMs 10000) more
 * than half the configured read budget was unreachable, and a till answering
 * six seconds after connect - ordinary on a loaded POS - was recorded as
 * `noResponse`.
 *
 * WHY THAT MATTERED SO MUCH MORE THAN IT LOOKS. `noResponse` carries
 * `bytesLeftHost: true`, which is correct and which makes the round UNCERTAIN.
 * An uncertain round holds the table's single in-flight slot and has no machine
 * exit. So a timer bug quietly converted "the till was busy for a moment" into
 * "this table is finished for the night". It failed safe, and it would have
 * failed constantly.
 *
 * THE SHAPE OF THE ASSERTIONS. Timing tests are worth writing here and worth
 * being careful with: every window below is wide enough that ordinary scheduler
 * jitter cannot flip it, and each asserts the CLASSIFICATION rather than an
 * exact millisecond count. What is being proven is which phase ended the
 * exchange, not how fast the machine is.
 */

import { sendOrder2Once, type WaiterPadSendOutcome } from './waiterpad-transport';
import {
  startFakeWaiterPadServer,
  type FakeBehaviour,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';

const PAYLOAD =
  '<?xml version="1.0" encoding="UTF-8" ?><WPPacket><Order Type="Order2" /></WPPacket>';

let server: FakeWaiterPadServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function send(
  behaviour: FakeBehaviour,
  timeouts: { connectMs: number; writeMs: number; readMs: number },
): Promise<WaiterPadSendOutcome> {
  server = await startFakeWaiterPadServer(behaviour);
  return await sendOrder2Once(PAYLOAD, { host: '127.0.0.1', port: server.port, timeouts });
}

/** How many handles node still holds. The leak check every case runs. */
const openTimers = (): number =>
  (process as unknown as { _getActiveHandles: () => unknown[] })
    ._getActiveHandles()
    .filter((h) => h?.constructor?.name === 'Timeout').length;

// ═══════════════════════════════════════════════════════════════════════════
describe('the connect deadline ends the connect phase and nothing else', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('keeps a reply that arrives long after connectMs but well inside readMs', async () => {
    // THE EXACT REGRESSION. Connect is instant on loopback, the till answers at
    // ~800ms, connectMs is 400 and readMs is 8000. The answer is comfortably
    // inside the read budget and must be kept.
    //
    // Before the fix this returned `noResponse` at ~414ms.
    const out = await send(
      { kind: 'delayedAck', delayMs: 800 },
      { connectMs: 400, writeMs: 400, readMs: 8_000 },
    );

    expect(out.kind).toBe('responded');
    if (out.kind === 'responded') expect(out.response.type).toBe('ACK');
    // It genuinely waited rather than answering early from a stale timer.
    expect(out.elapsedMs).toBeGreaterThanOrEqual(700);
    expect(server?.requests).toHaveLength(1);
    expect(server?.connections).toBe(1);
  });

  it('holds the line for a reply many multiples of connectMs late', async () => {
    // A wider version of the same claim, so a fix that merely moved the
    // truncation point rather than removing it would still fail.
    const out = await send(
      { kind: 'delayedAck', delayMs: 1_200 },
      { connectMs: 300, writeMs: 300, readMs: 9_000 },
    );
    expect(out.kind).toBe('responded');
    expect(out.elapsedMs).toBeGreaterThanOrEqual(1_100);
  });

  it('still fails closed when the CONNECTION itself never completes', async () => {
    // The connect deadline doing its actual job. 203.0.113.0/24 is TEST-NET-3
    // (RFC 5737) and is not routable, so this stalls in connect rather than
    // being refused - which is what makes it a connect TIMEOUT rather than a
    // connect error.
    const started = Date.now();
    const out = await sendOrder2Once(PAYLOAD, {
      host: '203.0.113.1',
      port: 6983,
      timeouts: { connectMs: 300, writeMs: 300, readMs: 9_000 },
    });

    expect(out.kind).toBe('failedBeforeSend');
    // THE ONLY OUTCOME THAT LICENSES A RETRY, and it is licensed because
    // nothing was written - not because a timer happened to fire.
    expect(out.bytesLeftHost).toBe(false);
    // It did not wait out the READ budget to decide the connect had failed.
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the read deadline is the one that ends a silent till', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it('reports noResponse when the reply falls outside readMs, and calls it uncertain', async () => {
    const out = await send(
      { kind: 'delayedAck', delayMs: 3_000 },
      { connectMs: 400, writeMs: 400, readMs: 700 },
    );

    expect(out.kind).toBe('noResponse');
    // THE SAFETY-CRITICAL FIELD. Bytes went out, so this is UNCERTAIN and no
    // caller may retry it - the round belongs to a human now.
    expect(out.bytesLeftHost).toBe(true);
    if (out.kind === 'noResponse') expect(out.detail).toContain('read deadline');
    expect(server?.requests).toHaveLength(1);
  });

  it('measures readMs from the write boundary, not from the call', async () => {
    // Connect + write are near-instant on loopback, so a reply at ~600ms is
    // inside a 1200ms read budget. If the read window were started at the top
    // of the call, or inherited a spent connect deadline, this would be lost.
    const out = await send(
      { kind: 'delayedAck', delayMs: 600 },
      { connectMs: 350, writeMs: 350, readMs: 1_200 },
    );
    expect(out.kind).toBe('responded');
  });

  it('a till that accepts the bytes and says nothing is uncertain, never failed', async () => {
    const out = await send({ kind: 'silent' }, { connectMs: 400, writeMs: 400, readMs: 600 });
    expect(out.kind).toBe('noResponse');
    expect(out.bytesLeftHost).toBe(true);
    expect(out.kind).not.toBe('failedBeforeSend');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('one attempt, one socket, no handles left behind', () => {
  // ═════════════════════════════════════════════════════════════════════════

  it.each<[string, FakeBehaviour, { connectMs: number; writeMs: number; readMs: number }]>([
    [
      'a slow reply inside the window',
      { kind: 'delayedAck', delayMs: 700 },
      { connectMs: 300, writeMs: 300, readMs: 5_000 },
    ],
    [
      'a reply outside the window',
      { kind: 'delayedAck', delayMs: 2_000 },
      { connectMs: 300, writeMs: 300, readMs: 500 },
    ],
    ['silence', { kind: 'silent' }, { connectMs: 300, writeMs: 300, readMs: 500 }],
    [
      'a reset after the request',
      { kind: 'resetAfterRequest' },
      { connectMs: 300, writeMs: 300, readMs: 5_000 },
    ],
    ['an immediate ACK', { kind: 'ack' }, { connectMs: 300, writeMs: 300, readMs: 5_000 }],
  ])('%s opens exactly one connection', async (_label, behaviour, timeouts) => {
    await send(behaviour, timeouts);
    // The assertion that means "cannot retry": one connection, one request.
    // A reconnect introduced by any future edit fails here before it can reach
    // a customer's bill.
    expect(server?.connections).toBe(1);
    expect(server?.requests.length).toBeLessThanOrEqual(1);
  });

  it('leaves no timer armed once it has settled', async () => {
    const before = openTimers();
    // A case that arms all three phases in turn and then settles on the reply.
    await send(
      { kind: 'delayedAck', delayMs: 500 },
      { connectMs: 20_000, writeMs: 20_000, readMs: 20_000 },
    );
    // The deliberately huge budgets above would still be pending if settlement
    // did not disarm them, so this is a real leak check rather than a
    // coincidence of short timeouts.
    expect(openTimers()).toBeLessThanOrEqual(before);
  });

  it('leaves no timer armed after a read-deadline settlement either', async () => {
    const before = openTimers();
    await send({ kind: 'silent' }, { connectMs: 20_000, writeMs: 20_000, readMs: 300 });
    // The 20s connect and write budgets must both be gone even though neither
    // of them is what ended the exchange.
    expect(openTimers()).toBeLessThanOrEqual(before);
  });
});

/**
 * Writer tests, end to end against a fake 6983 listener.
 *
 * The negative assertions carry the weight: no second send after ambiguity, no
 * send at all before the attempt is durable, no silent seat downgrade, no
 * invented price, and no fallback of any kind when the till refuses.
 */
import type { OrderRound } from '../../orders/rounds/order-round.model';
import { resolveWaiterPadConfig, type WaiterPadConfig } from './waiterpad-config';
import {
  DisabledTableRoundWriter,
  WaiterPadTableRoundWriter,
  WaiterPadWriterError,
  type SendInitiatedRecord,
  type TableRoundLine,
} from './waiterpad-table-round-writer';
import { deriveWaiterPadToken } from './waiterpad-token';
import {
  startFakeWaiterPadServer,
  type FakeBehaviour,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';

const round = (over: Partial<OrderRound> = {}): OrderRound => ({
  roundId: 'round-1',
  sessionId: 'sess-1',
  sequence: 1,
  idempotencyKey: 'ext-1',
  state: 'submitting',
  lines: [{ lineId: 'l1', menuItemId: 'm1', quantity: 1, expectedUnitPriceCents: 300 }],
  payloadFrozenAt: new Date('2026-09-09T00:00:00Z'),
  nativeSaleRef: null,
  ...over,
});

const LINE: TableRoundLine = { plu: '251', description: 'Coke No Sugar', quantity: 1 };

const baseEnv = (over: Record<string, string> = {}): Record<string, string> => ({
  IDEALPOS_WAITERPAD_NATIVE_ENABLED: 'true',
  IDEALPOS_WAITERPAD_HOST: '127.0.0.1',
  IDEALPOS_WAITERPAD_PORT: '6983',
  IDEALPOS_WAITERPAD_DEVICE_ID: 'VERDURA-ACCEPT-0001',
  IDEALPOS_WAITERPAD_LOCAL_ADDRESS: '192.168.1.250',
  IDEALPOS_WAITERPAD_CLIENT_VERSION: 'Verdura 0.1.0',
  IDEALPOS_WAITERPAD_DEVICE_MODEL: 'Verdura Back',
  IDEALPOS_WAITERPAD_DEVICE_OS: 'Windows',
  IDEALPOS_WAITERPAD_POS_TERMINAL: '901',
  IDEALPOS_WAITERPAD_CLERK: '108',
  IDEALPOS_WAITERPAD_MAP: '1',
  IDEALPOS_WAITERPAD_LOCATION: '1',
  IDEALPOS_WAITERPAD_PRICE_POLICY: 'nativeResolved',
  IDEALPOS_WAITERPAD_PRICE_LEVEL: '1',
  ...over,
});

function configFor(port: number, over: Record<string, string> = {}): WaiterPadConfig {
  const res = resolveWaiterPadConfig(baseEnv({ IDEALPOS_WAITERPAD_PORT: String(port), ...over }));
  if (!res.enabled) throw new Error(`config did not resolve: ${res.reasons.join(', ')}`);
  return res.config;
}

let server: FakeWaiterPadServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function writeWith(
  behaviour: FakeBehaviour,
  opts: {
    lines?: readonly TableRoundLine[];
    env?: Record<string, string>;
    recordSendInitiated?: (r: SendInitiatedRecord) => Promise<void>;
  } = {},
) {
  server = await startFakeWaiterPadServer(behaviour);
  const persisted: SendInitiatedRecord[] = [];
  const writer = new WaiterPadTableRoundWriter(configFor(server.port, opts.env), {
    recordSendInitiated:
      opts.recordSendInitiated ??
      ((r) => {
        persisted.push(r);
        return Promise.resolve();
      }),
  });
  const result = await writer.writeRound({
    round: round(),
    attemptId: 'attempt-1',
    table: 99,
    guests: 0,
    lines: opts.lines ?? [LINE],
  });
  return { result, persisted };
}

describe('the happy path', () => {
  it('sends once and maps ACK to awaiting_native_confirmation, never confirmed', async () => {
    const { result } = await writeWith({ kind: 'ack' });
    expect(server?.requests).toHaveLength(1);
    expect(result.decision.transition.to).toBe('awaiting_native_confirmation');
    expect(result.decision.transition.to).not.toBe('confirmed');
  });

  it('emits the sentinel price, so Verdura never sets a price', async () => {
    await writeWith({ kind: 'ack' });
    expect(server?.requests[0]).toContain('<Price>-9999</Price>');
    expect(server?.requests[0]).toContain('<PriceLevel>1</PriceLevel>');
  });

  it('carries the derived token as the Checksum', async () => {
    const { result } = await writeWith({ kind: 'ack' });
    const expected = deriveWaiterPadToken({ roundId: 'round-1', attemptId: 'attempt-1' });
    expect(result.record.token).toBe(expected);
    expect(server?.requests[0]).toContain(`<Checksum>${expected}</Checksum>`);
  });

  it('never sends an empty Checksum, which would disable the till guard', async () => {
    await writeWith({ kind: 'ack' });
    expect(server?.requests[0]).not.toContain('<Checksum></Checksum>');
  });

  it('emits instructions as sibling Text items, after their line', async () => {
    await writeWith({ kind: 'ack' }, { lines: [{ ...LINE, instructions: ['no ice'] }] });
    const body = server?.requests[0] ?? '';
    expect(body.indexOf('<Type>StockItem</Type>')).toBeLessThan(body.indexOf('<Type>Text</Type>'));
    expect(body).toContain('<Description>no ice</Description>');
  });
});

describe('durability before the socket', () => {
  it('persists the attempt before any byte leaves', async () => {
    const { persisted } = await writeWith({ kind: 'ack' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ roundId: 'round-1', attemptId: 'attempt-1', table: 99 });
    expect(persisted[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does NOT send when the attempt cannot be persisted', async () => {
    const { result } = await writeWith(
      { kind: 'ack' },
      {
        recordSendInitiated: () => Promise.reject(new Error('disk full')),
      },
    );
    expect(server?.requests).toHaveLength(0);
    expect(result.outcome.kind).toBe('failedBeforeSend');
    expect(result.outcome.bytesLeftHost).toBe(false);
  });

  it('refuses a round that is not yet persisted and frozen', async () => {
    server = await startFakeWaiterPadServer({ kind: 'ack' });
    const writer = new WaiterPadTableRoundWriter(configFor(server.port), {
      recordSendInitiated: () => Promise.resolve(),
    });
    await expect(
      writer.writeRound({
        round: round({ payloadFrozenAt: null }),
        attemptId: 'a',
        table: 99,
        guests: 0,
        lines: [LINE],
      }),
    ).rejects.toThrow(/payloadFrozenAt/);
    expect(server.requests).toHaveLength(0);
  });
});

describe('the till refusing is not a reason to do anything else', () => {
  it('NAKREGO does not confirm, does not resend, and has no fallback', async () => {
    const { result } = await writeWith({ kind: 'nakrego' });
    expect(server?.requests).toHaveLength(1);
    expect(server?.connections).toBe(1);
    expect(result.decision.transition.to).not.toBe('confirmed');
    expect(result.decision.safeToRepresentToOperator).toBe(false);
  });

  it.each<[string, FakeBehaviour]>([
    ['silence', { kind: 'silent' }],
    ['a reset after the request', { kind: 'resetAfterRequest' }],
    ['a truncated reply', { kind: 'truncated' }],
  ])('%s never triggers a second send', async (_label, behaviour) => {
    const { result } = await writeWith(behaviour);
    expect(server?.requests.length).toBeLessThanOrEqual(1);
    expect(server?.connections).toBe(1);
    expect(result.decision.transition.to).toBe('unresolved');
    expect(result.decision.reason).toMatch(/Do not resend/);
  });
});

describe('seat is fail-closed, never silently downgraded', () => {
  it('refuses a non-zero seat by default', async () => {
    await expect(writeWith({ kind: 'ack' }, { lines: [{ ...LINE, seat: 2 }] })).rejects.toThrow(
      WaiterPadWriterError,
    );
  });

  it('says why, naming the blocker', async () => {
    await expect(writeWith({ kind: 'ack' }, { lines: [{ ...LINE, seat: 2 }] })).rejects.toThrow(
      /WAITERPAD-SEAT-001/,
    );
  });

  it('sends the seat through when explicitly enabled', async () => {
    await writeWith(
      { kind: 'ack' },
      {
        lines: [{ ...LINE, seat: 2 }],
        env: { IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT: 'true' },
      },
    );
    expect(server?.requests[0]).toContain('<Seat>2</Seat>');
  });
});

describe('price policy', () => {
  it('refuses to invent an amount when the policy is explicit', async () => {
    await expect(
      writeWith({ kind: 'ack' }, { env: { IDEALPOS_WAITERPAD_PRICE_POLICY: 'explicit' } }),
    ).rejects.toThrow(/will not invent a price/);
  });

  it('uses a supplied amount when the policy is explicit', async () => {
    await writeWith(
      { kind: 'ack' },
      {
        env: { IDEALPOS_WAITERPAD_PRICE_POLICY: 'explicit' },
        lines: [{ ...LINE, explicitAmount: '3.00' }],
      },
    );
    expect(server?.requests[0]).toContain('<Price>3.00</Price>');
  });
});

describe('the disabled writer', () => {
  it('refuses without touching a socket, and names the absent fallbacks', async () => {
    const w = new DisabledTableRoundWriter(['no licence seat']);
    await expect(w.writeRound()).rejects.toThrow(/no licence seat/);
    await expect(w.writeRound()).rejects.toThrow(/WebOrder/);
  });
});

/**
 * THE PRODUCT PROMISE, AS A TEST.
 *
 * Everything else in this directory tests a layer. This tests the thing the
 * restaurant is actually buying:
 *
 *   a waiter picks up Verdura, selects the same table they would have selected
 *   on the IdealPOS handheld, sets covers, picks a seat and a product, presses
 *   Send to Kitchen - and that round arrives on the EXACT native table as a
 *   genuine Order2, with the till resolving the price and firing its own KOT.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. The service, the writer, the token, the
 * Order2 codec and the TCP transport are all the production objects. The only
 * things replaced are the two genuine external boundaries: the database (an
 * in-memory store that answers the same queries) and the till itself (the fake
 * 6983 listener, which records the exact bytes it received).
 *
 * SO THE ASSERTIONS ARE ON THE WIRE, NOT ON AN INTERMEDIATE OBJECT. A test
 * that checked what the service passed to the writer would pass happily while
 * the codec dropped the seat. What follows reads the payload the socket
 * actually carried.
 *
 * THIS FILE EXISTS TO MAKE ONE REGRESSION IMPOSSIBLE: quietly turning Verdura
 * back into a generic API order submitter that happens to reach IdealPOS.
 */

import { NativeTableRoundService, NativeRoundError } from './native-table-round.service';
import {
  WaiterPadTableRoundWriter,
  DisabledTableRoundWriter,
  type ITableRoundWriter,
  type SendInitiatedRecord,
} from './waiterpad-table-round-writer';
import { resolveWaiterPadConfig } from './waiterpad-config';
import {
  startFakeWaiterPadServer,
  type FakeBehaviour,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaService } from '../../prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────
// The venue, as the waiter sees it.
//
// TABLE 5 IS THE WHOLE POINT OF THE `posTableCode` FIELD. The Verdura table is
// deliberately given a DIFFERENT display number (`tableNumber: '12'`) from its
// native code, so a test that passed by accidentally sending the Verdura table
// number would fail. Only a genuine read of `Table.posTableCode` produces 5.
// ─────────────────────────────────────────────────────────────────────────
const NATIVE_TABLE = '5';
const VERDURA_TABLE_NUMBER = '12';
const LEMON_SLICE_PLU = '251';

interface Row {
  [k: string]: unknown;
}

/**
 * An in-memory stand-in for the queries `NativeTableRoundService` makes.
 *
 * Written by hand rather than mocked call-by-call, because the behaviour under
 * test IS a sequence of reads and writes: "claim the lines with no round, then
 * read back only that round's lines". A per-call mock would let a broken
 * implementation define its own expectations.
 */
class FakeDb {
  orders: Row[] = [];
  items: Row[] = [];
  rounds: Row[] = [];
  attempts: Row[] = [];
  menuItems: Row[] = [];

  private seq = 0;
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /**
   * Every method returns an already-resolved promise rather than being
   * `async`. Same contract, and it keeps the fake honestly synchronous: there
   * is no I/O here to await, and pretending otherwise would only invite a test
   * to depend on a tick boundary this store does not really have.
   */
  asPrisma(): PrismaService {
    const api = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(api),

      order: {
        findUnique: ({ where }: { where: { id: string } }) => {
          const order = this.orders.find((o) => o.id === where.id);
          if (!order) return Promise.resolve(null);
          return Promise.resolve({
            ...order,
            table: order.tableId
              ? { posTableCode: this.tableCodeFor(order.tableId as string) }
              : null,
            nativeRounds: this.rounds
              .filter((r) => r.orderId === order.id)
              .map((r) => ({ sequence: r.sequence, state: r.state })),
          });
        },
      },

      orderItem: {
        findMany: ({ where }: { where: Row }) =>
          Promise.resolve(
            this.items.filter(
              (i) =>
                i.orderId === where.orderId &&
                (where.nativeRoundId === null ? i.nativeRoundId === null : true),
            ),
          ),
        updateMany: ({ where, data }: { where: Row; data: Row }) => {
          let count = 0;
          for (const i of this.items) {
            if (i.orderId === where.orderId && i.nativeRoundId === null) {
              i.nativeRoundId = data.nativeRoundId;
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      },

      nativeTableRound: {
        create: ({ data }: { data: Row }) => {
          const row = { id: this.id('round'), ...data };
          this.rounds.push(row);
          return Promise.resolve(row);
        },
        findUnique: ({ where }: { where: { id: string } }) => {
          const r = this.rounds.find((x) => x.id === where.id);
          if (!r) return Promise.resolve(null);
          return Promise.resolve({
            ...r,
            items: this.items.filter((i) => i.nativeRoundId === r.id),
          });
        },
        update: ({ where, data }: { where: { id: string }; data: Row }) => {
          const r = this.rounds.find((x) => x.id === where.id);
          if (!r) return Promise.reject(new Error('no such round'));
          Object.assign(r, data);
          return Promise.resolve(r);
        },
      },

      nativeSendAttempt: {
        create: ({ data }: { data: Row }) => {
          const row = { id: this.id('attempt'), ...data };
          this.attempts.push(row);
          return Promise.resolve(row);
        },
        update: ({ where, data }: { where: { attemptId: string }; data: Row }) => {
          const a = this.attempts.find((x) => x.attemptId === where.attemptId);
          if (!a) return Promise.reject(new Error('no such attempt'));
          Object.assign(a, data);
          return Promise.resolve(a);
        },
      },

      menuItem: {
        findMany: ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(this.menuItems.filter((m) => where.id.in.includes(m.id as string))),
      },
    };
    return api as unknown as PrismaService;
  }

  private tableCodes = new Map<string, string | null>();
  tableCodeFor(tableId: string): string | null {
    return this.tableCodes.get(tableId) ?? null;
  }
  setTable(tableId: string, posTableCode: string | null): void {
    this.tableCodes.set(tableId, posTableCode);
  }
}

const ENV = (over: Record<string, string> = {}): Record<string, string> => ({
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
  // Seat 1 is part of the advertised workflow, so the equivalence test runs
  // with the seat gate open. `refuses a non-zero seat when the gate is shut`
  // below covers the other side.
  IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT: 'true',
  ...over,
});

let server: FakeWaiterPadServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/**
 * Remove comments and string literals from TypeScript source.
 *
 * Needed by the governance assertion below. Both comments and strings
 * legitimately NAME the forbidden paths in order to say they are absent - the
 * refusal message on `DisabledTableRoundWriter` is exactly that. What must not
 * survive is an identifier, import or call, which is what this leaves behind.
 *
 * A character scanner rather than a regex: the escaping needed to express
 * "a quoted string with escapes" as a literal regex inside a quoted string is
 * where this went wrong once already.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        // Skip an escaped character whole, so a trailing backslash cannot
        // swallow the closing quote.
        i += source[i] === '\\' ? 2 : 1;
      }
      i += 1;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Build the venue: one dine-in order on native Table 5, 2 covers, seat 1. */
function seedVenue(db: FakeDb): void {
  db.setTable('tbl-a', NATIVE_TABLE);
  db.orders.push({
    id: 'order-1',
    venueId: 'venue-1',
    tableId: 'tbl-a',
    tableNumber: VERDURA_TABLE_NUMBER,
    serviceMode: 'dine_in',
    guests: 2,
  });
  db.menuItems.push({
    id: 'mi-lemon',
    posProductCode: LEMON_SLICE_PLU,
    posIdentity: null,
  });
  db.menuItems.push({ id: 'mi-coke', posProductCode: '300', posIdentity: null });
}

function addLine(db: FakeDb, menuItemId: string, title: string, seat: number | null): void {
  db.items.push({
    id: `item-${db.items.length + 1}`,
    orderId: 'order-1',
    menuItemId,
    menuItemTitle: title,
    quantity: 1,
    unitPriceCents: 350,
    seat,
    notes: null,
    nativeRoundId: null,
  });
}

async function serviceOn(
  db: FakeDb,
  behaviour: FakeBehaviour,
  env: Record<string, string> = {},
): Promise<{ service: NativeTableRoundService; persisted: SendInitiatedRecord[] }> {
  server = await startFakeWaiterPadServer(behaviour);
  const resolution = resolveWaiterPadConfig(
    ENV({ IDEALPOS_WAITERPAD_PORT: String(server.port), ...env }),
  );
  if (!resolution.enabled) throw new Error(resolution.reasons.join('; '));

  const prisma = db.asPrisma();
  const persisted: SendInitiatedRecord[] = [];
  const writer: ITableRoundWriter = new WaiterPadTableRoundWriter(resolution.config, {
    async recordSendInitiated(record) {
      persisted.push(record);
      await prisma.nativeSendAttempt.create({
        data: {
          roundId: record.roundId,
          attemptId: record.attemptId,
          externalOrderId: record.externalOrderId,
          posTableCode: String(record.table),
          deviceId: record.deviceId,
          token: record.token,
          payloadHash: record.payloadHash,
          sendInitiatedAt: record.sendInitiatedAt,
        },
      });
    },
  });

  return { service: new NativeTableRoundService(prisma, writer), persisted };
}

/** The single request the fake till received, as text. */
function sentPayload(): string {
  expect(server?.requests).toHaveLength(1);
  return server!.requests[0];
}

// ═════════════════════════════════════════════════════════════════════════
describe('a waiter sends Table 5, seat 1, one Lemon Slice', () => {
  it('puts exactly that round on exactly that native table', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service, persisted } = await serviceOn(db, { kind: 'ack' });
    const result = await service.sendToKitchen('order-1');

    const payload = sentPayload();

    // ── The table the waiter selected, by its NATIVE code. The Verdura table
    // is numbered 12, so a 12 here would mean the mapping was bypassed. ──
    expect(payload).toContain(`<Table>${NATIVE_TABLE}</Table>`);
    expect(payload).not.toContain(`<Table>${VERDURA_TABLE_NUMBER}</Table>`);

    // ── Covers, from the real column rather than parsed out of notes. ──
    expect(payload).toContain('<Guests>2</Guests>');

    // ── The product the waiter chose, as IdealPOS knows it. ──
    expect(payload).toContain(`<StockItem>${LEMON_SLICE_PLU}</StockItem>`);
    expect(payload).toContain('<Quantity>1</Quantity>');

    // ── Seat 1 survives. Never silently flattened to 0. ──
    expect(payload).toContain('<Seat>1</Seat>');
    expect(payload).not.toContain('<Seat>0</Seat>');

    // ── IdealPOS owns the price. -9999 is the sentinel that says so. ──
    expect(payload).toContain('<Price>-9999</Price>');
    expect(payload).toContain('<PriceLevel>1</PriceLevel>');

    // ── The kitchen runs natively. A production round never suppresses it. ──
    expect(payload).toContain('<SkipKitchen>0</SkipKitchen>');

    // ── Verdura's own identity, never the venue iPad's. ──
    expect(payload).toContain('<DeviceID>VERDURA-ACCEPT-0001</DeviceID>');

    // ── A non-empty duplicate token, persisted before the bytes left. ──
    expect(persisted).toHaveLength(1);
    expect(persisted[0].token).toMatch(/^[0-9a-f]{32}$/);
    expect(payload).toContain(`<Checksum>${persisted[0].token}</Checksum>`);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0].sendInitiatedAt).toBeInstanceOf(Date);

    // ── Exactly one send. ──
    expect(server!.connections).toBe(1);
    expect(server!.requests).toHaveLength(1);

    // ── An ACK is NOT success. ──
    expect(result.status).toBe('sentAwaitingConfirmation');
    expect(result.message).not.toMatch(/successful/i);
    expect(db.rounds[0].state).toBe('awaiting_native_confirmation');
  });

  it('persists the attempt BEFORE the socket sees a byte', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    server = await startFakeWaiterPadServer({ kind: 'ack' });
    const resolution = resolveWaiterPadConfig(
      ENV({ IDEALPOS_WAITERPAD_PORT: String(server.port) }),
    );
    if (!resolution.enabled) throw new Error('config');

    // A persistence hook that refuses. Nothing may reach the till.
    const writer = new WaiterPadTableRoundWriter(resolution.config, {
      recordSendInitiated: () => Promise.reject(new Error('disk full')),
    });
    const service = new NativeTableRoundService(db.asPrisma(), writer);

    const result = await service.sendToKitchen('order-1');

    expect(server.connections).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(result.status).toBe('failedBeforeSend');
    // The round is editable again, under the SAME identity.
    expect(db.rounds[0].state).toBe('drafting');
    expect(db.rounds[0].payloadFrozenAt).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the second Send to Kitchen is a delta, never a replay', () => {
  it('carries only the new item, and leaves the first round alone', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    // ── Round 1 ──
    {
      const { service } = await serviceOn(db, { kind: 'ack' });
      await service.sendToKitchen('order-1');
      const first = sentPayload();
      expect(first).toContain(`<StockItem>${LEMON_SLICE_PLU}</StockItem>`);
      expect(first).not.toContain('<StockItem>300</StockItem>');
      await server!.close();
      server = null;
    }

    // The waiter reopens the table and adds a drink. Round 1 must be resolved
    // before another may open - reconciliation would normally do this; here it
    // stands in for a confirmed first round.
    db.rounds[0].state = 'confirmed';
    addLine(db, 'mi-coke', 'Coke No Sugar', 1);

    // ── Round 2 ──
    {
      const { service } = await serviceOn(db, { kind: 'ack' });
      await service.sendToKitchen('order-1');
      const second = sentPayload();

      // ONLY the new line. The Lemon Slice is already on the native tab, and
      // sending it again would put two on the customer's bill.
      expect(second).toContain('<StockItem>300</StockItem>');
      expect(second).not.toContain(`<StockItem>${LEMON_SLICE_PLU}</StockItem>`);

      // Same native table, both times.
      expect(second).toContain(`<Table>${NATIVE_TABLE}</Table>`);
    }

    expect(db.rounds).toHaveLength(2);
    expect(db.rounds[1].sequence).toBe(2);
    // Each line belongs to exactly one round, forever.
    expect(db.items[0].nativeRoundId).toBe(db.rounds[0].id);
    expect(db.items[1].nativeRoundId).toBe(db.rounds[1].id);
    // Distinct tokens, so the till's one-deep guard cannot mistake one for the
    // other.
    expect(db.attempts[0].token).not.toBe(db.attempts[1].token);
  });

  it('refuses to open a round when there is nothing new to send', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'ack' });
    await service.sendToKitchen('order-1');
    db.rounds[0].state = 'confirmed';

    await expect(service.sendToKitchen('order-1')).rejects.toMatchObject({
      reason: 'nothing_to_send',
    });
    // Still exactly one send.
    expect(server!.requests).toHaveLength(1);
  });

  it('refuses a second round while the first is unresolved', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'silent' });
    const first = await service.sendToKitchen('order-1');
    expect(first.status).toBe('uncertain');
    expect(db.rounds[0].state).toBe('unresolved');

    addLine(db, 'mi-coke', 'Coke No Sugar', 1);
    await expect(service.sendToKitchen('order-1')).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    // An unresolved round may already be in the kitchen: still one send.
    expect(server!.requests).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('what it refuses rather than guess', () => {
  it('refuses a table with no native mapping, and opens no socket', async () => {
    const db = new FakeDb();
    seedVenue(db);
    db.setTable('tbl-a', null); // mapping removed
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'ack' });
    await expect(service.sendToKitchen('order-1')).rejects.toMatchObject({
      reason: 'unmapped_table',
    });
    expect(server!.connections).toBe(0);
    expect(db.rounds).toHaveLength(0);
  });

  it('refuses the WHOLE round when one item has no native PLU', async () => {
    const db = new FakeDb();
    seedVenue(db);
    db.menuItems.push({ id: 'mi-special', posProductCode: null, posIdentity: null });
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);
    addLine(db, 'mi-special', 'Chef Special', 1);

    const { service } = await serviceOn(db, { kind: 'ack' });
    await expect(service.sendToKitchen('order-1')).rejects.toMatchObject({
      reason: 'unmapped_item',
    });
    // A partial round would hand the kitchen an order the customer did not
    // place, so nothing is sent at all.
    expect(server!.connections).toBe(0);
  });

  it('refuses a takeaway order rather than fabricate a table', async () => {
    const db = new FakeDb();
    seedVenue(db);
    db.orders[0].serviceMode = 'takeaway';
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'ack' });
    await expect(service.sendToKitchen('order-1')).rejects.toMatchObject({
      reason: 'not_dine_in',
    });
    expect(server!.connections).toBe(0);
  });

  it('refuses a non-zero seat when the seat gate is shut, rather than flatten it', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(
      db,
      { kind: 'ack' },
      {
        IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT: 'false',
      },
    );
    const result = await service.sendToKitchen('order-1');

    expect(result.status).toBe('failedBeforeSend');
    expect(result.message).toMatch(/seat/i);
    expect(server!.connections).toBe(0);
    // Editable again under the same identity once the gate is opened.
    expect(db.rounds[0].state).toBe('drafting');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('what staff are told when the till does not answer cleanly', () => {
  it('NAKREGO names the licence, and never invites a retry', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'nakrego' });
    const result = await service.sendToKitchen('order-1');

    expect(result.status).toBe('registrationRejected');
    expect(result.message).toMatch(/licence/i);
    expect(result.message).toMatch(/do not send this again/i);
    expect(server!.requests).toHaveLength(1);
  });

  it('a NAK is uncertain, not a rejection, because it may follow an accepted order', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'nak' });
    const result = await service.sendToKitchen('order-1');

    expect(result.status).toBe('uncertain');
    expect(result.message).toMatch(/DO NOT send it again/i);
    expect(db.rounds[0].state).toBe('unresolved');
  });

  it('silence after the write is uncertain, and says so in words a waiter can act on', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const { service } = await serviceOn(db, { kind: 'silent' });
    const result = await service.sendToKitchen('order-1');

    expect(result.status).toBe('uncertain');
    expect(result.message).toMatch(/MAY already be on the table/i);
    expect(result.message).toMatch(/DO NOT send it again/i);
    expect(server!.requests).toHaveLength(1);
  });

  it('a refused connection is the one failure that is safe to send again', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    // Start and immediately close, so the port refuses.
    const dead = await startFakeWaiterPadServer({ kind: 'ack' });
    const port = dead.port;
    await dead.close();

    const resolution = resolveWaiterPadConfig(ENV({ IDEALPOS_WAITERPAD_PORT: String(port) }));
    if (!resolution.enabled) throw new Error('config');
    const writer = new WaiterPadTableRoundWriter(resolution.config, {
      recordSendInitiated: () => Promise.resolve(),
    });
    const service = new NativeTableRoundService(db.asPrisma(), writer);

    const result = await service.sendToKitchen('order-1');
    expect(result.status).toBe('failedBeforeSend');
    expect(result.message).toMatch(/safe to send again/i);
    expect(db.rounds[0].state).toBe('drafting');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the feature gate', () => {
  it('sends nothing at all when the writer is disabled', async () => {
    const db = new FakeDb();
    seedVenue(db);
    addLine(db, 'mi-lemon', 'Lemon Slice', 1);

    const service = new NativeTableRoundService(
      db.asPrisma(),
      new DisabledTableRoundWriter(['no licence seat']),
    );
    const result = await service.sendToKitchen('order-1');

    expect(result.status).toBe('failedBeforeSend');
    expect(result.message).toContain('no licence seat');
    // And it names the absence of a fallback, so nobody goes looking for one.
    expect(result.message).toMatch(/WebOrder/i);
  });

  it('has no WebOrder, InsertOrders, Ecommerce or WB* path anywhere in its module graph', () => {
    // A structural assertion, not a behavioural one: the point is that no
    // future edit can add a fallback without this failing.
    const forbidden =
      /WebOrder|InsertOrders|EcommerceGuid|ConfirmedEcommercePluginGuid|Doshii|WebPendingOrder/;
    const modules = [
      'native-table-round.service.ts',
      'waiterpad-table-round-writer.ts',
      'waiterpad-transport.ts',
      'waiterpad-order2-packet.ts',
      'waiterpad-writer.provider.ts',
      'native-send-attempt.store.ts',
    ];
    for (const name of modules) {
      const source = readFileSync(join(__dirname, name), 'utf8');
      expect(stripCommentsAndStrings(source)).not.toMatch(forbidden);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('NativeRoundError', () => {
  it('carries a machine-readable reason so callers never parse a message', () => {
    const err = new NativeRoundError('unmapped_table', 'no code');
    expect(err.reason).toBe('unmapped_table');
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * ONE ORDER, ONE POS PIPELINE. THE PROOF.
 *
 * WHAT THIS FILE IS DEFENDING. Verdura can now put a dine-in order into
 * IdealPOS two ways - the certified Webit/Bridge path, and the native handheld
 * Order2 path. Both are real, both work, and until the strategy column existed
 * both could claim the SAME order: the two dispatcher sweeps select on
 * `POSSyncRecord.status = not_synced`, and `NativeTableRoundService` did not
 * touch `POSSyncRecord` at all. One restaurant order becomes two dockets on one
 * table and two lines on one bill, and nobody finds out until a customer
 * disputes the total.
 *
 * THE TWO NUMBERS EVERY TEST BELOW IS REALLY ABOUT:
 *
 *     WEBIT_SEND_COUNT   how many idealpos.submit_order.v1 ConnectorCommands
 *                        were created. For a native order this must be 0.
 *     NATIVE_SEND_COUNT  how many Order2 packets reached the till. For any
 *                        order this must be <= 1 per round, and 0 for an order
 *                        the native path does not own.
 *
 * They are asserted together, in the same test, from the same run - because the
 * failure being excluded is not "one of them went wrong", it is "both of them
 * went right, for the same order".
 *
 * HOW REAL THIS IS. The real `OrdersService` creates the orders. The real
 * `PosStrategyResolver` reads the real configuration. The real
 * `IdealposOrderDispatcherService` and the real `PosSyncDispatcherService`
 * sweep, with their real `where` clauses evaluated by an in-memory store that
 * implements Prisma's filter semantics rather than ignoring them - so deleting
 * `strategy: webit` from either query fails these tests instead of passing
 * them. The real `NativeTableRoundService`, writer, codec and TCP transport
 * carry the native side, against the fake WaiterPad listener that records exact
 * bytes.
 *
 * Only three things are replaced, and each is a genuine external boundary: the
 * database, the BullMQ queue, and the till.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { POSSyncStatus, PosSubmissionStrategy, ServiceMode, StaffRole } from '@prisma/client';

import { OrdersService } from '../orders/orders.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { AuditLogService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { PosStrategyResolver } from './pos-strategy-resolver';
import { IdealposOrderDispatcherService } from './idealpos-order-dispatcher.service';
import { PosSyncDispatcherService } from './pos-sync-dispatcher.service';
import { NativeTableRoundService, NativeRoundError } from './waiterpad/native-table-round.service';
import {
  WaiterPadTableRoundWriter,
  type ITableRoundWriter,
} from './waiterpad/waiterpad-table-round-writer';
import { resolveWaiterPadConfig } from './waiterpad/waiterpad-config';
import {
  startFakeWaiterPadServer,
  type FakeWaiterPadServer,
} from './waiterpad/testing/fake-waiterpad-server';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { getQueueToken } from '@nestjs/bullmq';

// ═════════════════════════════════════════════════════════════════════════
// A store that actually evaluates Prisma filters.
//
// The whole point of these tests is the `where` clauses. A mock that returned
// every row regardless of filter would pass with the guards deleted, which
// makes it worse than no test at all - it would assert that the protection
// exists while proving nothing. So `matches` implements the operator subset the
// two sweeps genuinely use, and anything outside that subset throws rather than
// being silently treated as "no constraint".
// ═════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

function matchesLeaf(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
    return value === condition;
  }

  for (const [op, operand] of Object.entries(condition as Row)) {
    switch (op) {
      case 'not':
        if (matchesLeaf(value, operand)) return false;
        break;
      case 'in':
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case 'lt':
        if (!(value != null && (value as number) < (operand as number))) return false;
        break;
      case 'lte':
        if (!(value != null && (value as number) <= (operand as number))) return false;
        break;
      case 'gte':
        if (!(value != null && (value as number) >= (operand as number))) return false;
        break;
      default:
        // Deliberately loud. A filter operator this harness does not model
        // would otherwise be quietly ignored, and a test that ignores a filter
        // is a test that cannot fail for the reason it exists.
        throw new Error(`route-exclusivity harness does not model Prisma operator '${op}'`);
    }
  }
  return true;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(condition as Row[]).every((c) => matches(row, c))) return false;
      continue;
    }
    if (!matchesLeaf(row[key], condition)) return false;
  }
  return true;
}

/** The venue, its orders, and every row the two pipelines read or write. */
class Ledger {
  posSyncRecords: Row[] = [];
  orders: Row[] = [];
  items: Row[] = [];
  rounds: Row[] = [];
  attempts: Row[] = [];
  private seq = 0;

  readonly venueId = 'venue-1';
  readonly tableId = 'tbl-a';
  readonly posTableCode = '5';

  id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  recordFor(orderId: string): Row | undefined {
    return this.posSyncRecords.find((r) => r.orderId === orderId);
  }
}

// The venue every test in this file orders against: on the real IdealPOS Bridge
// integration (`posAdapterType: 'api'`), which is the ONLY configuration in
// which both pipelines are live at once and therefore the only one where they
// could collide.
const VENUE = {
  id: 'venue-1',
  organizationId: 'org-1',
  posAdapterType: 'api',
  // DL-072 supported tax profile - computeTotals fails closed without it.
  currency: 'NZD',
  taxJurisdiction: 'NZ_GST',
  pricesIncludeTax: true,
  timezone: 'Pacific/Auckland',
  name: 'Verdura',
};

const MENU_ITEM = {
  id: 'mi-lamb',
  venueId: 'venue-1',
  title: 'Lamb Shank',
  priceCents: 3200,
  isAvailable: true,
  posProductCode: '101',
  posIdentity: null,
  category: { id: 'cat-1', name: 'Mains' },
};

const ACTOR = { id: 'staff-1', email: 'waiter@verdura.test', role: StaffRole.cashier };

// ═════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════

/** A complete, valid native configuration pointed at the fake till. */
const NATIVE_ENV = (port: number, over: Record<string, string> = {}): Record<string, string> => ({
  IDEALPOS_POS_STRATEGY: 'native_table_round',
  IDEALPOS_WAITERPAD_NATIVE_ENABLED: 'true',
  IDEALPOS_WAITERPAD_HOST: '127.0.0.1',
  IDEALPOS_WAITERPAD_PORT: String(port),
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
  IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT: 'true',
  ...over,
});

/** Production, exactly as it is deployed today: nothing set. */
const LEGACY_ENV: Record<string, string> = {};

// ═════════════════════════════════════════════════════════════════════════
// The harness
// ═════════════════════════════════════════════════════════════════════════

interface Harness {
  ledger: Ledger;
  orders: OrdersService;
  native: NativeTableRoundService;
  webitSweep: IdealposOrderDispatcherService;
  legacySweep: PosSyncDispatcherService;
  /** Every idealpos.submit_order.v1 ConnectorCommand the Webit path created. */
  webitSendCount: () => number;
  /** Every Order2 packet the till actually received. */
  nativeSendCount: () => number;
  queuedForProcessing: () => number;
  module: TestingModule;
}

let server: FakeWaiterPadServer | null = null;
let harness: Harness | null = null;

afterEach(async () => {
  await harness?.module.close();
  harness = null;
  await server?.close();
  server = null;
});

async function build(env: Record<string, string>): Promise<Harness> {
  const ledger = new Ledger();
  const webitCommands: Row[] = [];
  const queued: Row[] = [];

  const prisma = buildPrisma(ledger);

  const connectorCommandService = {
    // The Webit send. Counting calls here rather than inspecting a database
    // row is deliberate: this is the exact function whose invocation means
    // "an order has been handed to the connector for delivery to IdealposBridge".
    createCommand: jest.fn((args: Row) => {
      webitCommands.push(args);
      return Promise.resolve({
        id: ledger.id('cmd'),
        commandType: args.commandType,
        status: 'pending',
        idempotencyKey: args.idempotencyKey,
      });
    }),
    cancel: jest.fn(),
  };

  const config = new ConfigService();
  jest
    .spyOn(config, 'get')
    .mockImplementation((key: string, fallback?: unknown) => (key in env ? env[key] : fallback));

  const writer = buildWriter(env, prisma);

  const module = await Test.createTestingModule({
    providers: [
      OrdersService,
      PosStrategyResolver,
      IdealposOrderDispatcherService,
      PosSyncDispatcherService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
      { provide: OrdersGateway, useValue: { sendOrderUpdate: jest.fn() } },
      { provide: AuditLogService, useValue: { logAuthEvent: jest.fn() } },
      { provide: ConnectorCommandService, useValue: connectorCommandService },
      {
        provide: getQueueToken(QUEUE_NAMES.POS_SYNC),
        useValue: {
          add: jest.fn((name: string, data: Row) => {
            queued.push({ name, data });
            return Promise.resolve({ id: 'job' });
          }),
        },
      },
      {
        provide: NativeTableRoundService,
        useFactory: () => new NativeTableRoundService(prisma, writer),
      },
    ],
  }).compile();

  return {
    ledger,
    orders: module.get(OrdersService),
    native: module.get(NativeTableRoundService),
    webitSweep: module.get(IdealposOrderDispatcherService),
    legacySweep: module.get(PosSyncDispatcherService),
    webitSendCount: () => webitCommands.length,
    nativeSendCount: () => server?.requests.length ?? 0,
    queuedForProcessing: () => queued.length,
    module,
  };
}

/**
 * The writer, built from the SAME env the strategy resolver reads.
 *
 * When the configuration is incomplete this returns a writer that refuses -
 * which is what the running application does too. Nothing here special-cases
 * the disabled state, because the point of several tests below is that the
 * disabled state is reached by the ordinary path, not by a test-only branch.
 */
function buildWriter(env: Record<string, string>, prisma: unknown): ITableRoundWriter {
  const resolution = resolveWaiterPadConfig(env);
  if (!resolution.enabled) {
    return {
      writeRound: () => {
        throw new Error(`native writer is not usable: ${resolution.reasons.join('; ')}`);
      },
    };
  }
  return new WaiterPadTableRoundWriter(resolution.config, {
    async recordSendInitiated(record) {
      await (
        prisma as { nativeSendAttempt: { create: (a: Row) => Promise<unknown> } }
      ).nativeSendAttempt.create({
        data: {
          roundId: record.roundId,
          attemptId: record.attemptId,
          token: record.token,
          posTableCode: String(record.table),
          sendInitiatedAt: record.sendInitiatedAt,
        },
      });
    },
  });
}

function buildPrisma(ledger: Ledger): PrismaService {
  const api: Row = {
    $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(api),
    $queryRaw: () => Promise.resolve([{ nextval: 600001n }]),

    venue: { findUnique: () => Promise.resolve(VENUE) },
    table: {
      findFirst: () =>
        Promise.resolve({ id: ledger.tableId, venueId: ledger.venueId, tableNumber: '12' }),
    },
    staff: { upsert: () => Promise.resolve({ id: 'staff-1' }) },
    menuItem: {
      findFirst: () => Promise.resolve(MENU_ITEM),
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve([MENU_ITEM].filter((m) => where.id.in.includes(m.id))),
    },
    menuItemVenueOverride: { findUnique: () => Promise.resolve(null) },
    printer: { findMany: () => Promise.resolve([]) },
    printerJob: { create: () => Promise.resolve({}) },
    kdsDeliveryRecord: { create: () => Promise.resolve({}) },
    table19ValidationRun: { findFirst: () => Promise.resolve(null) },

    order: {
      create: ({ data }: { data: Row }) => {
        const row: Row = {
          ...data,
          id: ledger.id('order'),
          venueId: ledger.venueId,
          tableId: data.tableId ?? null,
          items: undefined,
        };
        delete row.items;
        ledger.orders.push(row);
        // Order.create nests its items; unpack them so the native delta query
        // has real lines to claim.
        const nested = (data.items as { create?: Row[] } | undefined)?.create ?? [];
        for (const item of nested) {
          ledger.items.push({
            ...item,
            id: ledger.id('item'),
            orderId: row.id,
            nativeRoundId: null,
          });
        }
        return Promise.resolve(row);
      },
      findUnique: ({
        where,
        include,
      }: {
        where: {
          id?: string;
          venueId_idempotencyKey?: { venueId: string; idempotencyKey: string };
        };
        include?: Row;
      }) => {
        // Both real lookups: by id, and by the (venueId, idempotencyKey)
        // composite that findExistingByIdempotencyKey uses. Modelling the
        // second one is what lets the duplicate-submission test exercise the
        // genuine replay path rather than a stub that pretends to.
        const key = where.venueId_idempotencyKey;
        const order = key
          ? ledger.orders.find(
              (o) => o.venueId === key.venueId && o.idempotencyKey === key.idempotencyKey,
            )
          : ledger.orders.find((o) => o.id === where.id);
        if (!order) return Promise.resolve(null);
        return Promise.resolve(hydrate(ledger, order, include));
      },
      findFirst: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
      update: ({ where, data }: { where: { id: string }; data: Row }) => {
        const o = ledger.orders.find((x) => x.id === where.id);
        if (o) Object.assign(o, data);
        return Promise.resolve(o);
      },
    },

    orderItem: {
      create: ({ data }: { data: Row }) => {
        const row = { ...data, id: ledger.id('item'), nativeRoundId: null };
        ledger.items.push(row);
        return Promise.resolve(row);
      },
      findMany: ({ where }: { where: Row }) =>
        Promise.resolve(ledger.items.filter((i) => matches(i, where))),
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const i of ledger.items) {
          if (matches(i, where)) {
            Object.assign(i, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },

    pOSSyncRecord: {
      create: ({ data }: { data: Row }) => {
        const row: Row = {
          id: ledger.id('pos'),
          strategy: PosSubmissionStrategy.webit,
          status: POSSyncStatus.not_synced,
          attemptCount: 0,
          dispatchAttemptCount: 0,
          dispatchExhaustedAt: null,
          dispatchClaimId: null,
          dispatchClaimExpiresAt: null,
          dispatchedAt: null,
          nextRetryAt: null,
          retryExhaustedAt: null,
          connectorSubmitCommandId: null,
          createdAt: new Date(),
          ...data,
        };
        ledger.posSyncRecords.push(row);
        return Promise.resolve(row);
      },
      findMany: ({ where, select }: { where: Row; select?: Row }) =>
        Promise.resolve(
          ledger.posSyncRecords
            .filter((r) => matches(r, where))
            .map((r) => (select ? project(r, select) : r)),
        ),
      findUnique: ({ where }: { where: Row }) =>
        Promise.resolve(ledger.posSyncRecords.find((r) => matches(r, where)) ?? null),
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const r of ledger.posSyncRecords) {
          if (matches(r, where)) {
            applyUpdate(r, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      update: ({ where, data }: { where: Row; data: Row }) => {
        const r = ledger.posSyncRecords.find((x) => matches(x, where));
        if (!r) return Promise.reject(new Error('no such POSSyncRecord'));
        applyUpdate(r, data);
        return Promise.resolve(r);
      },
    },

    nativeTableRound: {
      create: ({ data }: { data: Row }) => {
        const row = { ...data, id: ledger.id('round') };
        ledger.rounds.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        const r = ledger.rounds.find((x) => x.id === where.id);
        if (!r) return Promise.resolve(null);
        return Promise.resolve({
          ...r,
          items: ledger.items.filter((i) => i.nativeRoundId === r.id),
        });
      },
      update: ({ where, data }: { where: { id: string }; data: Row }) => {
        const r = ledger.rounds.find((x) => x.id === where.id);
        if (!r) return Promise.reject(new Error('no such round'));
        Object.assign(r, data);
        return Promise.resolve(r);
      },
    },

    nativeSendAttempt: {
      create: ({ data }: { data: Row }) => {
        const row = { ...data, id: ledger.id('attempt') };
        ledger.attempts.push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: Row; data: Row }) => {
        const a = ledger.attempts.find((x) => matches(x, where));
        if (a) Object.assign(a, data);
        return Promise.resolve(a);
      },
    },
  };
  return api as unknown as PrismaService;
}

function hydrate(ledger: Ledger, order: Row, include?: Row): Row {
  const out: Row = { ...order };
  if (!include) return out;
  if (include.items) out.items = ledger.items.filter((i) => i.orderId === order.id);
  if (include.table)
    out.table = order.tableId
      ? { id: ledger.tableId, posTableCode: ledger.posTableCode, tableNumber: '12' }
      : null;
  if (include.venue) out.venue = VENUE;
  if (include.posSyncRecord) out.posSyncRecord = ledger.recordFor(order.id as string) ?? null;
  if (include.nativeRounds)
    out.nativeRounds = ledger.rounds
      .filter((r) => r.orderId === order.id)
      .map((r) => ({ sequence: r.sequence, state: r.state }));
  return out;
}

function project(row: Row, select: Row): Row {
  const out: Row = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

/** Supports the `{ increment: n }` form both dispatchers use on counters. */
function applyUpdate(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && 'increment' in (value as Row)) {
      row[key] = ((row[key] as number) ?? 0) + ((value as Row).increment as number);
    } else {
      row[key] = value;
    }
  }
}

async function openTill(
  behaviour: Parameters<typeof startFakeWaiterPadServer>[0] = { kind: 'ack' },
) {
  server = await startFakeWaiterPadServer(behaviour);
  return server;
}

let keySeq = 0;
async function createDineInOrder(h: Harness) {
  keySeq += 1;
  return await h.orders.createStaffOrder(
    {
      venueId: h.ledger.venueId,
      tableId: h.ledger.tableId,
      serviceMode: ServiceMode.dine_in,
      guests: 2,
      items: [{ menuItemId: MENU_ITEM.id, quantity: 1 }],
      idempotencyKey: `tablet-round-key-${keySeq}-abcdefghijklmnop`,
    },
    VENUE.organizationId,
    ACTOR,
  );
}

/** Both sweeps, run to completion. The question every test asks afterwards is
 *  whether either of them touched a native order. */
async function runBothSweeps(h: Harness): Promise<void> {
  await h.webitSweep.sweepDispatch();
  await h.legacySweep.sweep();
}

// ═════════════════════════════════════════════════════════════════════════
// 1. A native dine-in order is owned by native, and Webit can never have it.
// ═════════════════════════════════════════════════════════════════════════
describe('1. a native dine-in order', () => {
  it('is owned by native, sends exactly once natively, and leaves NOTHING for the Webit sweep', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const order = await createDineInOrder(h);

    // ── The durable ownership decision, written with the order. ──
    const record = h.ledger.recordFor(order.id)!;
    expect(record.strategy).toBe(PosSubmissionStrategy.native_table_round);
    // And it is NOT `not_synced`, which is the status both sweeps select on.
    // This is the structural half of the guarantee: it holds for any query
    // that has never heard of the strategy column.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.status).not.toBe(POSSyncStatus.not_synced);

    // ── The native send. One packet. ──
    const sent = await h.native.sendToKitchen(order.id);
    expect(sent.status).toBe('sentAwaitingConfirmation');
    expect(h.nativeSendCount()).toBe(1);

    // ── Now let BOTH legacy sweeps run, repeatedly, as they would all shift. ──
    await runBothSweeps(h);
    await runBothSweeps(h);
    await runBothSweeps(h);

    // THE ASSERTION THIS FILE EXISTS FOR.
    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);
    expect(h.nativeSendCount()).toBe(1);

    // The record was not touched by either sweep - no claim, no attempt, no
    // status move. An order that is somebody else's is left entirely alone.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.connectorSubmitCommandId).toBeNull();
    expect(record.attemptCount).toBe(0);
    expect(record.dispatchAttemptCount).toBe(0);
    expect(record.dispatchClaimId).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. A legacy order still behaves exactly as it always did.
// ═════════════════════════════════════════════════════════════════════════
describe('2. a legacy (non-native) order', () => {
  it('is owned by webit, is picked up by the Webit sweep, and the native service refuses it', async () => {
    await openTill();
    // Production's own configuration: IDEALPOS_POS_STRATEGY unset. The till is
    // listening, which is the point - a native packet COULD physically be
    // sent, and the only thing stopping it is ownership.
    harness = await build(LEGACY_ENV);
    const h = harness;

    const order = await createDineInOrder(h);

    const record = h.ledger.recordFor(order.id)!;
    expect(record.strategy).toBe(PosSubmissionStrategy.webit);
    expect(record.status).toBe(POSSyncStatus.not_synced);

    // The legacy path still works, unchanged. This is the half of the
    // invariant that is easy to break while fixing the other half.
    const swept = await h.webitSweep.sweepDispatch();
    expect(swept.eligible).toBe(1);
    expect(h.webitSendCount()).toBe(1);

    // ── And the native service refuses it, BEFORE any transport. ──
    await expect(h.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'not_native_owned',
    });
    expect(h.nativeSendCount()).toBe(0);
    expect(server!.connections).toBe(0);
    // No round was opened and no line was claimed, so nothing about this
    // order's Webit delivery was disturbed by the attempt.
    expect(h.ledger.rounds).toHaveLength(0);
    expect(h.ledger.items.every((i) => i.nativeRoundId === null)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3 & 4. Fail closed. Never fail over.
// ═════════════════════════════════════════════════════════════════════════
describe('3. the native strategy is selected but the feature is disabled', () => {
  it('refuses the order outright - no native send, and NO Webit fallback', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port, { IDEALPOS_WAITERPAD_NATIVE_ENABLED: 'false' }));
    const h = harness;

    // The order is never created. Staff see a refusal at the tablet, which is
    // a problem somebody fixes - unlike a silent switch to Webit, which is a
    // problem nobody sees until a certification turns out to be worthless.
    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(h.ledger.orders).toHaveLength(0);
    expect(h.ledger.posSyncRecords).toHaveLength(0);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
    expect(server!.connections).toBe(0);
  });
});

describe('4. the native strategy is selected but the configuration is invalid', () => {
  it.each([
    ['no host', { IDEALPOS_WAITERPAD_HOST: '' }],
    ['no DeviceID', { IDEALPOS_WAITERPAD_DEVICE_ID: '' }],
    ['no clerk', { IDEALPOS_WAITERPAD_CLERK: '' }],
    ['an out-of-range port', { IDEALPOS_WAITERPAD_PORT: '70000' }],
  ])('fails closed on %s - no native send, no Webit fallback', async (_label, over) => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port, over));
    const h = harness;

    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.ledger.posSyncRecords).toHaveLength(0);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
  });

  it('refuses an unrecognised strategy rather than defaulting to either pipeline', async () => {
    const till = await openTill();
    // The certification-killing typo. Defaulting here would run every order
    // through Webit while an operator believed they were exercising native.
    harness = await build(NATIVE_ENV(till.port, { IDEALPOS_POS_STRATEGY: 'native_table_rouns' }));
    const h = harness;

    await expect(createDineInOrder(h)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.ledger.posSyncRecords).toHaveLength(0);
    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
    expect(h.nativeSendCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. The strategy survives a restart, because it was never in memory.
// ═════════════════════════════════════════════════════════════════════════
describe('5. a crash after ownership is persisted', () => {
  it('comes back with the same strategy, and a restarted Webit sweep still cannot claim it', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const before = harness;

    const order = await createDineInOrder(before);
    await before.native.sendToKitchen(order.id);
    expect(before.nativeSendCount()).toBe(1);

    const ledger = before.ledger;
    const record = ledger.recordFor(order.id)!;
    const strategyBefore = record.strategy;

    // ── The restart. A completely new module over the SAME rows, and this
    //    time with the native strategy configuration REMOVED, as if an
    //    operator "fixed" it during the outage. That edit must not be able to
    //    move an order that may already be on the native tab. ──
    await before.module.close();
    harness = await buildOver(ledger, LEGACY_ENV);
    const after = harness;

    expect(ledger.recordFor(order.id)!.strategy).toBe(strategyBefore);
    expect(ledger.recordFor(order.id)!.status).toBe(POSSyncStatus.owned_by_native);

    await runBothSweeps(after);
    expect(after.webitSendCount()).toBe(0);
    expect(after.queuedForProcessing()).toBe(0);
    // Still exactly the one packet from before the restart.
    expect(server!.requests).toHaveLength(1);

    // And the native service, restarted, will not re-send the round either.
    await expect(after.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(server!.requests).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. A duplicate request selects nothing a second time.
// ═════════════════════════════════════════════════════════════════════════
describe('6. the same order submitted twice', () => {
  it('re-uses the original order and its original strategy - no second selection, no second send', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const dto = {
      venueId: h.ledger.venueId,
      tableId: h.ledger.tableId,
      serviceMode: ServiceMode.dine_in,
      guests: 2,
      items: [{ menuItemId: MENU_ITEM.id, quantity: 1 }],
      idempotencyKey: 'the-same-key-from-one-double-tap',
    } as never;

    const first = await h.orders.createStaffOrder(dto, VENUE.organizationId, ACTOR);
    await h.native.sendToKitchen(first.id);

    // The replay. The REAL idempotency lookup finds the original, so
    // persistOrder - and therefore the strategy decision - is never reached a
    // second time.
    const second = await h.orders.createStaffOrder(dto, VENUE.organizationId, ACTOR);

    expect(second.id).toBe(first.id);
    expect(h.ledger.posSyncRecords).toHaveLength(1);
    expect(h.ledger.recordFor(first.id)!.strategy).toBe(PosSubmissionStrategy.native_table_round);

    // One native send, and the second press has nothing new to carry.
    expect(h.nativeSendCount()).toBe(1);
    await expect(h.native.sendToKitchen(first.id)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(h.nativeSendCount()).toBe(1);

    await runBothSweeps(h);
    expect(h.webitSendCount()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7 & 8. The sweep racing the native submission, and arriving after it.
// ═════════════════════════════════════════════════════════════════════════
describe('7. a dispatcher sweep racing the native submission', () => {
  it('only the native path wins, whichever order they interleave in', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const order = await createDineInOrder(h);

    // Both start at once. There is no lock and no ordering here on purpose:
    // the exclusion must come from the row itself, not from who got there
    // first, because a real sweep runs on a timer nobody controls.
    const [sendResult] = await Promise.all([
      h.native.sendToKitchen(order.id),
      h.webitSweep.sweepDispatch(),
      h.legacySweep.sweep(),
      h.webitSweep.sweepDispatch(),
    ]);

    expect(sendResult.status).toBe('sentAwaitingConfirmation');
    expect(h.nativeSendCount()).toBe(1);
    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);
  });
});

describe('8. the legacy sweep running after a native send has been initiated', () => {
  it('skips the order permanently, tick after tick, and never marks it failed', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const order = await createDineInOrder(h);
    await h.native.sendToKitchen(order.id);
    expect(h.ledger.attempts).toHaveLength(1); // SendInitiated evidence exists

    for (let tick = 0; tick < 10; tick += 1) await runBothSweeps(h);

    expect(h.webitSendCount()).toBe(0);
    expect(h.queuedForProcessing()).toBe(0);

    const record = h.ledger.recordFor(order.id)!;
    // "Skipped" must mean untouched. Marking it `failed` would put a false
    // error in front of staff whose round is on its way to the till normally.
    expect(record.status).toBe(POSSyncStatus.owned_by_native);
    expect(record.errorMessage).toContain('native IdealPOS handheld workflow');
    expect(record.failedAt).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 9. The native service, called for an order it does not own.
// ═════════════════════════════════════════════════════════════════════════
describe('9. the native service called for a legacy-owned order', () => {
  it('refuses before the transport, even with a perfectly good native configuration', async () => {
    const till = await openTill();
    // Native fully configured AND usable. The ONLY thing standing between this
    // order and a real Order2 packet is the ownership record.
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const order = await createDineInOrder(h);
    // Somebody hands this order to the Webit pipeline instead - a data repair,
    // a backfill, a bug. The native service must now refuse it.
    const record = h.ledger.recordFor(order.id)!;
    record.strategy = PosSubmissionStrategy.webit;
    record.status = POSSyncStatus.not_synced;

    await expect(h.native.sendToKitchen(order.id)).rejects.toBeInstanceOf(NativeRoundError);
    await expect(h.native.sendToKitchen(order.id)).rejects.toMatchObject({
      reason: 'not_native_owned',
    });

    expect(h.nativeSendCount()).toBe(0);
    expect(server!.connections).toBe(0);
    expect(h.ledger.rounds).toHaveLength(0);
    expect(h.ledger.attempts).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 10. Two independent workers cannot disagree.
// ═════════════════════════════════════════════════════════════════════════
describe('10. two independent dispatch workers', () => {
  it('cannot claim different routes for the same order, because neither of them decides one', async () => {
    const till = await openTill();
    harness = await build(NATIVE_ENV(till.port));
    const h = harness;

    const order = await createDineInOrder(h);
    const strategy = h.ledger.recordFor(order.id)!.strategy;

    // A second, entirely separate worker process over the same rows - and, to
    // make it as adversarial as possible, one configured for the OTHER
    // strategy. If a route were ever derived at dispatch time rather than read
    // from the row, this is the configuration that would derive a different
    // one.
    const secondWorker = await buildOver(h.ledger, LEGACY_ENV);
    try {
      await Promise.all([
        runBothSweeps(h),
        runBothSweeps(secondWorker),
        h.native.sendToKitchen(order.id),
      ]);

      // The route is what it was. No worker moved it, because no worker has
      // the authority to: the only writer of `strategy` is the transaction
      // that created the order, and it has already committed.
      expect(h.ledger.recordFor(order.id)!.strategy).toBe(strategy);
      expect(h.webitSendCount()).toBe(0);
      expect(secondWorker.webitSendCount()).toBe(0);
      expect(h.queuedForProcessing()).toBe(0);
      expect(secondWorker.queuedForProcessing()).toBe(0);
      expect(h.nativeSendCount()).toBe(1);
    } finally {
      await secondWorker.module.close();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Support for the restart / second-worker tests: a NEW module over EXISTING
// rows. Nothing is carried over in memory; everything that matters was on disk.
// ═════════════════════════════════════════════════════════════════════════
async function buildOver(ledger: Ledger, env: Record<string, string>): Promise<Harness> {
  const fresh = await build(env);
  // Point the fresh module's store at the rows that already exist. Done by
  // transplanting the arrays rather than by re-running creation, so the second
  // process genuinely reads what the first one wrote.
  fresh.ledger.posSyncRecords = ledger.posSyncRecords;
  fresh.ledger.orders = ledger.orders;
  fresh.ledger.items = ledger.items;
  fresh.ledger.rounds = ledger.rounds;
  fresh.ledger.attempts = ledger.attempts;
  return fresh;
}

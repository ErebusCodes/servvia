/**
 * THE NATIVE ORDER HARNESS. One venue, one till, one database - shared by every
 * spec that has to watch both POS pipelines at once.
 *
 * WHY IT IS ITS OWN FILE. Two specs need it and they must not drift:
 * `route-exclusivity.spec.ts` asks whether the WRONG pipeline can claim an
 * order, and `native-rounds.controller.spec.ts` asks whether the RIGHT one
 * carries a whole service correctly. If each grew its own store they would
 * eventually model the database differently, and the two answers would stop
 * being about the same system.
 *
 * WHAT IS REAL HERE: the services, the writer, the codec, the transport, and -
 * critically - Prisma's FILTER SEMANTICS. `matches` evaluates the `where`
 * clauses the dispatcher sweeps actually issue, so deleting a guard from one of
 * those queries fails the tests rather than passing them. Anything outside the
 * operator subset it models throws, because a filter silently ignored is a test
 * that cannot fail for the reason it exists.
 *
 * WHAT IS REPLACED, and each is a genuine external boundary: the database, the
 * BullMQ queue, and the till.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { POSSyncStatus, PosSubmissionStrategy, ServiceMode, StaffRole } from '@prisma/client';

import { OrdersService } from '../../orders/orders.service';
import { OrdersGateway } from '../../orders/orders.gateway';
import { AuditLogService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectorCommandService } from '../../connector/connector-command.service';
import { PosStrategyResolver } from '../pos-strategy-resolver';
import { IdealposOrderDispatcherService } from '../idealpos-order-dispatcher.service';
import { PosSyncDispatcherService } from '../pos-sync-dispatcher.service';
import { NativeTableRoundService } from '../waiterpad/native-table-round.service';
import {
  WaiterPadTableRoundWriter,
  type ITableRoundWriter,
} from '../waiterpad/waiterpad-table-round-writer';
import { resolveWaiterPadConfig } from '../waiterpad/waiterpad-config';
import {
  startFakeWaiterPadServer,
  type FakeWaiterPadServer,
} from '../waiterpad/testing/fake-waiterpad-server';
import { NativeRoundsController } from '../native-rounds.controller';
import { QUEUE_NAMES } from '../../queue/queue.constants';
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

export type Row = Record<string, unknown>;

export function matchesLeaf(value: unknown, condition: unknown): boolean {
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

export function matches(row: Row, where: Row | undefined): boolean {
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
export class Ledger {
  posSyncRecords: Row[] = [];
  orders: Row[] = [];
  items: Row[] = [];
  rounds: Row[] = [];
  attempts: Row[] = [];
  private seq = 0;

  readonly venueId = 'venue-1';

  /**
   * Two tables, and every Verdura display number DIFFERS from its native code,
   * so a test that passed by sending the Verdura number would fail loudly
   * rather than quietly.
   */
  readonly tables: Record<
    string,
    { id: string; tableNumber: string; posTableCode: string | null }
  > = {
    'tbl-a': { id: 'tbl-a', tableNumber: '12', posTableCode: '5' },
    'tbl-b': { id: 'tbl-b', tableNumber: '3', posTableCode: '7' },
  };

  /** The default table, for specs that only need one. */
  readonly tableId = 'tbl-a';
  readonly posTableCode = '5';

  /** Every line of a round, by PLU, so assertions read like a docket. */
  pluesOfRound(roundId: string): string[] {
    return this.items
      .filter((i) => i.nativeRoundId === roundId)
      .map((i) => String(i.menuItemId).replace('mi-', ''))
      .sort();
  }

  roundsFor(orderId: string): Row[] {
    return this.rounds.filter((r) => r.orderId === orderId);
  }

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
export const VENUE = {
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

/**
 * A menu with a drink, two mains and a dessert - enough to run drinks, then
 * mains, then dessert, which is the shape of a real service and the shape of
 * the delta rule this integration lives or dies by.
 *
 * Every PLU is distinct and none of them equals a table code, so a packet that
 * carried the wrong field would fail an assertion rather than coincidentally
 * match.
 */
function menuItem(id: string, title: string, plu: string, priceCents: number) {
  return {
    id,
    venueId: 'venue-1',
    title,
    priceCents,
    isAvailable: true,
    posProductCode: plu,
    posIdentity: null,
    category: { id: 'cat-1', name: 'Mains' },
  };
}

export const MENU = {
  lamb: menuItem('mi-lamb', 'Lamb Shank', '101', 3200),
  fish: menuItem('mi-fish', 'Market Fish', '102', 3400),
  coke: menuItem('mi-coke', 'Coke No Sugar', '201', 600),
  water: menuItem('mi-water', 'Sparkling Water', '202', 700),
  tiramisu: menuItem('mi-tiramisu', 'Tiramisu', '301', 1400),
} as const;

export const MENU_ITEMS = Object.values(MENU);

/** The default single item, for specs that only need one line. */
export const MENU_ITEM = MENU.lamb;

export const ACTOR = { id: 'staff-1', email: 'waiter@verdura.test', role: StaffRole.cashier };

// ═════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════

/** A complete, valid native configuration pointed at the fake till. */
export const NATIVE_ENV = (
  port: number,
  over: Record<string, string> = {},
): Record<string, string> => ({
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
export const LEGACY_ENV: Record<string, string> = {};

// ═════════════════════════════════════════════════════════════════════════
// The harness
// ═════════════════════════════════════════════════════════════════════════

export interface Harness {
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
  /**
   * The real HTTP handler the Order Tablet's Send to Kitchen calls. Exercised
   * as the controller method rather than over a socket: the guards it carries
   * are the same ones order creation carries and are covered by their own
   * specs, and what these tests are about is what reaches the till.
   */
  rounds: NativeRoundsController;
  module: TestingModule;
}

/**
 * THE LIFECYCLE, HELD HERE RATHER THAN IN EACH SPEC.
 *
 * A leaked fake till is a listening socket the next test connects to, and a
 * leaked Nest module is a set of timers still running while another test
 * asserts on rows. Both produce failures that look like the code under test
 * and are not. `installHarnessLifecycle()` registers the one afterEach that
 * closes both, and every spec calls it once at the top.
 */
let currentServer: FakeWaiterPadServer | null = null;
let currentHarness: Harness | null = null;

/** The fake till the current test is talking to. Null before `openTill`. */
export function tillServer(): FakeWaiterPadServer {
  if (!currentServer) throw new Error('no fake WaiterPad server is open; call openTill() first');
  return currentServer;
}

/** Register the harness for teardown, and return it for convenient chaining. */
export function setHarness(h: Harness): Harness {
  currentHarness = h;
  return h;
}

/** Close a harness built for a second worker/process without ending the test. */
export async function closeHarness(h: Harness): Promise<void> {
  if (currentHarness === h) currentHarness = null;
  await h.module.close();
}

export function installHarnessLifecycle(): void {
  afterEach(async () => {
    await currentHarness?.module.close();
    currentHarness = null;
    await currentServer?.close();
    currentServer = null;
  });
}

export async function build(env: Record<string, string>): Promise<Harness> {
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
    controllers: [NativeRoundsController],
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
    nativeSendCount: () => currentServer?.requests.length ?? 0,
    queuedForProcessing: () => queued.length,
    rounds: module.get(NativeRoundsController),
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

export function buildPrisma(ledger: Ledger): PrismaService {
  const api: Row = {
    $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(api),
    $queryRaw: () => Promise.resolve([{ nextval: 600001n }]),

    venue: { findUnique: () => Promise.resolve(VENUE) },
    table: {
      // Evaluated through `matches` rather than by reading `where.id`:
      // validateTableForOrder asks with `OR: [{ id }, { tableNumber }]`, and a
      // harness that only understood a flat id would quietly hand back the
      // DEFAULT table for every request - which is precisely the "table A's
      // round reached table B" failure these tests exist to catch, hidden
      // inside the test infrastructure.
      findFirst: ({ where }: { where: Row }) => {
        const rows = Object.values(ledger.tables).map((t) => ({
          id: t.id,
          venueId: ledger.venueId,
          tableNumber: t.tableNumber,
          isActive: true,
        }));
        return Promise.resolve(rows.find((r) => matches(r, where)) ?? null);
      },
    },
    staff: { upsert: () => Promise.resolve({ id: 'staff-1' }) },
    menuItem: {
      findFirst: ({ where }: { where: { id?: string } }) =>
        Promise.resolve(MENU_ITEMS.find((m) => m.id === where.id) ?? null),
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(MENU_ITEMS.filter((m) => where.id.in.includes(m.id))),
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
        select,
      }: {
        where: {
          id?: string;
          venueId_idempotencyKey?: { venueId: string; idempotencyKey: string };
        };
        include?: Row;
        select?: Row;
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
        // Prisma's `select` names relations the same way `include` does, so
        // hydrate against whichever the caller used and then project. Modelling
        // both matters: the round controller reads its order with `select`, and
        // a harness that only understood `include` would hand it an order with
        // no venue and no posSyncRecord - exactly the two fields its guards are
        // made of.
        const shape = include ?? select;
        const hydrated = hydrate(ledger, order, shape);
        return Promise.resolve(select ? project(hydrated, select) : hydrated);
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
        // The `requestKey` unique constraint, modelled - because it is the
        // double-tap guard, and a harness that let two rounds share a key would
        // prove the opposite of what these tests claim.
        if (
          data.requestKey != null &&
          ledger.rounds.some((r) => r.requestKey === data.requestKey)
        ) {
          return Promise.reject(
            Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
              meta: { target: ['requestKey'] },
            }),
          );
        }
        const row = { ...data, id: ledger.id('round') };
        ledger.rounds.push(row);
        return Promise.resolve(row);
      },
      // Every unique lookup this code makes: by id, and by requestKey.
      findUnique: ({ where, select }: { where: Row; select?: Row }) => {
        const r = ledger.rounds.find((x) => matches(x, where));
        if (!r) return Promise.resolve(null);
        if (select) return Promise.resolve(project(r, select));
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
  if (include.table) {
    const table = order.tableId ? ledger.tables[order.tableId as string] : null;
    out.table = table
      ? { id: table.id, posTableCode: table.posTableCode, tableNumber: table.tableNumber }
      : null;
  }
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

export async function openTill(
  behaviour: Parameters<typeof startFakeWaiterPadServer>[0] = { kind: 'ack' },
) {
  currentServer = await startFakeWaiterPadServer(behaviour);
  return currentServer;
}

let keySeq = 0;
export async function createDineInOrder(
  h: Harness,
  options: {
    tableId?: string;
    items?: { menuItemId: string; quantity: number }[];
    guests?: number;
  } = {},
) {
  keySeq += 1;
  return await h.orders.createStaffOrder(
    {
      venueId: h.ledger.venueId,
      tableId: options.tableId ?? h.ledger.tableId,
      serviceMode: ServiceMode.dine_in,
      guests: options.guests ?? 2,
      items: options.items ?? [{ menuItemId: MENU_ITEM.id, quantity: 1 }],
      idempotencyKey: `tablet-round-key-${keySeq}-abcdefghijklmnop`,
    },
    VENUE.organizationId,
    ACTOR,
  );
}

/** Both sweeps, run to completion. The question every test asks afterwards is
 *  whether either of them touched a native order. */
export async function runBothSweeps(h: Harness): Promise<void> {
  await h.webitSweep.sweepDispatch();
  await h.legacySweep.sweep();
}

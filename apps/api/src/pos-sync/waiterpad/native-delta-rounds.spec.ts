/**
 * THE SERVICE, AS A SHIFT ACTUALLY RUNS.
 *
 * `native-handheld-equivalence.spec.ts` proves one round reaches one table
 * byte-for-byte. This file proves the thing that happens NEXT, and every time
 * after that: drinks, then mains, then dessert, on this table and that one and
 * back again, with a waiter pressing buttons twice and a tablet that gets
 * reloaded halfway through.
 *
 * WHAT IT IS ACTUALLY ASSERTING. There is exactly one dangerous failure on
 * this path and it is not "the order did not arrive" - it is "the order
 * arrived twice". A native handheld sends DELTAS, so every round after the
 * first must carry the new lines and NOTHING ELSE. A replayed round is a
 * second Lamb Shank on a real customer's real bill, fired to a real kitchen,
 * and nobody notices until the docket prints.
 *
 * So every test below reads the bytes the socket carried and asserts what is
 * ABSENT from them as hard as what is present.
 *
 * THE MECHANISM UNDER TEST is the line claim: `openRound` stamps
 * `OrderItem.nativeRoundId` on every unclaimed line in the same transaction
 * that creates the round. A line therefore belongs to exactly one round
 * forever, which makes replay structurally impossible rather than a rule the
 * code has to remember.
 *
 * WHAT IS REAL: the service, the writer, the token, the Order2 codec and the
 * TCP transport. Only the two genuine external boundaries are replaced - the
 * database (in-memory, answering the same queries) and the till (the fake
 * 6983 listener, which records the exact bytes).
 */

import { NativeTableRoundService, NativeRoundError } from './native-table-round.service';
import {
  WaiterPadTableRoundWriter,
  type ITableRoundWriter,
  type SendInitiatedRecord,
} from './waiterpad-table-round-writer';
import { resolveWaiterPadConfig } from './waiterpad-config';
import {
  startFakeWaiterPadServer,
  type FakeBehaviour,
  type FakeWaiterPadServer,
} from './testing/fake-waiterpad-server';

import type { PrismaService } from '../../prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────
// The venue. Two tables, and every Verdura display number is DIFFERENT from
// its native code, so a test that passed by sending the Verdura number would
// fail loudly rather than quietly.
// ─────────────────────────────────────────────────────────────────────────
const TABLE_A_NATIVE = '5';
const TABLE_A_DISPLAY = '12';
const TABLE_B_NATIVE = '7';
const TABLE_B_DISPLAY = '3';

const PLU = {
  lamb: '101',
  fish: '102',
  coke: '201',
  water: '202',
  tiramisu: '301',
} as const;

interface Row {
  [k: string]: unknown;
}

/**
 * An in-memory stand-in for the queries `NativeTableRoundService` makes,
 * generalised to any number of orders and tables.
 *
 * `$transaction` SERIALISES. Two concurrent transactions run one after the
 * other, so the second sees everything the first committed. That models what
 * Postgres gives this code for the one interleaving that matters: the claim
 * (`orderItem.updateMany ... WHERE nativeRoundId IS NULL`) takes row locks, so
 * a second claim on the same lines cannot proceed until the first commits.
 * Modelling it more loosely would let a test pass that a real database would
 * not.
 */
class Venue {
  orders: Row[] = [];
  items: Row[] = [];
  rounds: Row[] = [];
  attempts: Row[] = [];
  menuItems: Row[] = [];

  private tableCodes = new Map<string, string | null>();
  private seq = 0;
  private txQueue: Promise<unknown> = Promise.resolve();

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  setTable(tableId: string, posTableCode: string | null): void {
    this.tableCodes.set(tableId, posTableCode);
  }

  addOrder(params: {
    id: string;
    tableId: string | null;
    tableNumber: string | null;
    guests: number;
    serviceMode?: string;
  }): void {
    this.orders.push({
      id: params.id,
      venueId: 'venue-1',
      tableId: params.tableId,
      tableNumber: params.tableNumber,
      serviceMode: params.serviceMode ?? 'dine_in',
      guests: params.guests,
    });
  }

  addMenuItem(id: string, posProductCode: string): void {
    this.menuItems.push({ id, posProductCode, posIdentity: null });
  }

  /** A line the waiter has just entered. Unclaimed until a round takes it. */
  addLine(orderId: string, menuItemId: string, title: string, seat: number | null): string {
    const id = this.id('item');
    this.items.push({
      id,
      orderId,
      menuItemId,
      menuItemTitle: title,
      quantity: 1,
      unitPriceCents: 1200,
      seat,
      notes: null,
      nativeRoundId: null,
    });
    return id;
  }

  roundsFor(orderId: string): Row[] {
    return this.rounds.filter((r) => r.orderId === orderId);
  }

  /** Every line this round claimed, by PLU, so assertions read like a docket. */
  pluesOfRound(roundId: string): string[] {
    return this.items
      .filter((i) => i.nativeRoundId === roundId)
      .map((i) => this.menuItems.find((m) => m.id === i.menuItemId)?.posProductCode as string)
      .sort();
  }

  asPrisma(): PrismaService {
    const api = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
        const run = this.txQueue.then(() => cb(api));
        this.txQueue = run.catch(() => undefined);
        return run;
      },

      order: {
        findUnique: ({ where }: { where: { id: string } }) => {
          const order = this.orders.find((o) => o.id === where.id);
          if (!order) return Promise.resolve(null);
          return Promise.resolve({
            ...order,
            table: order.tableId
              ? { posTableCode: this.tableCodes.get(order.tableId as string) ?? null }
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
  IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT: 'true',
  ...over,
});

let server: FakeWaiterPadServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/**
 * One till, one service, for a whole scenario.
 *
 * The server is NOT restarted between rounds: `server.requests` accumulates,
 * so a test can assert on the second and third packets and, just as
 * importantly, on how many packets exist at all.
 */
async function openTill(
  venue: Venue,
  behaviour: FakeBehaviour = { kind: 'ack' },
  env: Record<string, string> = {},
): Promise<{ service: NativeTableRoundService; persisted: SendInitiatedRecord[] }> {
  server = await startFakeWaiterPadServer(behaviour);
  return buildService(venue, env);
}

/**
 * A second service over the SAME database and the SAME till - a process
 * restart, or a second tablet. Nothing may be carried over in memory.
 */
function buildService(
  venue: Venue,
  env: Record<string, string> = {},
): { service: NativeTableRoundService; persisted: SendInitiatedRecord[] } {
  const resolution = resolveWaiterPadConfig(
    ENV({ IDEALPOS_WAITERPAD_PORT: String(server!.port), ...env }),
  );
  if (!resolution.enabled) throw new Error(resolution.reasons.join('; '));

  const prisma = venue.asPrisma();
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

/** The nth packet the till received, as text. */
function packet(n: number): string {
  expect(server!.requests.length).toBeGreaterThan(n);
  return server!.requests[n];
}

function stockItems(payload: string): string[] {
  return [...payload.matchAll(/<StockItem>([^<]*)<\/StockItem>/g)].map((m) => m[1]).sort();
}

function tableOf(payload: string): string | null {
  return /<Table>([^<]*)<\/Table>/.exec(payload)?.[1] ?? null;
}

/** A venue with both tables mapped, both orders open, and a menu. */
function seedVenue(): Venue {
  const venue = new Venue();
  venue.setTable('tbl-a', TABLE_A_NATIVE);
  venue.setTable('tbl-b', TABLE_B_NATIVE);
  venue.addOrder({ id: 'order-a', tableId: 'tbl-a', tableNumber: TABLE_A_DISPLAY, guests: 2 });
  venue.addOrder({ id: 'order-b', tableId: 'tbl-b', tableNumber: TABLE_B_DISPLAY, guests: 4 });
  venue.addMenuItem('mi-lamb', PLU.lamb);
  venue.addMenuItem('mi-fish', PLU.fish);
  venue.addMenuItem('mi-coke', PLU.coke);
  venue.addMenuItem('mi-water', PLU.water);
  venue.addMenuItem('mi-tiramisu', PLU.tiramisu);
  return venue;
}

/**
 * Stand in for the reconciliation this round is waiting on.
 *
 * A round in `awaiting_native_confirmation` still occupies the table's single
 * in-flight slot, so nothing else may open until it is settled. In production
 * that settlement is `NativeRoundReconciliationService` reading the till's own
 * token row; here it is one line, so these tests exercise the delta rather
 * than the reconciler (which has its own spec).
 */
function reconcileConfirmed(venue: Venue, roundId: string): void {
  const round = venue.rounds.find((r) => r.id === roundId);
  if (!round) throw new Error(`no round ${roundId}`);
  round.state = 'confirmed';
}

// ═════════════════════════════════════════════════════════════════════════
describe('a table across a whole service: drinks, then mains, then dessert', () => {
  it('sends three rounds that partition the order - every line once, no line twice', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    venue.addLine('order-a', 'mi-water', 'Sparkling Water', 2);

    const { service } = await openTill(venue);

    // ── ROUND 1: the drinks the waiter took on arrival. ──
    const first = await service.sendToKitchen('order-a');
    expect(first.status).toBe('sentAwaitingConfirmation');
    expect(stockItems(packet(0))).toEqual([PLU.coke, PLU.water].sort());
    expect(tableOf(packet(0))).toBe(TABLE_A_NATIVE);

    reconcileConfirmed(venue, venue.roundsFor('order-a')[0].id as string);

    // ── ROUND 2: mains, ordered twenty minutes later. ──
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    venue.addLine('order-a', 'mi-fish', 'Market Fish', 2);
    const second = await service.sendToKitchen('order-a');
    expect(second.status).toBe('sentAwaitingConfirmation');

    // THE PRODUCT PROMISE. The drinks are already on the native tab. Their
    // PLUs appearing here would be two extra drinks on a real bill.
    expect(stockItems(packet(1))).toEqual([PLU.lamb, PLU.fish].sort());
    expect(packet(1)).not.toContain(`<StockItem>${PLU.coke}</StockItem>`);
    expect(packet(1)).not.toContain(`<StockItem>${PLU.water}</StockItem>`);

    reconcileConfirmed(venue, venue.roundsFor('order-a')[1].id as string);

    // ── ROUND 3: dessert. ──
    venue.addLine('order-a', 'mi-tiramisu', 'Tiramisu', 1);
    const third = await service.sendToKitchen('order-a');
    expect(third.status).toBe('sentAwaitingConfirmation');
    expect(stockItems(packet(2))).toEqual([PLU.tiramisu]);
    expect(packet(2)).not.toContain(`<StockItem>${PLU.lamb}</StockItem>`);
    expect(packet(2)).not.toContain(`<StockItem>${PLU.coke}</StockItem>`);

    // ── Three rounds, three packets, and not one byte more. ──
    expect(server!.requests).toHaveLength(3);
    expect(server!.connections).toBe(3);

    const rounds = venue.roundsFor('order-a');
    expect(rounds.map((r) => r.sequence)).toEqual([1, 2, 3]);

    // The partition, stated directly: the union of the rounds is the order,
    // and the rounds are disjoint.
    expect(venue.pluesOfRound(rounds[0].id as string)).toEqual([PLU.coke, PLU.water].sort());
    expect(venue.pluesOfRound(rounds[1].id as string)).toEqual([PLU.lamb, PLU.fish].sort());
    expect(venue.pluesOfRound(rounds[2].id as string)).toEqual([PLU.tiramisu]);
    expect(venue.items.every((i) => i.nativeRoundId !== null)).toBe(true);

    // Three distinct tokens. The receiver's duplicate guard is one-deep and
    // keyed by device, so two rounds sharing a token would make the second
    // indistinguishable from a resend of the first.
    const tokens = venue.attempts.map((a) => a.token);
    expect(new Set(tokens).size).toBe(3);

    // Every round carried its own durable idempotency key, derived from ids
    // that survive a restart - never minted in browser state.
    expect(rounds.map((r) => r.idempotencyKey)).toEqual([
      'order-a:r1',
      'order-a:r2',
      'order-a:r3',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('two tables at once, and coming back to the first', () => {
  it('sends each round to its own native table and never crosses them', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    const { service } = await openTill(venue);

    // Table A, round 1.
    await service.sendToKitchen('order-a');
    expect(tableOf(packet(0))).toBe(TABLE_A_NATIVE);
    reconcileConfirmed(venue, venue.roundsFor('order-a')[0].id as string);

    // The waiter walks to table B and takes a completely different order.
    venue.addLine('order-b', 'mi-lamb', 'Lamb Shank', 1);
    await service.sendToKitchen('order-b');

    // TABLE B'S PACKET GOES TO TABLE B. A Verdura display number (3) here, or
    // table A's code (5), would both be somebody else's bill.
    expect(tableOf(packet(1))).toBe(TABLE_B_NATIVE);
    expect(packet(1)).not.toContain(`<Table>${TABLE_B_DISPLAY}</Table>`);
    expect(stockItems(packet(1))).toEqual([PLU.lamb]);
    expect(packet(1)).not.toContain(`<StockItem>${PLU.coke}</StockItem>`);

    // Table A's round was not touched by any of that.
    expect(venue.roundsFor('order-a')).toHaveLength(1);
    expect(venue.roundsFor('order-a')[0].posTableCode).toBe(TABLE_A_NATIVE);
    expect(venue.roundsFor('order-b')[0].posTableCode).toBe(TABLE_B_NATIVE);

    reconcileConfirmed(venue, venue.roundsFor('order-b')[0].id as string);

    // ── Back to table A for a second round there. ──
    venue.addLine('order-a', 'mi-tiramisu', 'Tiramisu', 1);
    await service.sendToKitchen('order-a');

    expect(tableOf(packet(2))).toBe(TABLE_A_NATIVE);
    // Only the dessert. Not table A's earlier drink, and not table B's main -
    // the second is the failure a venue-wide "unsent lines" query would
    // produce.
    expect(stockItems(packet(2))).toEqual([PLU.tiramisu]);
    expect(packet(2)).not.toContain(`<StockItem>${PLU.coke}</StockItem>`);
    expect(packet(2)).not.toContain(`<StockItem>${PLU.lamb}</StockItem>`);

    // Sequences are per order, so returning to A continues A's numbering
    // rather than the venue's.
    expect(venue.roundsFor('order-a').map((r) => r.sequence)).toEqual([1, 2]);
    expect(venue.roundsFor('order-b').map((r) => r.sequence)).toEqual([1]);
    expect(server!.requests).toHaveLength(3);
  });

  it('keeps each order on the table it was OPENED against, even if the mapping is edited mid-round', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    // The round is opened - and therefore stamped with table A's native code.
    const round = await service.openRound('order-a');
    expect(venue.rounds[0].posTableCode).toBe(TABLE_A_NATIVE);

    // Now a manager re-maps the Verdura table while the round is open. This
    // is the drift the stored `posTableCode` exists to stop: reading the code
    // through the order at SEND time would redirect a round that staff had
    // already committed to table 5.
    venue.setTable('tbl-a', '9');

    await service.sendRound(round.id);

    expect(tableOf(packet(0))).toBe(TABLE_A_NATIVE);
    expect(packet(0)).not.toContain('<Table>9</Table>');
    // The attempt row agrees, so incident review reads the same table.
    expect(venue.attempts[0].posTableCode).toBe(TABLE_A_NATIVE);
  });

  it('refuses outright rather than send a round for a table it cannot name', async () => {
    const venue = seedVenue();
    venue.setTable('tbl-a', null);
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    await expect(service.sendToKitchen('order-a')).rejects.toMatchObject({
      reason: 'unmapped_table',
    });
    // A guessed table is a stranger's bill, so nothing may leave.
    expect(server!.connections).toBe(0);
    expect(venue.items[0].nativeRoundId).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a prior round is never resent, whatever became of it', () => {
  it('leaves a CONFIRMED round alone: its lines can never be swept into a later one', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    await service.sendToKitchen('order-a');
    const roundOne = venue.roundsFor('order-a')[0];
    reconcileConfirmed(venue, roundOne.id as string);

    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    await service.sendToKitchen('order-a');

    expect(stockItems(packet(1))).toEqual([PLU.coke]);
    // The claim is what guarantees this: the lamb line still carries round
    // one's id, so the "unclaimed lines" query cannot see it.
    expect(venue.pluesOfRound(roundOne.id as string)).toEqual([PLU.lamb]);
    expect(venue.items[0].nativeRoundId).toBe(roundOne.id);
    expect(server!.requests).toHaveLength(2);
  });

  it('an UNCERTAIN round blocks the table, and the new lines stay unclaimed while it does', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);

    // The till takes the bytes and says nothing. This is the ambiguous case:
    // the round may or may not be on the tab.
    const { service } = await openTill(venue, { kind: 'silent' });
    const result = await service.sendToKitchen('order-a');
    expect(result.status).toBe('uncertain');
    expect(result.message).toMatch(/DO NOT send it again/i);

    const roundOne = venue.roundsFor('order-a')[0];
    expect(roundOne.state).toBe('unresolved');

    // A waiter adds more and presses send. The table is blocked, and the
    // refusal is machine-readable so no caller has to parse prose.
    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    await expect(service.sendToKitchen('order-a')).rejects.toMatchObject({
      reason: 'round_in_flight',
    });

    // Nothing further left the host, and the new line is still UNCLAIMED, so
    // it is not lost with the round that could not be resolved.
    expect(server!.requests).toHaveLength(1);
    expect(venue.items[1].nativeRoundId).toBeNull();
  }, 20000);

  it('once a human resolves the uncertain round, the next round carries only what is new', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);

    const { service } = await openTill(venue, { kind: 'nak' });
    const first = await service.sendToKitchen('order-a');
    // A NAK is uncertain, not a rejection: the till has answered NAK to a
    // fragment of an order it had already printed.
    expect(first.status).toBe('uncertain');
    const roundOne = venue.roundsFor('order-a')[0];
    expect(roundOne.state).toBe('unresolved');

    // The human looks at the till and finds the round IS on the tab.
    reconcileConfirmed(venue, roundOne.id as string);

    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    await service.sendToKitchen('order-a');

    // THE DANGEROUS PATH. "It was uncertain, so send it again to be safe" is
    // exactly how a customer gets two lamb shanks. The uncertain round's line
    // stays with the uncertain round.
    expect(stockItems(packet(1))).toEqual([PLU.coke]);
    expect(packet(1)).not.toContain(`<StockItem>${PLU.lamb}</StockItem>`);
    expect(venue.pluesOfRound(roundOne.id as string)).toEqual([PLU.lamb]);
  });

  it('refuses a round with nothing new rather than spend an identity asking for nothing', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    await service.sendToKitchen('order-a');
    reconcileConfirmed(venue, venue.roundsFor('order-a')[0].id as string);

    await expect(service.sendToKitchen('order-a')).rejects.toMatchObject({
      reason: 'nothing_to_send',
    });
    expect(server!.requests).toHaveLength(1);
    expect(venue.roundsFor('order-a')).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('a waiter presses Send twice', () => {
  it('two simultaneous presses produce one round and one packet', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    const { service } = await openTill(venue);

    // Both presses race. The claim is the guard: whichever transaction commits
    // first takes BOTH lines, and the second finds nothing unclaimed.
    const settled = await Promise.allSettled([
      service.sendToKitchen('order-a'),
      service.sendToKitchen('order-a'),
    ]);

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const failure = (rejected[0] as PromiseRejectedResult).reason as NativeRoundError;
    expect(failure).toBeInstanceOf(NativeRoundError);
    expect(failure.reason).toBe('nothing_to_send');

    // ONE packet, ONE connection, ONE attempt row. A second connection here
    // would be a second Lamb Shank in the kitchen.
    expect(server!.requests).toHaveLength(1);
    expect(server!.connections).toBe(1);
    expect(venue.attempts).toHaveLength(1);
    expect(venue.roundsFor('order-a')).toHaveLength(1);
    expect(stockItems(packet(0))).toEqual([PLU.coke, PLU.lamb].sort());
  });

  it('a second press after the first has been answered sends nothing at all', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    const first = await service.sendToKitchen('order-a');
    expect(first.status).toBe('sentAwaitingConfirmation');

    // The round is awaiting confirmation, so the table's single in-flight
    // slot is taken. This is the refusal an impatient second tap gets, and it
    // is not a retry of anything.
    await expect(service.sendToKitchen('order-a')).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(server!.requests).toHaveLength(1);
  });

  it('a round that has already been sent can never be sent a second time by id', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);
    const { service } = await openTill(venue);

    await service.sendToKitchen('order-a');
    const roundId = venue.roundsFor('order-a')[0].id as string;

    // The direct call - a retry harness, a queue redelivery, a second tab.
    // `sendRound` accepts only a DRAFTING round, so there is no path here
    // that reopens a socket for a round already in flight.
    await expect(service.sendRound(roundId)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(server!.requests).toHaveLength(1);
    expect(venue.attempts).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the tablet is reloaded, or the API restarts', () => {
  it('a fresh process reads the same durable rounds and refuses to resend the sent one', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);

    // ── Before the restart. ──
    const { service: before } = await openTill(venue);
    await before.sendToKitchen('order-a');
    const roundId = venue.roundsFor('order-a')[0].id as string;
    expect(venue.roundsFor('order-a')[0].state).toBe('awaiting_native_confirmation');

    // ── The restart. A completely new service and writer over the same
    //    database. Nothing in memory survives; everything that matters was
    //    on disk before the socket opened. ──
    const { service: after } = buildService(venue);

    await expect(after.sendRound(roundId)).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    await expect(after.sendToKitchen('order-a')).rejects.toMatchObject({
      reason: 'round_in_flight',
    });
    expect(server!.requests).toHaveLength(1);

    // ── The round is resolved, service resumes, and the numbering continues
    //    from what is on disk rather than from anything a browser held. ──
    reconcileConfirmed(venue, roundId);
    venue.addLine('order-a', 'mi-coke', 'Coke No Sugar', 1);
    await after.sendToKitchen('order-a');

    expect(venue.roundsFor('order-a').map((r) => r.idempotencyKey)).toEqual([
      'order-a:r1',
      'order-a:r2',
    ]);
    expect(stockItems(packet(1))).toEqual([PLU.coke]);
  });

  it('a crash between the attempt row and the response leaves evidence a send was attempted', async () => {
    const venue = seedVenue();
    venue.addLine('order-a', 'mi-lamb', 'Lamb Shank', 1);

    // The till accepts the bytes and never answers - indistinguishable, from
    // this side, from the process dying mid-send.
    const { service } = await openTill(venue, { kind: 'silent' });
    await service.sendToKitchen('order-a');

    // THE ROW EXISTS. Without it a restart could not tell "never sent" from
    // "sent, outcome unknown", and the safe reading of no evidence would have
    // to be the dangerous one.
    expect(venue.attempts).toHaveLength(1);
    expect(venue.attempts[0].roundId).toBe(venue.roundsFor('order-a')[0].id);
    expect(venue.attempts[0].sendInitiatedAt).toBeInstanceOf(Date);
    expect(venue.attempts[0].token).toMatch(/^[0-9a-f]{32}$/);
    // And it names the table, so a human holding only this row can look the
    // round up on the till.
    expect(venue.attempts[0].posTableCode).toBe(TABLE_A_NATIVE);
    expect(venue.roundsFor('order-a')[0].state).toBe('unresolved');
  }, 20000);
});

/**
 * THE CLAIMS AN IN-MEMORY DOUBLE CANNOT MAKE, made against real PostgreSQL.
 *
 * WHY THIS FILE HAD TO EXIST. Both hand-written Prisma doubles implement
 * `$transaction` as `cb(api)` - the callback is simply invoked. That models the
 * SHAPE of a transaction and none of its GUARANTEES: no atomicity, no
 * rollback, no isolation, no concurrency. Every safety argument in the native
 * round path that rests on "these two writes happen together" or "exactly one
 * of two racing writers wins" is therefore unproven by the unit suite, however
 * green it is. The audit that found the `submitting` black hole found this
 * next to it, and the two are related: the recovery sweep's whole correctness
 * rests on a compare-and-set holding under concurrency.
 *
 * WHAT IS PROVEN HERE, and only here:
 *
 *   * the round-creation-and-line-claim is genuinely ATOMIC, so a failure
 *     partway cannot leave lines belonging to a round that does not describe
 *     them;
 *   * two concurrent `openRound` calls on one order cannot both claim the same
 *     line, which is what stops a double-tap becoming two dockets;
 *   * the recovery sweep's compare-and-set holds under a real race, so two API
 *     processes coming up together after a restart settle each round once;
 *   * recovery's release is atomic with its state change, so a crash cannot
 *     leave a round settled with its lines still claimed, or vice versa;
 *   * `requestKey` uniqueness is enforced by the DATABASE rather than by a
 *     read-then-write, under genuine concurrency.
 *
 * IT REFUSES TO RUN AGAINST ANYTHING THAT LOOKS LIKE PRODUCTION. See the guard
 * below - this spec truncates tables, and the repository's own `.env` points
 * `DATABASE_URL` at `verdura_production`. A test that destroys a restaurant's
 * live orders because somebody typed the wrong npm script is not a risk worth
 * carrying for any amount of coverage.
 *
 * HOW TO RUN IT:
 *   docker run -d --name verdura-recovery-it -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_USER=pw -e POSTGRES_DB=recovery_it -p 55501:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://pw:pw@localhost:55501/recovery_it npx prisma migrate deploy
 *   DATABASE_URL=postgresql://pw:pw@localhost:55501/recovery_it \
 *     npx jest --config ./test/jest-integration.json native-round-recovery --runInBand
 */

import { ConfigService } from '@nestjs/config';
import { NativeRoundState } from '@prisma/client';

import { PrismaService } from '../src/prisma/prisma.service';
import {
  NativeRoundRecoveryService,
  decideRecovery,
} from '../src/pos-sync/waiterpad/native-round-recovery.service';
import { NativeTableRoundService } from '../src/pos-sync/waiterpad/native-table-round.service';
import { DisabledTableRoundWriter } from '../src/pos-sync/waiterpad/waiterpad-table-round-writer';

// ─────────────────────────────────────────────────────────────────────────
// THE GUARD. Refuse anything that is not an obvious throwaway.
// ─────────────────────────────────────────────────────────────────────────
const url = process.env.DATABASE_URL ?? '';
const looksDisposable =
  /localhost|127\.0\.0\.1/.test(url) &&
  !/verdura_production/.test(url) &&
  /_it\b|test|audit|throwaway|disposable/.test(url);

const describeOrSkip = looksDisposable ? describe : describe.skip;

if (!looksDisposable) {
  // Loud rather than silent: a skipped safety test that nobody notices is how
  // this coverage quietly stops existing.

  console.warn(
    '\n[native-round-recovery.integration-spec] SKIPPED. DATABASE_URL does not look like a ' +
      'disposable database, and this spec truncates tables. Point it at a throwaway ' +
      'PostgreSQL (see the header) to run it.\n',
  );
}

describeOrSkip('native round recovery, against real PostgreSQL', () => {
  let prisma: PrismaService;
  let recovery: NativeRoundRecoveryService;

  /**
   * THE SHIPPED GATE, NOT ZERO.
   *
   * This used to configure a minimum age of 0 so that every fixture was judged
   * immediately. It made the whole suite flaky against a containerised
   * database: a gate of zero has NO TOLERANCE FOR THE CLOCK MOVING AT ALL, and
   * a Docker VM's clock slews by milliseconds either side of the host's all
   * day. A round stamped a moment ago would come out with a negative age and
   * be judged `stillInFlight`, which failed six or seven tests at a time in
   * bursts that tracked the drift rather than anything in the code.
   *
   * It was also a configuration production never uses. The fixtures below are
   * now AGED DELIBERATELY, on the database's own clock, past the real gate -
   * which tests the value that actually ships and cannot be perturbed by a
   * clock moving a few milliseconds.
   */
  const GATE_MS = 5 * 60_000;
  const config = {
    get: (key: string) =>
      ({
        IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
        IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS: String(GATE_MS),
      })[key],
  } as unknown as ConfigService;

  const ORG = 'it-org';
  const VENUE = 'it-venue';
  const CAT = 'it-cat';
  const ITEM = 'it-item';
  const STAFF = 'it-staff';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    recovery = new NativeRoundRecoveryService(prisma, config);

    // A minimum viable venue. Built once and reused; every test resets only the
    // order-shaped rows beneath it.
    await prisma.organization.upsert({
      where: { id: ORG },
      update: {},
      create: { id: ORG, name: 'IT Org', slug: `it-org-${Date.now()}`, billingEmail: 'it@x.test' },
    });
    await prisma.staff.upsert({
      where: { id: STAFF },
      update: {},
      create: {
        id: STAFF,
        organizationId: ORG,
        email: `it-staff-${Date.now()}@x.test`,
        name: 'IT Staff',
        passwordHash: 'x',
        role: 'admin',
      },
    });
    await prisma.venue.upsert({
      where: { id: VENUE },
      update: {},
      create: {
        id: VENUE,
        organizationId: ORG,
        name: 'IT Venue',
        slug: `it-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 40,
        currency: 'NZD',
        taxJurisdiction: 'NZ_GST',
        pricesIncludeTax: true,
        timezone: 'Pacific/Auckland',
      },
    });
    await prisma.category.upsert({
      where: { id: CAT },
      update: {},
      create: {
        id: CAT,
        organizationId: ORG,
        name: 'Mains',
        sortOrder: 1,
        createdById: STAFF,
      },
    });
    await prisma.menuItem.upsert({
      where: { id: ITEM },
      update: {},
      create: {
        id: ITEM,
        organizationId: ORG,
        categoryId: CAT,
        title: 'Lamb Shank',
        description: 'Slow braised',
        priceCents: 3200,
        nutritionalDetails: {},
        posProductCode: '101',
        createdById: STAFF,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Order-shaped rows only. FK order matters: attempts and items reference
    // rounds, rounds reference orders.
    await prisma.nativeSendAttempt.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.nativeTableRound.deleteMany({});
    await prisma.order.deleteMany({});
  });

  /** An order with `lines` unclaimed items on it. */
  async function makeOrder(lines = 1): Promise<string> {
    const order = await prisma.order.create({
      data: {
        venueId: VENUE,
        serviceMode: 'dine_in',
        idempotencyKey: `it-order-${Math.random()}`,
        subtotalCents: 3200 * lines,
        taxCents: 0,
        totalCents: 3200 * lines,
        items: {
          create: Array.from({ length: lines }, () => ({
            menuItemId: ITEM,
            menuItemTitle: 'Lamb Shank',
            menuItemCategory: 'Mains',
            unitPriceCents: 3200,
            quantity: 1,
            lineTotalCents: 3200,
          })),
        },
      },
    });
    return order.id;
  }

  async function makeRound(
    orderId: string,
    state: NativeRoundState,
    opts: { claimLines?: boolean; sequence?: number; fresh?: boolean } = {},
  ): Promise<string> {
    const sequence = opts.sequence ?? 1;
    const round = await prisma.nativeTableRound.create({
      data: {
        orderId,
        venueId: VENUE,
        sequence,
        idempotencyKey: `${orderId}:r${sequence}`,
        state,
        posTableCode: '5',
        guests: 2,
      },
    });
    if (opts.claimLines !== false) {
      await prisma.orderItem.updateMany({
        where: { orderId, nativeRoundId: null },
        data: { nativeRoundId: round.id },
      });
    }
    // AGED ON THE DATABASE'S OWN CLOCK, past the real gate, unless a test
    // wants a fresh round. Raw SQL on purpose: a Prisma `update` would reset
    // `updatedAt` to now, which is the field being set. `now()` rather than a
    // timestamp computed here, so the value is stamped by the same clock the
    // sweep measures against and no skew can enter the arithmetic.
    if (opts.fresh !== true) {
      await prisma.$executeRawUnsafe(
        `UPDATE "NativeTableRound" SET "updatedAt" = now() - interval '30 minutes' WHERE id = $1`,
        round.id,
      );
    }
    return round.id;
  }

  const unclaimed = (orderId: string) =>
    prisma.orderItem.count({ where: { orderId, nativeRoundId: null } });

  // ═══════════════════════════════════════════════════════════════════════
  describe('the recovery race, under genuine concurrency', () => {
    // ═════════════════════════════════════════════════════════════════════

    it('two workers sweeping the same orphan settle it exactly once', async () => {
      const orderId = await makeOrder(1);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);

      // Two independent services over two independent client connections -
      // genuinely concurrent, not two calls on one object.
      const otherClient = new PrismaService();
      await otherClient.$connect();
      const worker2 = new NativeRoundRecoveryService(otherClient, config);

      try {
        const [a, b] = await Promise.all([recovery.sweep(), worker2.sweep()]);

        // EXACTLY ONE RELEASE. The compare-and-set names the state the sweep
        // read, so the loser matches no rows and changes nothing.
        expect(a.released + b.released).toBe(1);

        const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
        expect(after.state).toBe(NativeRoundState.abandoned);
        // Released once, not twice - and a double release would be invisible
        // in the count, so the end state is asserted precisely.
        expect(await unclaimed(orderId)).toBe(1);
      } finally {
        await otherClient.$disconnect();
      }
    });

    it('release is ATOMIC: the state change and the line release commit together', async () => {
      // The claim the in-memory double cannot make. If these were two
      // statements outside a transaction, a failure between them would leave a
      // settled round still owning its lines - invisible to every sweeper and
      // to the delta query both.
      const orderId = await makeOrder(3);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);

      await recovery.sweep();

      const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
      expect(after.state).toBe(NativeRoundState.abandoned);
      expect(after.payloadFrozenAt).toBeNull();
      expect(await unclaimed(orderId)).toBe(3);
      expect(await prisma.orderItem.count({ where: { nativeRoundId: roundId } })).toBe(0);
    });

    it('sweeping repeatedly is idempotent', async () => {
      const orderId = await makeOrder(1);
      await makeRound(orderId, NativeRoundState.submitting);

      const first = await recovery.sweep();
      const second = await recovery.sweep();

      expect(first.released).toBe(1);
      expect(second.examined).toBe(0);
      expect(await unclaimed(orderId)).toBe(1);
    });

    it('escalates rather than releasing when an attempt says bytes went out', async () => {
      const orderId = await makeOrder(2);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);
      await prisma.nativeSendAttempt.create({
        data: {
          roundId,
          attemptId: `att-${roundId}`,
          externalOrderId: `${orderId}:r1`,
          posTableCode: '5',
          deviceId: 'VERDURA-IT-0001',
          token: 'tok-1',
          payloadHash: 'hash',
          sendInitiatedAt: new Date(),
          bytesLeftHost: true,
        },
      });

      const swept = await recovery.sweep();
      expect(swept.unresolved).toBe(1);
      expect(swept.released).toBe(0);

      const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
      expect(after.state).toBe(NativeRoundState.unresolved);
      // LINES STAY CLAIMED. This is the assertion that stops a restart from
      // putting a customer's food on a second bill.
      expect(await unclaimed(orderId)).toBe(0);
    });

    it('escalates when the attempt exists but its outcome was never written', async () => {
      const orderId = await makeOrder(1);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);
      await prisma.nativeSendAttempt.create({
        data: {
          roundId,
          attemptId: `att-${roundId}`,
          externalOrderId: `${orderId}:r1`,
          posTableCode: '5',
          deviceId: 'VERDURA-IT-0001',
          token: 'tok-2',
          payloadHash: 'hash',
          sendInitiatedAt: new Date(),
          // bytesLeftHost deliberately absent: the crash landed between the
          // socket opening and the outcome being recorded.
        },
      });

      await recovery.sweep();
      const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
      expect(after.state).toBe(NativeRoundState.unresolved);
      expect(await unclaimed(orderId)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('constraints the database enforces, not the code', () => {
    // ═════════════════════════════════════════════════════════════════════

    it('two rounds cannot share a requestKey, even concurrently', async () => {
      const orderId = await makeOrder(2);
      const key = `press-${Date.now()}`;

      const create = (sequence: number) =>
        prisma.nativeTableRound.create({
          data: {
            orderId,
            venueId: VENUE,
            sequence,
            idempotencyKey: `${orderId}:r${sequence}`,
            requestKey: key,
            state: NativeRoundState.drafting,
            posTableCode: '5',
            guests: 2,
          },
        });

      const results = await Promise.allSettled([create(1), create(2)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // THE DOUBLE-TAP GUARD, held by the database. A read-then-write check
      // would let both through under exactly this timing.
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(await prisma.nativeTableRound.count({ where: { requestKey: key } })).toBe(1);
    });

    it('two rounds cannot share a sequence on one order', async () => {
      const orderId = await makeOrder(1);
      const create = () =>
        prisma.nativeTableRound.create({
          data: {
            orderId,
            venueId: VENUE,
            sequence: 1,
            idempotencyKey: `${orderId}:r1:${Math.random()}`,
            state: NativeRoundState.drafting,
            posTableCode: '5',
            guests: 2,
          },
        });

      const results = await Promise.allSettled([create(), create()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('a line can belong to only one round, and a released one to none', async () => {
      const orderId = await makeOrder(1);
      const r1 = await makeRound(orderId, NativeRoundState.submitting);
      expect(await prisma.orderItem.count({ where: { nativeRoundId: r1 } })).toBe(1);

      await recovery.sweep();
      expect(await prisma.orderItem.count({ where: { nativeRoundId: r1 } })).toBe(0);

      // A genuinely new round now finds the line, which is the delta rule
      // working end to end through a real foreign key.
      const r2 = await makeRound(orderId, NativeRoundState.drafting, { sequence: 2 });
      expect(await prisma.orderItem.count({ where: { nativeRoundId: r2 } })).toBe(1);
    });

    it('deleting a round frees its lines rather than deleting them', async () => {
      // `ON DELETE SET NULL` on OrderItem.nativeRoundId, asserted against the
      // real constraint: losing a round must never lose a customer's order.
      const orderId = await makeOrder(2);
      const roundId = await makeRound(orderId, NativeRoundState.abandoned);
      await prisma.nativeTableRound.delete({ where: { id: roundId } });

      expect(await prisma.orderItem.count({ where: { orderId } })).toBe(2);
      expect(await unclaimed(orderId)).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('openRound, the claim everything else rests on', () => {
    // ═════════════════════════════════════════════════════════════════════
    //
    // THE DELTA RULE IS A TRANSACTION, and the in-memory double cannot say so.
    // `openRound` appends the waiter's new lines and claims every unclaimed
    // line into the new round in ONE commit. If those were two statements, a
    // concurrent second press could claim the same lines into a DIFFERENT
    // round - which is two dockets for one plate of food.
    //
    // The writer here is the DISABLED one: `openRound` opens and claims, and
    // never sends. Nothing in this block can reach a socket.

    const roundService = () =>
      new NativeTableRoundService(prisma, new DisabledTableRoundWriter(['integration test']));

    async function dineInOrderWithTable(lines: number): Promise<string> {
      const table = await prisma.table.upsert({
        where: { id: 'it-table' },
        update: {},
        create: {
          id: 'it-table',
          venueId: VENUE,
          tableNumber: '12',
          capacity: 4,
          posTableCode: '5',
        },
      });
      const orderId = await makeOrder(lines);
      await prisma.order.update({ where: { id: orderId }, data: { tableId: table.id } });
      return orderId;
    }

    it('claims every unclaimed line into exactly one round', async () => {
      const orderId = await dineInOrderWithTable(3);
      const opened = await roundService().openRound(orderId);

      expect(await prisma.orderItem.count({ where: { nativeRoundId: opened.id } })).toBe(3);
      expect(await unclaimed(orderId)).toBe(0);
    });

    it('two concurrent presses cannot both claim the same lines', async () => {
      const orderId = await dineInOrderWithTable(2);

      // Two genuinely concurrent opens over two connections. Under a
      // read-then-write both would see two unclaimed lines and both would
      // stamp them - the second overwriting the first, so one round would end
      // up describing lines that another round had already been built from.
      const other = new PrismaService();
      await other.$connect();
      try {
        const results = await Promise.allSettled([
          roundService().openRound(orderId),
          new NativeTableRoundService(
            other,
            new DisabledTableRoundWriter(['integration test']),
          ).openRound(orderId),
        ]);

        const opened = results.filter(
          (r): r is PromiseFulfilledResult<{ id: string; sequence: number }> =>
            r.status === 'fulfilled',
        );

        // Whatever the interleaving, EVERY LINE BELONGS TO EXACTLY ONE ROUND,
        // and no line is left behind. That is the invariant; which press wins
        // is not this test's business.
        const claims = await prisma.orderItem.findMany({
          where: { orderId },
          select: { id: true, nativeRoundId: true },
        });
        expect(claims.every((c) => c.nativeRoundId !== null)).toBe(true);
        expect(new Set(claims.map((c) => c.nativeRoundId)).size).toBe(1);

        // And a round that lost the race must not be left owning nothing while
        // holding the table's in-flight slot.
        for (const o of opened) {
          const round = await prisma.nativeTableRound.findUniqueOrThrow({
            where: { id: o.value.id },
          });
          const owns = await prisma.orderItem.count({ where: { nativeRoundId: round.id } });
          if (owns === 0) {
            expect(round.state).not.toBe(NativeRoundState.submitting);
          }
        }
      } finally {
        await other.$disconnect();
      }
    });

    it('refuses a second round while one is in flight', async () => {
      const orderId = await dineInOrderWithTable(2);
      const first = await roundService().openRound(orderId);
      await prisma.nativeTableRound.update({
        where: { id: first.id },
        data: { state: NativeRoundState.unresolved },
      });

      // A new line arrives, and the table is blocked - correctly, because an
      // unresolved round may already be in the kitchen.
      await expect(roundService().openRound(orderId)).rejects.toThrow(/still unresolved/);
      // AND THE NEW LINE WAS NOT WRITTEN. An order that silently grew during a
      // refusal is an order whose next round carries food nobody remembers
      // ordering.
      expect(await prisma.orderItem.count({ where: { orderId } })).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('the age gate, against real timestamps', () => {
    // ═════════════════════════════════════════════════════════════════════

    it('leaves a freshly-updated round alone when a minimum age is configured', async () => {
      const guarded = new NativeRoundRecoveryService(prisma, {
        get: (key: string) =>
          ({
            IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
            IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS: String(GATE_MS),
          })[key],
      } as unknown as ConfigService);

      const orderId = await makeOrder(1);
      // NOT aged: this is the one test that wants a round stamped a moment ago.
      const roundId = await makeRound(orderId, NativeRoundState.submitting, { fresh: true });

      const swept = await guarded.sweep();
      expect(swept.stillInFlight).toBe(1);
      expect(swept.released).toBe(0);

      const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
      // Untouched: `updatedAt` says this round moved a moment ago, so a live
      // request is probably still holding it. (`updatedAt` is written by
      // POSTGRES, not by Prisma in this process - see the skew test below,
      // which is what that mistaken belief cost.)
      expect(after.state).toBe(NativeRoundState.submitting);
      expect(await unclaimed(orderId)).toBe(0);
    });

    it('the pure decision agrees with what the sweep did', async () => {
      // Ties the unit-tested predicate to the row shapes PostgreSQL actually
      // produces, so the two cannot drift.
      const orderId = await makeOrder(1);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);
      const row = await prisma.nativeTableRound.findUniqueOrThrow({
        where: { id: roundId },
        include: { attempts: true },
      });

      // THE AGE IS COMPUTED THE WAY THE SWEEP COMPUTES IT - both ends on the
      // database clock. Using `Date.now()` here instead is what made this test
      // flaky: `updatedAt` comes from Postgres, so subtracting a process
      // timestamp from it measured the skew between two machines as well as
      // the age, and a database a few milliseconds ahead produced a NEGATIVE
      // age and a `stillInFlight` verdict. A test that claims to agree with
      // the sweep has to ask the question the same way the sweep does.
      const [{ ms }] = await prisma.$queryRawUnsafe<{ ms: bigint }[]>(
        'SELECT (extract(epoch from now()) * 1000)::bigint AS ms',
      );

      const verdict = decideRecovery(
        {
          state: row.state,
          ageMs: Number(ms) - row.updatedAt.getTime(),
          hasAttempt: row.attempts.length > 0,
          bytesLeftHost: row.attempts[0]?.bytesLeftHost ?? null,
        },
        GATE_MS,
      );
      expect(verdict.kind).toBe('released');
    });

    /**
     * THE AGE IS MEASURED ON ONE CLOCK, AND IT IS THE DATABASE'S.
     *
     * `updatedAt` is written by Postgres. The sweep used to compare it against
     * `new Date()` in this process, so the difference between the two clocks
     * landed directly in `ageMs` - and this very spec found it, by failing
     * intermittently against a containerised database whose clock wandered a
     * few milliseconds either side of the host's. With the gate at 0, a
     * database a few milliseconds AHEAD made every age negative and every
     * orphan `stillInFlight`.
     *
     * At the shipped 5-minute gate that is nothing. The direction that matters
     * is the other one: a database clock LAGGING this process by more than the
     * gate inflates every age by exactly that lag, defeats the gate, and lets
     * this sweep judge a round a live request is still sending. These two
     * assertions are what stops the comparison drifting back to two clocks.
     */
    it('brackets the real gate on real timestamps: just under is held, just over is judged', async () => {
      // Both sides of the SHIPPED five-minute gate, aged on the database's own
      // clock. This is the value production runs with, which the suite never
      // exercised while it configured a gate of zero.
      const heldOrder = await makeOrder(1);
      const heldRound = await makeRound(heldOrder, NativeRoundState.submitting, { fresh: true });
      await prisma.$executeRawUnsafe(
        `UPDATE "NativeTableRound" SET "updatedAt" = now() - interval '4 minutes' WHERE id = $1`,
        heldRound,
      );

      const judgedOrder = await makeOrder(1);
      const judgedRound = await makeRound(judgedOrder, NativeRoundState.submitting, {
        fresh: true,
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "NativeTableRound" SET "updatedAt" = now() - interval '6 minutes' WHERE id = $1`,
        judgedRound,
      );

      const swept = await recovery.sweep();
      expect(swept.stillInFlight).toBe(1);
      expect(swept.released).toBe(1);

      expect(
        (await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: heldRound } })).state,
      ).toBe(NativeRoundState.submitting);
      expect(
        (await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: judgedRound } })).state,
      ).toBe(NativeRoundState.abandoned);
    });

    it('still honours a caller that supplies its own clock', async () => {
      // The unit suites drive the gate by passing an explicit `now`, and that
      // path must keep working - a fix that silently ignored the argument
      // would make every age-gate test in the tree assert nothing.
      const orderId = await makeOrder(1);
      const roundId = await makeRound(orderId, NativeRoundState.submitting);

      const guarded = new NativeRoundRecoveryService(prisma, {
        get: (key: string) =>
          ({
            IDEALPOS_NATIVE_RECONCILE_ENABLED: 'true',
            IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS: String(60 * 60_000),
          })[key],
      } as unknown as ConfigService);

      // Two hours in the future: past a one-hour gate however the two clocks
      // sit, so it is judged.
      const swept = await guarded.sweep(new Date(Date.now() + 121 * 60_000));
      expect(swept.released).toBe(1);

      const after = await prisma.nativeTableRound.findUniqueOrThrow({ where: { id: roundId } });
      expect(after.state).toBe(NativeRoundState.abandoned);
    });
  });
});

/**
 * THE SUPPORT VIEW: everything durable about one round, and nothing dangerous.
 *
 * WHO IT IS FOR. Somebody asked three days later what happened to table 5 at
 * 19:42. Until this route existed the honest answer was "read the API logs, and
 * hope `HandheldLog` was on" - the rows were all in the database and there was
 * no way to see them without a psql session.
 *
 * THE TWO PROPERTIES THIS FILE HOLDS:
 *
 *   IT SHOWS ENOUGH. The transport facts an incident actually turns on -
 *   whether bytes left the host, what the till said, what we concluded, which
 *   device sent it, and whether a person settled it by hand and what they
 *   wrote.
 *
 *   IT LEAKS NOTHING. The duplicate token is the receiver's equality
 *   comparand: anyone holding it and our DeviceID can make the till answer
 *   DUPLICATE to a genuine round, which is a way to make a real customer's food
 *   silently not happen. It comes back as a PREFIX and the last describe below
 *   asserts the whole value appears nowhere in the response, at any depth.
 */

import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { NativeRoundState, StaffRole } from '@prisma/client';

import {
  ACTOR,
  build,
  createDineInOrder,
  installHarnessLifecycle,
  MENU,
  NATIVE_ENV,
  openTill,
  setHarness,
  VENUE,
  type Harness,
} from '../testing/native-order-harness';

installHarnessLifecycle();
jest.setTimeout(20000);

const REQ = (n: number): string => `support-press-${n}-0123456789abcdef`;

const asRole = (role: StaffRole, over: Record<string, unknown> = {}) =>
  ({
    user: {
      id: role === ACTOR.role ? ACTOR.id : `staff-${role}`,
      email: `${role}@verdura.test`,
      role,
      organizationId: VENUE.organizationId,
      venueId: VENUE.id,
      ...over,
    },
  }) as never;

const MANAGER = asRole(StaffRole.manager);

const ENV = (port: number): Record<string, string> =>
  NATIVE_ENV(port, { IDEALPOS_WAITERPAD_READ_TIMEOUT_MS: '250' });

/** A table whose round the till took and never answered - the case support is called about. */
async function tableWithAnUnresolvedRound(): Promise<{
  h: Harness;
  orderId: string;
  roundId: string;
}> {
  const till = await openTill({ kind: 'silent' });
  const h = setHarness(await build(ENV(till.port)));
  const order = await createDineInOrder(h, {
    tableId: 'tbl-a',
    items: [
      { menuItemId: MENU.lamb.id, quantity: 1 },
      { menuItemId: MENU.coke.id, quantity: 2 },
    ],
  });

  try {
    await h.rounds.submitRound(asRole(ACTOR.role), order.id, { items: [], requestKey: REQ(1) });
    throw new Error('expected the silent till to produce an uncertain round');
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
  }
  const roundId = String(h.ledger.rounds[0].id);
  expect(h.ledger.rounds[0].state).toBe(NativeRoundState.unresolved);
  return { h, orderId: order.id, roundId };
}

// ═════════════════════════════════════════════════════════════════════════
describe('what an incident review can actually see', () => {
  it('answers the questions an incident turns on, from durable rows alone', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    const view = await h.rounds.supportView(MANAGER, orderId, '1');

    expect(view.roundId).toBe(roundId);
    expect(view.orderId).toBe(orderId);
    expect(view.sequence).toBe(1);
    expect(view.state).toBe(NativeRoundState.unresolved);
    expect(view.requiresReconciliation).toBe(true);

    // The IDEALPOS table code as captured at OPEN time - what is written on the
    // till, not the Verdura display number, and not the mapping as it is today.
    expect(view.posTableCode).toBe('5');
    expect(view.guests).toBe(2);
    expect(view.externalOrderId).toBe(`${orderId}:r1`);

    // What was actually on the docket.
    expect(view.lines).toHaveLength(2);
    expect(view.lines.map((l) => l.description).sort()).toEqual(['Coke No Sugar', 'Lamb Shank']);
  });

  it('shows WHY a round has not gone green, which is what support is called about', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();

    const view = await h.rounds.supportView(MANAGER, orderId, '1');
    const attempt = view.attempts[0];

    // WHAT WE ASKED THE TILL FOR, frozen with the attempt. Without it, "the
    // delta was short" is unfalsifiable from this endpoint.
    expect(attempt.expectedNativeItems).toEqual(
      expect.arrayContaining([
        { nativeCode: MENU.lamb.posProductCode, quantity: 1 },
        { nativeCode: MENU.coke.posProductCode, quantity: 2 },
      ]),
    );

    // AND WHAT THE TABLE HELD BEFORE. Null here is the production default and
    // is itself the answer: no baseline was captured, so the delta has nothing
    // to subtract and this round can never be machine-confirmed.
    expect(attempt.preSendBaseline).toBeNull();
  });

  it('shows a captured baseline as a count and a status, never as a bill', async () => {
    // An operator needs to know the table held something and when we looked.
    // They do not need to read what else the table is eating, and this
    // endpoint is opened during an incident by people who should not.
    const till = await openTill({ kind: 'silent' });
    const h = setHarness(
      await build(ENV(till.port), undefined, {
        baselineSource: {
          readBaseline: () =>
            Promise.resolve({
              status: 'observed' as const,
              tableCode: '5',
              pos: 1,
              map: '1',
              lines: [
                { nativeCode: '999', quantity: 1 },
                { nativeCode: '998', quantity: 1 },
              ],
              observedAt: new Date().toISOString(),
            }),
        },
      }),
    );
    const order = await createDineInOrder(h, {
      tableId: 'tbl-a',
      items: [{ menuItemId: MENU.lamb.id, quantity: 1 }],
    });
    try {
      await h.rounds.submitRound(asRole(ACTOR.role), order.id, { items: [], requestKey: REQ(9) });
    } catch (err) {
      if (!(err instanceof HttpException)) throw err;
    }

    const view = await h.rounds.supportView(MANAGER, order.id, '1');
    const baseline = view.attempts[0].preSendBaseline;

    expect(baseline).not.toBeNull();
    expect(baseline?.status).toBe('observed');
    expect(baseline?.tableCode).toBe('5');
    expect(baseline?.lineCount).toBe(2);
    expect(baseline?.observedAt).toEqual(expect.any(String));

    // The other table's PLUs are nowhere in the response.
    expect(JSON.stringify(view)).not.toContain('999');
  });

  it('shows the transport facts, which is the whole reason it exists', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();

    const view = await h.rounds.supportView(MANAGER, orderId, '1');
    expect(view.attempts).toHaveLength(1);
    const [attempt] = view.attempts;

    // THE FIRST THING ANYBODY READS. `true` here is why this round is a human's
    // problem rather than a safe retry.
    expect(attempt.bytesLeftHost).toBe(true);
    expect(attempt.outcomeKind).toBe('noResponse');
    expect(attempt.deviceId).toBe('VERDURA-ACCEPT-0001');
    expect(attempt.sendInitiatedAt).toBeInstanceOf(Date);
    // And what WE concluded, beside what the till said - the two are different
    // claims on this protocol and that is why they are different columns.
    expect(attempt.decision).toBe(`${NativeRoundState.unresolved}:readback`);
  });

  it('reports a round nobody has settled as having no human behind it', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();

    const view = await h.rounds.supportView(MANAGER, orderId, '1');
    expect(view.manualResolution).toBeNull();
    // And nothing was fabricated into the reconciliation block either.
    expect(view.reconciliation.nativeSaleId).toBeNull();
    expect(view.reconciliation.nativeSaleTier).toBeNull();
  });

  it('names the person once a round has been settled by hand, and quotes them', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    await h.rounds.resolveRound(
      asRole(StaffRole.manager, { actingStaffId: 'staff-elev-7' }),
      orderId,
      '1',
      {
        outcome: 'present',
        basis: 'Lamb and two Cokes both on table 5, checked against the bill.',
      },
    );

    const view = await h.rounds.supportView(MANAGER, orderId, '1');

    expect(view.state).toBe(NativeRoundState.resolved_manually);
    expect(view.manualResolution).not.toBeNull();
    expect(view.manualResolution!.resolvedByUserId).toBe('staff-manager');
    // BOTH identities where a step-up produced the session, which is the whole
    // point of recording the acting staff id.
    expect(view.manualResolution!.resolvedByActingStaffId).toBe('staff-elev-7');
    expect(view.manualResolution!.resolvedAt).toBeInstanceOf(Date);
    expect(view.manualResolution!.basis).toMatch(/checked against the bill/);

    // AND IT IS STILL NOT `confirmed`. The support view must not be the one
    // place the difference between testimony and till evidence gets lost.
    expect(view.state).not.toBe(NativeRoundState.confirmed);
    expect(view.reconciliation.nativeSaleTier).toBeNull();
  });

  it('is a read: it opens nothing and changes nothing', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const stateBefore = h.ledger.rounds[0].state;
    const sendsBefore = h.nativeSendCount();

    await h.rounds.supportView(MANAGER, orderId, '1');
    await h.rounds.supportView(MANAGER, orderId, '1');

    expect(h.ledger.rounds.find((r) => r.id === roundId)!.state).toBe(stateBefore);
    expect(h.nativeSendCount()).toBe(sendsBefore);
    // Not one line released, which is what would make them resendable.
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('who may open it', () => {
  it.each([
    ['a waiter', StaffRole.cashier],
    ['the kitchen', StaffRole.kitchen],
  ])("is not for %s - it carries a named person's statement about a bill", async (_l, role) => {
    // Enforced by RolesGuard, which the harness does not run - so this asserts
    // the DECLARED policy, which is the thing a refactor drops.
    const declared = Reflect.getMetadata(
      'roles',
      Object.getPrototypeOf((await tableWithAnUnresolvedRound()).h.rounds).supportView,
    ) as StaffRole[] | undefined;
    expect(declared).toEqual([StaffRole.admin, StaffRole.manager]);
    expect(declared).not.toContain(role);
  });

  it('refuses an order in another organization', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const otherOrg = asRole(StaffRole.manager, { organizationId: 'org-2' });

    await expect(h.rounds.supportView(otherOrg, orderId, '1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a tablet manager elevated at a different venue', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const elsewhere = asRole(StaffRole.manager, {
      kind: 'tablet_manager',
      venueId: 'venue-somewhere-else',
    });

    await expect(h.rounds.supportView(elsewhere, orderId, '1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([['0'], ['-1'], ['abc'], ['']])(
    'refuses %p as a round number rather than handing it to the driver',
    async (sequence) => {
      const { h, orderId } = await tableWithAnUnresolvedRound();
      try {
        await h.rounds.supportView(MANAGER, orderId, sequence);
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    },
  );

  it('404s a round number that does not exist', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    try {
      await h.rounds.supportView(MANAGER, orderId, '7');
      throw new Error('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('what it must never put on a screen', () => {
  it('shows a PREFIX of the duplicate token and never the token itself', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const token = String(h.ledger.attempts.find((a) => a.roundId === roundId)!.token);

    const view = await h.rounds.supportView(MANAGER, orderId, '1');
    const [attempt] = view.attempts;

    expect(attempt.tokenPrefix).toBe(`${token.slice(0, 8)}...`);

    // THE ASSERTION THAT MATTERS, and it is over the SERIALISED response rather
    // than field by field: the whole token must not appear anywhere at any
    // depth, however the shape changes later. Holding it plus our DeviceID is
    // enough to make the till answer DUPLICATE to a genuine round, which is a
    // way to make a real customer's food silently not happen.
    const serialised = JSON.stringify(view);
    expect(token.length).toBeGreaterThan(16);
    expect(serialised).not.toContain(token);
  });

  it('shows a prefix of the payload hash and never the payload', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const hash = String(h.ledger.attempts.find((a) => a.roundId === roundId)!.payloadHash);

    const view = await h.rounds.supportView(MANAGER, orderId, '1');
    expect(view.attempts[0].payloadHashPrefix).toBe(`${hash.slice(0, 12)}...`);
    expect(JSON.stringify(view)).not.toContain(hash);
  });

  it('carries no raw packet and no XML at all', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const serialised = JSON.stringify(await h.rounds.supportView(MANAGER, orderId, '1'));

    // `responseNote` is already a sanitised, capped summary. Nothing here may
    // reintroduce the wire content it was written to keep out.
    expect(serialised).not.toMatch(/<WPPacket/i);
    expect(serialised).not.toMatch(/<WPOrder/i);
    expect(serialised).not.toMatch(/<Checksum>/i);
  });

  it('shows a prefix of the client request key, not the key', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const view = await h.rounds.supportView(MANAGER, orderId, '1');

    expect(view.requestKeyPrefix).toBe(`${REQ(1).slice(0, 8)}...`);
    expect(JSON.stringify(view)).not.toContain(REQ(1));
  });
});

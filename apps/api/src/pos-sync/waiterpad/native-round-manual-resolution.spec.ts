/**
 * SETTLING A ROUND ON A HUMAN'S WORD, AND THE THINGS THAT MUST STAY IMPOSSIBLE.
 *
 * WHY THIS ROUTE EXISTS AT ALL. `unresolved` holds a table's single in-flight
 * slot, and its only machine exits - `confirmed` and `failed` - are written by
 * the reconciler from evidence read off the till. No build binds an evidence
 * reader yet. So in the configuration this integration actually ships in, every
 * round that goes unproven escalates to `unresolved` when its window runs out
 * and the table is finished for the rest of the service. This is the way back.
 *
 * THE ASYMMETRY THIS FILE IS REALLY ABOUT. An earlier design offered a manager
 * two symmetrical answers - `landed` and `didNotLand` - and `didNotLand`
 * released the round's lines so they could be sent again. That is a duplicate
 * docket waiting for one honest mistake, because a manager who cannot see a
 * round has not observed its absence: the receiver ACKs before durable
 * processing, a packet can sit in a 200-slot buffer waiting for a drain loop,
 * the kitchen printer runs behind, and the manager may simply be at the wrong
 * table. Every one of those reads as "I cannot see it" while the food is on its
 * way to the customer.
 *
 * So the two outcomes here are NOT opposites, and this file's job is to hold
 * them apart:
 *
 *   present   an OBSERVATION. Settles the round, frees the table, and keeps
 *             every line claimed forever.
 *   notFound  a FAILURE TO OBSERVE. Recorded, and changes NOTHING - not the
 *             state, not a line, not the table.
 *
 * NO PATH THROUGH THIS ROUTE RELEASES A LINE OR OPENS A SOCKET. The last
 * describe asserts exactly that over every outcome, rather than trusting that a
 * future edit would notice.
 */

/*
 * The role policy is read off `NativeRoundsController.prototype.resolveRound`,
 * which is exactly the unbound reference this rule warns about - and exactly
 * what `Reflector` wants: the metadata hangs on the method, and binding it
 * would read nothing. Same waiver as connector-auth.guard.spec.ts.
 */
/* eslint-disable @typescript-eslint/unbound-method */

import { ExecutionContext, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NativeRoundState, StaffRole } from '@prisma/client';

import { NativeRoundsController } from '../native-rounds.controller';
import { AuditLogService } from '../../audit/audit.service';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import {
  ACTOR,
  build,
  createDineInOrder,
  installHarnessLifecycle,
  MENU,
  NATIVE_ENV,
  openTill,
  setHarness,
  tillServer,
  VENUE,
  type Harness,
  type Row,
} from '../testing/native-order-harness';

installHarnessLifecycle();
jest.setTimeout(20000);

const line = (item: { id: string }, quantity = 1) => ({ menuItemId: item.id, quantity });
const REQ = (n: number): string => `resolve-press-${n}-0123456789abcdef`;

/** A caller with a given role, exactly as the guards would have left the request. */
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

/**
 * The read timeout, at the configuration floor.
 *
 * Almost every test here starts from a round the till swallowed in silence,
 * and reaching that state costs one full read timeout each. HOW LONG the
 * writer waits before giving up is a property of the transport and is asserted
 * where it belongs, in `waiterpad-transport-timers.spec.ts`; here it is only
 * the cost of arriving at `unresolved`, and paying the production default for
 * it turned this file into six minutes of waiting. Nothing below depends on
 * the value - only on the round that a timed-out read produces.
 */
const ENV = (port: number, over: Record<string, string> = {}): Record<string, string> =>
  NATIVE_ENV(port, { IDEALPOS_WAITERPAD_READ_TIMEOUT_MS: '250', ...over });

async function open(env: Record<string, string>): Promise<Harness> {
  return setHarness(await build(env));
}

/**
 * A table with one round stuck `unresolved`, which is the only state this route
 * may touch - reached the way production reaches it, by a till that takes the
 * bytes and says nothing.
 */
async function tableWithAnUnresolvedRound(): Promise<{
  h: Harness;
  orderId: string;
  roundId: string;
}> {
  const till = await openTill({ kind: 'silent' });
  const h = await open(ENV(till.port));
  const order = await createDineInOrder(h, {
    tableId: 'tbl-a',
    items: [line(MENU.lamb), line(MENU.coke)],
  });

  let roundId: string;
  try {
    await h.rounds.submitRound(asRole(ACTOR.role), order.id, { items: [], requestKey: REQ(1) });
    throw new Error('expected the silent till to produce an uncertain round');
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.status).toBe('uncertain');
    roundId = body.roundId as string;
  }

  expect(h.ledger.rounds.find((r) => r.id === roundId)?.state).toBe(NativeRoundState.unresolved);
  return { h, orderId: order.id, roundId };
}

const roundOf = (h: Harness, roundId: string): Row =>
  h.ledger.rounds.find((r) => r.id === roundId) as Row;

/**
 * The audit rows THIS ROUTE wrote, and only those.
 *
 * Seeding a table writes its own `CREATE_ORDER` row through the same audit
 * service, so an unfiltered count would be asserting about the fixture. The
 * filter is on `resource` rather than on the two action names deliberately: a
 * future outcome that wrote a third action would still be counted here, and a
 * test that says "this refusal wrote NOTHING about the round" has to mean it.
 */
const roundAudit = (h: Harness): Row[] =>
  h.auditEvents().filter((e) => e.resource === 'native_table_round');

/** Resolve, returning the refusal body rather than throwing, for the negative cases. */
async function resolveExpectingRefusal(
  h: Harness,
  req: unknown,
  orderId: string,
  sequence: number | string,
  outcome: 'present' | 'notFound' = 'present',
  basis = 'I checked table 5 on the till just now and here is what I saw.',
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await h.rounds.resolveRound(req as never, orderId, String(sequence), { outcome, basis });
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
    }
    throw err;
  }
  throw new Error('expected the handler to refuse, but it accepted');
}

/** A Send press that is expected to be refused, returning the refusal body. */
async function sendExpectingRefusal(
  h: Harness,
  orderId: string,
  press: number,
  items: { menuItemId: string; quantity: number }[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await h.rounds.submitRound(asRole(ACTOR.role), orderId, { items, requestKey: REQ(press) });
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
    }
    throw err;
  }
  throw new Error('expected the handler to refuse, but it accepted');
}

// ═════════════════════════════════════════════════════════════════════════
describe('the evidence a manager is shown before they may attest', () => {
  it('renders the whole docket - table, covers, items, PLUs, seats, send time', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    const {
      rounds: [round],
    } = await h.rounds.listRounds(MANAGER, orderId);

    expect(round.roundId).toBe(roundId);
    expect(round.state).toBe(NativeRoundState.unresolved);
    expect(round.requiresReconciliation).toBe(true);

    // THE PANEL ITSELF. Its absence is what made the first version of this
    // dialog a blank textarea under the question "what do you see on this
    // table?" - a formality with a signature on it.
    const panel = round.attestation;
    expect(panel).not.toBeNull();

    // The IDEALPOS table code, which is what is written on the till - not the
    // Verdura display number. The harness deliberately makes them differ.
    expect(panel!.posTableCode).toBe('5');
    expect(panel!.guests).toBe(2);
    expect(panel!.externalOrderId).toBe(`${orderId}:r1`);

    const shown = [...panel!.lines].sort((a, b) => a.description.localeCompare(b.description));
    expect(shown.map((l) => l.description)).toEqual(['Coke No Sugar', 'Lamb Shank']);
    expect(shown.map((l) => l.plu)).toEqual(['201', '101']);
    expect(shown.map((l) => l.quantity)).toEqual([1, 1]);
    expect(shown.every((l) => 'seat' in l)).toBe(true);

    // The send clock the escalation runs against, so the screen can say how
    // long this has been unproven rather than only that it is.
    expect(round.sendInitiatedAt).toBeInstanceOf(Date);
    expect(round.lineCount).toBe(2);

    // AND THE SAME INSTANT INSIDE THE DOCKET. It is carried in the panel as
    // well as beside it because the panel is what a manager reads at the till,
    // and one assembled from two places is one that can render half-empty -
    // "sent at" missing from a screen somebody is about to vouch from.
    expect(panel!.sentAt).toEqual(round.sendInitiatedAt);
  });

  it('shows a SHORT token prefix and never the whole token', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    const {
      rounds: [round],
    } = await h.rounds.listRounds(MANAGER, orderId);
    const prefix = round.attestation!.tokenPrefix!;
    const token = String(h.ledger.attempts.find((a) => a.roundId === roundId)!.token);

    expect(prefix).toBe(`${token.slice(0, 8)}...`);
    // Enough to match a row during an incident review; NOT enough to
    // reconstruct a token and present it to a till.
    expect(prefix).not.toBe(token);
    expect(token.length).toBeGreaterThan(12);
  });

  it('attaches no panel to a round nobody may attest to', async () => {
    const till = await openTill({ kind: 'ack' });
    const h = await open(ENV(till.port));
    const order = await createDineInOrder(h, { tableId: 'tbl-a', items: [line(MENU.lamb)] });
    await h.rounds.submitRound(asRole(ACTOR.role), order.id, { items: [], requestKey: REQ(1) });

    const {
      rounds: [round],
    } = await h.rounds.listRounds(MANAGER, order.id);
    expect(round.state).toBe(NativeRoundState.awaiting_native_confirmation);
    expect(round.requiresReconciliation).toBe(false);
    // A round with no question to answer must not carry an attestation panel,
    // or a UI will render the dialog beside it.
    expect(round.attestation).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('who is allowed to settle a customer bill by hand', () => {
  /** The REAL guard, over the REAL metadata the route carries. */
  const guardFor = (role: StaffRole): boolean => {
    const guard = new RolesGuard(new Reflector());
    const ctx = {
      getType: () => 'http',
      getHandler: () => NativeRoundsController.prototype.resolveRound,
      getClass: () => NativeRoundsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  };

  it('declares a role policy at all - an undeclared route is open to every staff role', () => {
    const declared = new Reflector().get<StaffRole[]>(
      ROLES_KEY,
      NativeRoundsController.prototype.resolveRound,
    );
    expect(Array.isArray(declared)).toBe(true);
    expect(declared).toEqual([StaffRole.admin, StaffRole.manager]);
  });

  it.each([
    ['a waiter', StaffRole.cashier],
    ['the kitchen', StaffRole.kitchen],
  ])('refuses %s - vouching for a bill is not a service-floor action', (_label, role) => {
    expect(() => guardFor(role)).toThrow(ForbiddenException);
  });

  it.each([
    ['a manager', StaffRole.manager],
    ['an admin', StaffRole.admin],
    // Consistent with every other route in this application: `owner` is the
    // documented super-user and RolesGuard lets it past any policy. Asserted
    // rather than assumed, so a change to that rule shows up here too.
    ['an owner', StaffRole.owner],
  ])('allows %s', (_label, role) => {
    expect(guardFor(role)).toBe(true);
  });

  /**
   * THE SCOPE RULE IS THE APPLICATION'S, NOT THIS ROUTE'S, and this pins which
   * one it is rather than inventing a stricter one here.
   *
   * `resolveVenueScope` restricts DEVICE-ISSUED tokens - `tablet_device`,
   * `tablet_staff`, `tablet_manager`, `kds_device` - to the venue they were
   * issued for, and leaves full staff logins org-wide, matching the RBAC every
   * other route on this controller applies. That is the right split here and
   * not merely the inherited one: a floor manager reaches this button through a
   * tablet PIN step-up, which is exactly the token kind that IS pinned to a
   * venue, while a full staff login already carries org-wide reach over these
   * orders on the read route beside it. A rule that differed from its
   * neighbour's is how a route that "only reads" and a route that settles bills
   * end up disagreeing about who the caller is.
   */
  it('refuses a tablet manager elevated at a DIFFERENT venue - the token is pinned', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    // How a manager actually reaches this button: a PIN step-up on a tablet
    // that was provisioned for some other restaurant in the same group.
    const elsewhere = asRole(StaffRole.manager, {
      kind: 'tablet_manager',
      venueId: 'venue-somewhere-else',
      actingStaffId: 'staff-elevated-3',
    });

    await expect(
      h.rounds.resolveRound(elsewhere, orderId, '1', {
        outcome: 'present',
        basis: 'I am looking at a till in a different restaurant entirely.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(roundOf(h, roundId).state).toBe(NativeRoundState.unresolved);
    expect(roundAudit(h)).toHaveLength(0);
  });

  it('lets a full staff manager in the same organization through, as RBAC does everywhere', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    // No `kind`: a real staff login, org-wide by the documented policy. Pinned
    // deliberately - if this route is ever narrowed to a single venue, that is
    // a decision somebody should have to come here and make, not something
    // that happens by accident to the shared helper.
    const sameOrg = asRole(StaffRole.manager, { venueId: 'venue-somewhere-else' });

    await h.rounds.resolveRound(sameOrg, orderId, '1', {
      outcome: 'present',
      basis: 'Head office manager covering this restaurant; checked the till here.',
    });

    expect(roundOf(h, roundId).state).toBe(NativeRoundState.resolved_manually);
  });

  it('refuses a round belonging to another organization', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    // Venue-scoped correctly but a different tenant: the org check is the one
    // that has to hold, and it is a separate check for that reason.
    const otherOrg = asRole(StaffRole.manager, { organizationId: 'org-2', venueId: VENUE.id });

    await expect(
      h.rounds.resolveRound(otherOrg, orderId, '1', {
        outcome: 'present',
        basis: 'I belong to another organization and should not see this at all.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(roundOf(h, roundId).state).toBe(NativeRoundState.unresolved);
    expect(roundAudit(h)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('ATTESTED PRESENT settles the round and frees the table', () => {
  it('writes resolved_manually, names the person, and keeps every line claimed', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    expect(h.ledger.items.filter((i) => i.nativeRoundId === roundId)).toHaveLength(2);

    const result = await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Lamb Shank and a Coke are both on table 5 in IdealPOS, I checked the bill.',
    });

    expect(result.outcome).toBe('present');
    expect(result.state).toBe(NativeRoundState.resolved_manually);
    expect(result.settled).toBe(true);
    // THE FIELD THAT MATTERS MOST, and it is explicit rather than inferred.
    expect(result.linesReleased).toBe(false);

    const round = roundOf(h, roundId);
    expect(round.state).toBe(NativeRoundState.resolved_manually);
    // FROM THE TOKEN, never from the body - the whole value of this record is
    // that it names somebody who can be asked.
    expect(round.resolvedByUserId).toBe('staff-manager');
    expect(String(round.resolutionBasis)).toMatch(/Lamb Shank and a Coke/);
    expect(round.resolvedAt).toBeInstanceOf(Date);

    // The lines never moved.
    expect(h.ledger.items.filter((i) => i.nativeRoundId === roundId)).toHaveLength(2);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
  });

  it('is NOT confirmed, and fabricates no machine sale reference or causal tier', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Both items are showing on the table in IdealPOS right now.',
    });

    const round = roundOf(h, roundId);
    // A human cannot tell "our round put these here" from "somebody keyed the
    // same food". Inventing an id or a causal tier would make the strongest
    // claim in the system unfalsifiable by making it unattributable.
    expect(round.state).not.toBe(NativeRoundState.confirmed);
    expect(round.nativeSaleId ?? null).toBeNull();
    expect(round.nativeSaleTier ?? null).not.toBe('causal');

    // And the READBACK keeps them apart too, so a screen cannot render
    // testimony as machine evidence on the operator's behalf.
    const {
      rounds: [view],
    } = await h.rounds.listRounds(MANAGER, orderId);
    expect(view.status).toBe('resolvedManually');
    expect(view.status).not.toBe('confirmed');
    expect(view.settled).toBe(true);
    expect(view.requiresReconciliation).toBe(false);
  });

  it('frees the table, and the NEXT round carries only what is new', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const sentBefore = tillServer().requests.length;

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Lamb and Coke are on table 5. Confirmed against the printed bill.',
    });

    // The waiter adds a dessert and presses Send. The table is free again.
    // This till is silent, so round two is uncertain too - which is fine and is
    // not what this test is about. What matters is what the packet CONTAINED.
    const next = await sendExpectingRefusal(h, orderId, 2, [line(MENU.tiramisu)]);
    expect(next.body.roundId).not.toBe(roundId);
    expect(next.body.error).not.toBe('round_in_flight');

    // THE PACKET IS THE ASSERTION. The attested round's lines must not be in
    // it - that is the duplicate docket this whole module exists to prevent.
    const packet = tillServer().requests[sentBefore];
    expect(packet).toContain('<StockItem>301</StockItem>');
    expect(packet).not.toContain('<StockItem>101</StockItem>');
    expect(packet).not.toContain('<StockItem>201</StockItem>');

    // Exactly one further send.
    expect(tillServer().requests).toHaveLength(sentBefore + 1);
  });

  it('is terminal: a settled round cannot be resolved a second time', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Everything on this round is on table 5 in IdealPOS.',
    });
    const settledAt = roundOf(h, roundId).resolvedAt;

    const again = await resolveExpectingRefusal(h, MANAGER, orderId, 1);
    expect(again.status).toBe(HttpStatus.CONFLICT);
    expect(again.body.error).toBe('already_resolved');

    // Nor may a `notFound` note reopen it.
    const note = await resolveExpectingRefusal(h, MANAGER, orderId, 1, 'notFound');
    expect(note.body.error).toBe('already_resolved');

    expect(roundOf(h, roundId).state).toBe(NativeRoundState.resolved_manually);
    expect(roundOf(h, roundId).resolvedAt).toBe(settledAt);
  });

  it('a double-click settles once and refuses the second, changing nothing', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    const [first, second] = await Promise.allSettled([
      h.rounds.resolveRound(MANAGER, orderId, '1', {
        outcome: 'present',
        basis: 'First click: the round is on table 5 in IdealPOS.',
      }),
      h.rounds.resolveRound(MANAGER, orderId, '1', {
        outcome: 'present',
        basis: 'Second click: the round is on table 5 in IdealPOS.',
      }),
    ]);

    expect([first, second].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([first, second].filter((r) => r.status === 'rejected')).toHaveLength(1);

    // One resolution, and the compare-and-set held.
    expect(roundOf(h, roundId).state).toBe(NativeRoundState.resolved_manually);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('NOT FOUND records the check and changes absolutely nothing', () => {
  it('leaves the state, the lines and the table exactly as they were', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const before = JSON.stringify({
      round: roundOf(h, roundId),
      claimed: h.ledger.items.map((i) => i.nativeRoundId),
    });

    const result = await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'notFound',
      basis: 'I looked at table 5 in IdealPOS twice and I cannot see this round on it.',
    });

    expect(result.outcome).toBe('notFound');
    expect(result.state).toBe(NativeRoundState.unresolved);
    expect(result.settled).toBe(false);
    expect(result.linesReleased).toBe(false);

    // ABSENCE OF OBSERVATION IS NOT PROOF OF NON-DELIVERY: not one durable
    // field moved, including the resolution columns.
    expect(
      JSON.stringify({
        round: roundOf(h, roundId),
        claimed: h.ledger.items.map((i) => i.nativeRoundId),
      }),
    ).toBe(before);
  });

  it('tells staff to settle it on the till, and NOT to re-send it', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();

    const result = await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'notFound',
      basis: 'Nothing on table 5 that looks like this round, checked at 8:40pm.',
    });

    expect(result.message).toMatch(/NOTHING HAS CHANGED/i);
    expect(result.message).toMatch(/have NOT been sent again/i);
    expect(result.message).toMatch(/IdealPOS/);
    expect(result.message).toMatch(/Do not re-?send/i);
  });

  it('does NOT unblock the table - the round is still the one in flight', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const sentBefore = tillServer().requests.length;

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'notFound',
      basis: 'Cannot see this round on table 5 in IdealPOS at all.',
    });

    const blocked = await sendExpectingRefusal(h, orderId, 3, [line(MENU.tiramisu)]);
    expect(blocked.status).toBe(HttpStatus.CONFLICT);
    expect(blocked.body.error).toBe('round_in_flight');
    expect(blocked.body.safeToRetry).toBe(false);

    // NOT ONE FURTHER BYTE. This is the branch the deleted `didNotLand`
    // outcome used to make sendable.
    expect(tillServer().requests).toHaveLength(sentBefore);
  });

  it('can be recorded repeatedly - it is a note, not a transition', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    for (const at of ['8:40pm', '8:55pm', '9:10pm']) {
      const r = await h.rounds.resolveRound(MANAGER, orderId, '1', {
        outcome: 'notFound',
        basis: `Checked table 5 in IdealPOS at ${at} and still cannot see this round.`,
      });
      expect(r.state).toBe(NativeRoundState.unresolved);
      expect(r.linesReleased).toBe(false);
    }
    expect(roundOf(h, roundId).state).toBe(NativeRoundState.unresolved);

    // Still recoverable by the honest answer, which is the point of leaving it
    // unresolved rather than settling it on a failure to see something.
    const present = await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'The kitchen printer caught up - the round IS on table 5 after all.',
    });
    expect(present.state).toBe(NativeRoundState.resolved_manually);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('the states this route refuses to touch', () => {
  it.each([
    [
      'awaiting confirmation - the machine may yet settle it on real evidence',
      NativeRoundState.awaiting_native_confirmation,
    ],
    ['submitting - a socket may be open for it this instant', NativeRoundState.submitting],
    ['drafting - it has not been sent', NativeRoundState.drafting],
    ['confirmed - machine evidence is never overwritten by testimony', NativeRoundState.confirmed],
    ['failed - it is settled, and re-settling it rewrites history', NativeRoundState.failed],
    ['abandoned - it is settled', NativeRoundState.abandoned],
  ])('refuses %s', async (_label, state) => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    roundOf(h, roundId).state = state;

    const refusal = await resolveExpectingRefusal(h, MANAGER, orderId, 1);
    expect(refusal.status).toBe(HttpStatus.CONFLICT);
    expect(refusal.body.error).toBe('not_resolvable');
    expect(roundOf(h, roundId).state).toBe(state);
    expect(roundAudit(h)).toHaveLength(0);
  });

  it('loses to a reconciler that confirmed the round between the read and the write', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const round = roundOf(h, roundId);

    // THE RACE ITSELF. `resolveRound` reads the round to produce a refusal that
    // can name the state, then writes conditionally on it STILL being
    // unresolved. This getter answers the read with `unresolved` and everything
    // after it with `confirmed` - which is exactly what a reconciler landing a
    // real confirmation in that window looks like.
    let reads = 0;
    Object.defineProperty(round, 'state', {
      configurable: true,
      get: () => (++reads === 1 ? NativeRoundState.unresolved : NativeRoundState.confirmed),
    });

    const refusal = await resolveExpectingRefusal(h, MANAGER, orderId, 1);

    // The compare-and-set matched nothing, so the loser is TOLD what the round
    // is now rather than handed an error that invites a retry.
    expect(refusal.status).toBe(HttpStatus.CONFLICT);
    expect(refusal.body.error).toBe('already_resolved');
    expect(String(refusal.body.message)).toMatch(/settled by someone else/i);
    expect(String(refusal.body.message)).toMatch(/confirmed/);

    // Machine evidence survived the testimony, and nothing else was written.
    delete (round as { state?: unknown }).state;
    round.state = NativeRoundState.confirmed;
    expect(round.resolvedByUserId ?? null).toBeNull();
    expect(round.resolvedAt ?? null).toBeNull();
    expect(roundAudit(h)).toHaveLength(0);
  });

  it('a round number that does not exist is a 404, and nothing is written', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();
    const refusal = await resolveExpectingRefusal(h, MANAGER, orderId, 9);
    expect(refusal.status).toBe(HttpStatus.NOT_FOUND);
    expect(h.ledger.rounds).toHaveLength(1);
    expect(roundAudit(h)).toHaveLength(0);
  });

  it.each([['0'], ['-1'], ['abc'], ['']])(
    'refuses %p as a round number rather than handing it to the driver',
    async (sequence) => {
      const { h, orderId } = await tableWithAnUnresolvedRound();
      const refusal = await resolveExpectingRefusal(h, MANAGER, orderId, sequence);
      expect(refusal.status).toBe(HttpStatus.BAD_REQUEST);
      expect(refusal.body.error).toBe('bad_sequence');
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════
describe('the append-only record of who did what', () => {
  it('writes an audit row for an attestation, naming the actor from the token', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Lamb and Coke both on table 5 in IdealPOS, checked against the bill.',
    });

    const events = roundAudit(h);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.action).toBe('NATIVE_ROUND_ATTESTED_PRESENT');
    expect(event.resource).toBe('native_table_round');
    expect(event.resourceId).toBe(roundId);
    expect(event.actorId).toBe('staff-manager');
    expect(event.actorRole).toBe(StaffRole.manager);
    expect(event.organizationId).toBe(VENUE.organizationId);
    expect(event.venueId).toBe(VENUE.id);

    const after = event.after as Record<string, unknown>;
    expect(after.outcome).toBe('present');
    expect(after.state).toBe(NativeRoundState.resolved_manually);
    expect(after.settled).toBe(true);
    // Recorded explicitly, so an incident review never has to INFER whether a
    // customer's food could have been sent twice off the back of this action.
    expect(after.linesReleased).toBe(false);
    expect(String(after.basis)).toMatch(/Lamb and Coke/);
  });

  it('writes one for the notFound check too - the outcome that changes no state', async () => {
    const { h, orderId } = await tableWithAnUnresolvedRound();

    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'notFound',
      basis: 'Checked table 5 in IdealPOS at 8:40pm, this round is not visible.',
    });

    const [event] = roundAudit(h);
    // Without this row, the only outcome that exists PURELY to be recorded
    // would leave no trace that anybody ever looked.
    expect(event.action).toBe('NATIVE_ROUND_CHECKED_NOT_FOUND');
    const after = event.after as Record<string, unknown>;
    expect(after.settled).toBe(false);
    expect(after.linesReleased).toBe(false);
  });

  it('records the elevated identity behind a step-up as well as the user', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const steppedUp = asRole(StaffRole.manager, { actingStaffId: 'staff-elevated-9' });

    await h.rounds.resolveRound(steppedUp, orderId, '1', {
      outcome: 'present',
      basis: 'Elevated session: I can see this round on table 5 in IdealPOS.',
    });

    const [event] = roundAudit(h);
    expect((event.after as Record<string, unknown>).actingStaffId).toBe('staff-elevated-9');
    expect(roundOf(h, roundId).resolvedByActingStaffId).toBe('staff-elevated-9');
  });

  it('still settles the round when the audit write itself fails', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    const audit = h.module.get<{ logAuthEvent: jest.Mock }>(AuditLogService);
    audit.logAuthEvent.mockRejectedValueOnce(new Error('audit table is unreachable'));

    const result = await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'The round is on table 5; the audit database being down is a separate problem.',
    });

    // A failure to record the act must not roll back a settlement a manager
    // has already been told about.
    expect(result.state).toBe(NativeRoundState.resolved_manually);
    expect(roundOf(h, roundId).state).toBe(NativeRoundState.resolved_manually);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('what NO manual outcome may ever do', () => {
  it.each([['present'], ['notFound']] as const)(
    '%s opens no socket and releases no line',
    async (outcome) => {
      const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
      const connectionsBefore = tillServer().connections;
      const requestsBefore = tillServer().requests.length;

      await h.rounds.resolveRound(MANAGER, orderId, '1', {
        outcome,
        basis: 'A statement long enough to satisfy the DTO, about what I saw on the till.',
      });

      // NOT ONE CONNECTION. This route is reached precisely when a round MAY
      // ALREADY BE ON THE TAB, which is the worst possible moment to give code
      // the ability to send.
      expect(tillServer().connections).toBe(connectionsBefore);
      expect(tillServer().requests).toHaveLength(requestsBefore);
      // NOT ONE LINE RELEASED, on either outcome.
      expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
      expect(h.ledger.items.filter((i) => i.nativeRoundId === roundId)).toHaveLength(2);
    },
  );

  it('offers no outcome that could release a line - `didNotLand` is gone', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();

    // The deleted outcome, sent as a real request. The DTO's `IsIn` is the
    // guard, but what this asserts is the CONSEQUENCE: whatever the route does
    // with an unknown outcome, it must not be to give the lines back.
    await expect(
      h.rounds.resolveRound(MANAGER, orderId, '1', {
        outcome: 'didNotLand' as never,
        basis: 'I cannot see this round, please release its lines so I can re-send them.',
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === roundId)).toHaveLength(2);
    expect(roundOf(h, roundId).state).toBe(NativeRoundState.unresolved);
  });

  it('survives a restart: the resolution is durable, not in-process state', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Attested before the API was restarted for a Windows update.',
    });

    // A brand new process over the same rows.
    const restarted = setHarness(await build(ENV(tillServer().port)));
    restarted.ledger.posSyncRecords = h.ledger.posSyncRecords;
    restarted.ledger.orders = h.ledger.orders;
    restarted.ledger.items = h.ledger.items;
    restarted.ledger.rounds = h.ledger.rounds;
    restarted.ledger.attempts = h.ledger.attempts;

    const {
      rounds: [round],
    } = await restarted.rounds.listRounds(MANAGER, orderId);
    expect(round.state).toBe(NativeRoundState.resolved_manually);
    expect(round.status).toBe('resolvedManually');
    expect(round.settled).toBe(true);
    expect(round.requiresReconciliation).toBe(false);

    // And it is still terminal after the restart.
    const again = await resolveExpectingRefusal(restarted, MANAGER, orderId, 1);
    expect(again.body.error).toBe('already_resolved');
    expect(roundOf(restarted, roundId).state).toBe(NativeRoundState.resolved_manually);
  });

  it('the recovery sweep leaves a manually resolved round alone', async () => {
    const { h, orderId, roundId } = await tableWithAnUnresolvedRound();
    await h.rounds.resolveRound(MANAGER, orderId, '1', {
      outcome: 'present',
      basis: 'Attested present; the restart sweep must treat this as terminal.',
    });

    // An hour later, well past every age gate.
    const swept = await h.recovery.sweep(new Date(Date.now() + 60 * 60_000));
    expect(swept.examined).toBe(0);
    expect(roundOf(h, roundId).state).toBe(NativeRoundState.resolved_manually);
    expect(h.ledger.items.filter((i) => i.nativeRoundId === null)).toHaveLength(0);
  });
});

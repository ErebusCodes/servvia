/**
 * THE BUTTON. `POST /api/admin/orders/:id/rounds` is what Send to Kitchen calls
 * on the Order Tablet for a native IdealPOS venue, and there is no other route
 * into the native path from the running application. `GET` on the same path is
 * the way back OUT: it reads where those rounds now stand and can send nothing.
 * `POST .../rounds/:sequence/resolve` is the way out of the ONE state the
 * machine cannot leave by itself, and it sends nothing either.
 *
 * THREE ROUTES, AND EXACTLY ONE OF THEM CAN REACH THE TILL. That is the
 * property to preserve when adding a fourth: the send route is the only place
 * in the running application where a byte can leave the host for IdealPOS, and
 * both of the others are reached precisely when a round MAY ALREADY BE ON THE
 * TAB - which is the worst possible place to put code that can send.
 *
 * IT IS NOT A DEVELOPER ENDPOINT. There is deliberately no second, unguarded
 * route for testing: a debug endpoint that can put a real docket on a real
 * table is a production endpoint that nobody has reviewed. This one carries the
 * same guards, the same venue scoping and the same roles as order creation.
 *
 * WHY IT LIVES IN PosSyncModule RATHER THAN OrdersModule. `NativeTableRoundService`
 * is a PosSyncModule provider, and PosSyncModule already imports OrdersModule.
 * Putting the route here uses the edge that exists; putting it on
 * OrdersController would need the reverse edge and a forwardRef, and a circular
 * module graph is a poor place to keep the only path to a real till.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RESPONSE CONTRACT, AND WHY IT IS SHAPED THIS WAY.
 *
 * The dangerous client behaviour on this path is not "showed the wrong label".
 * It is "read the response as failure and sent again". So the contract carries
 * two fields that exist purely to make that impossible to get wrong by
 * accident:
 *
 *     status         what actually happened, from the native state machine
 *     safeToRetry    whether pressing Send again can do any harm
 *
 * `safeToRetry` is FALSE for every outcome that is not provably nothing - not
 * merely for the ones that obviously failed. That is the whole asymmetry of
 * this integration: an order that did not arrive is a waiter walking to the
 * till, and an order that arrived twice is a wrong bill nobody notices.
 *
 * ACK IS NOT CONFIRMED. The best a send reaches here is
 * `sentAwaitingConfirmation`. The receiver emits its ACK before durable
 * processing, byte-identically to the ACK for a no-op, and even when its buffer
 * was full and the packet was dropped. `confirmed` is reachable only by
 * reconciliation against the till's own evidence, never from this request.
 *
 * AND UNCERTAIN IS NOT AN HTTP SUCCESS. `uncertain` answers 409, not 2xx.
 * A 2xx would be read as "done" by every generic client and every retry
 * wrapper in the stack, and 5xx would be read as "retry me" - which is the one
 * thing that must not happen to a round that may already be on the tab. 409 is
 * neither: no HTTP client retries it automatically, and no client mistakes it
 * for success. The body says the rest.
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PosSubmissionStrategy, ServiceMode, StaffRole } from '@prisma/client';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabletTokenActiveGuard } from '../auth/guards/tablet-token-active.guard';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RateLimit } from '../auth/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { AuditLogService } from '../audit/audit.service';
import {
  NativeRoundError,
  NativeTableRoundService,
  type ManualResolutionResult,
  type RoundStatusView,
  type SubmitRoundResult,
} from './waiterpad/native-table-round.service';
import { SubmitNativeRoundDto } from './dto/submit-native-round.dto';
import { ResolveNativeRoundDto } from './dto/resolve-native-round.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

const STAFF_ORDER_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
] as const;

/**
 * Who may settle an unresolved round by hand. DELIBERATELY NARROWER than
 * `STAFF_ORDER_ROLES`, which is what the send and read routes take.
 *
 * Resolving is not an order-taking act. It means walking to the till, reading a
 * customer's bill, and putting your name to what is there - and one of its two
 * outcomes releases lines onto that bill. The person best placed to do it
 * carelessly is the waiter who pressed Send: they are the one looking at the
 * red banner, they are the one it is blocking, and they are the one who can
 * make it go away by choosing either answer. The readback has told staff to
 * "ask a manager" since it was written; this is that sentence being true.
 *
 * The cost of being wrong in this direction is a blocked table, which is
 * visible, recoverable, and survivable for one service. The cost of being wrong
 * in the other is a double-charged bill nobody re-reads.
 */
const ROUND_RESOLUTION_ROLES = [StaffRole.admin, StaffRole.manager] as const;

/** What the tablet receives. Every field is something the UI genuinely renders. */
export interface NativeRoundResponse {
  readonly roundId: string;
  readonly sequence: number;
  readonly status: SubmitRoundResult['status'];
  readonly message: string;
  /**
   * Whether pressing Send again is harmless. False for everything that is not
   * provably nothing - see the file header.
   */
  readonly safeToRetry: boolean;
  /** True when only a human looking at the till can settle this round. */
  readonly requiresReconciliation: boolean;
  /** True when this request sent nothing because an identical one already had. */
  readonly replayed: boolean;
}

/**
 * Outcome -> what staff may do next.
 *
 * A table rather than a chain of ifs, because every row is a decision somebody
 * has to be able to check against the receiver behaviour without reading
 * control flow.
 */
const OUTCOMES: Record<
  SubmitRoundResult['status'],
  { httpStatus: HttpStatus; safeToRetry: boolean; requiresReconciliation: boolean }
> = {
  // Sent, and the till acknowledged. Not proof it landed - only reconciliation
  // can say that - but the round now holds the table's in-flight slot, so a
  // second press has nothing to do anyway.
  sentAwaitingConfirmation: {
    httpStatus: HttpStatus.ACCEPTED,
    safeToRetry: false,
    requiresReconciliation: false,
  },
  // The bytes left the host and we do not know what became of them. The one
  // outcome where both "it worked" and "it failed" are wrong answers.
  uncertain: {
    httpStatus: HttpStatus.CONFLICT,
    safeToRetry: false,
    requiresReconciliation: true,
  },
  // NAKREGO. The identity was refused, and its durable state is unresolved like
  // every other unproven outcome - the receiver may still have buffered the
  // packet. Not retryable, and not fixable at the table: it is a licence.
  registrationRejected: {
    httpStatus: HttpStatus.CONFLICT,
    safeToRetry: false,
    requiresReconciliation: true,
  },
  // Positive evidence of non-acceptance - today only LOCK, whose check runs
  // before the receiver buffers anything. Nothing was created, so trying again
  // once the table is unlocked is correct.
  rejected: {
    httpStatus: HttpStatus.CONFLICT,
    safeToRetry: true,
    requiresReconciliation: false,
  },
  // Provably nothing left this device. The only outcome that is genuinely safe
  // to repeat, and the only one this endpoint invites staff to repeat.
  failedBeforeSend: {
    httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    safeToRetry: true,
    requiresReconciliation: false,
  },
};

/** NativeRoundError reason -> HTTP status. Refusals, none of which sent anything. */
const REFUSALS: Record<string, HttpStatus> = {
  order_not_found: HttpStatus.NOT_FOUND,
  not_dine_in: HttpStatus.BAD_REQUEST,
  unmapped_table: HttpStatus.UNPROCESSABLE_ENTITY,
  unmapped_item: HttpStatus.UNPROCESSABLE_ENTITY,
  nothing_to_send: HttpStatus.BAD_REQUEST,
  round_in_flight: HttpStatus.CONFLICT,
  not_native_owned: HttpStatus.CONFLICT,
};

/**
 * ─────────────────────────────────────────────────────────────────────────
 * RATE LIMITS, AND WHY THE READ ROUTE'S IS TWENTY TIMES THE SEND'S.
 *
 * `RateLimitGuard` buckets per CLIENT IP PER ROUTE, so in a restaurant every
 * tablet behind the same NAT shares one bucket. That is what sets the floor
 * here: a limit picked for one device throttles the sixth one on a Friday
 * night, and a tablet that cannot poll is a tablet that goes on showing
 * "waiting for the till" about a round the server escalated ten minutes ago.
 *
 * IT FAILS CLOSED. A Redis outage makes the guard answer 503 rather than let
 * the request through, which is the right default for a route that can put a
 * docket on a real table: a send that never happened is a waiter walking to
 * the till, and there is no ambiguity to resolve because the guard runs BEFORE
 * the handler - no round is opened and no byte leaves the host. The tablet
 * reads a body with no `roundId` as "not sent", and - because `safeToRetry`
 * is absent and it defaults to false - does not invite a re-press.
 */

/**
 * THE SEND. One press per round, and a round is minutes of a table's service,
 * so the honest rate is around one a minute across a whole venue. Sixty leaves
 * an order of magnitude for a dinner rush in which every table sends at once,
 * and still stops a client stuck in a loop from pressing Send four hundred
 * times - which is the only thing a limit on this route can usefully do, since
 * the `requestKey` unique constraint already makes a double-tap harmless.
 */
const SEND_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/**
 * THE POLL, AND IT MUST NOT BE THE THING THAT BREAKS THE STATUS LOOP.
 *
 * The tablet polls every 3 seconds while an order is open - 20 requests a
 * minute per device - and the poll is how a round that escalated to
 * `unresolved` ever reaches a waiter's screen at all. Throttling it does not
 * degrade a nicety; it reinstates the exact bug the readback was built to fix,
 * silently, under load. 600 a minute carries thirty devices on one IP with
 * room to spare and still bounds a runaway client.
 */
const READ_RATE_LIMIT = { limit: 600, windowSeconds: 60 } as const;

/**
 * SETTLING BY HAND. A manager walks to a till, reads a bill, and types what
 * they saw; twenty a minute from one address is already far beyond anything a
 * person does. Lower than the send deliberately - this route is rarer, is
 * restricted to two roles, and writes a terminal state on a customer's bill.
 */
const RESOLVE_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;

@Controller()
export class NativeRoundsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly native: NativeTableRoundService,
    private readonly audit: AuditLogService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, RateLimitGuard)
  @Roles(...STAFF_ORDER_ROLES)
  @RateLimit(SEND_RATE_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('admin/orders/:id/rounds')
  async submitRound(
    @Req() req: AuthedRequest,
    @Param('id') orderId: string,
    @Body() dto: SubmitNativeRoundDto,
  ): Promise<NativeRoundResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        venueId: true,
        serviceMode: true,
        venue: { select: { organizationId: true } },
        posSyncRecord: { select: { strategy: true } },
      },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    // Same venue scoping as every other staff order route. Done before
    // anything is resolved or written, so a caller outside this venue cannot
    // even learn what the order contains.
    this.assertInScope(req, order);

    // ── ROUTE EXCLUSIVITY, CHECKED AT THE EDGE AS WELL AS IN THE SERVICE. ──
    //
    // `NativeTableRoundService.openRound` enforces this too, and that is the
    // check that actually guarantees it. This one exists so the refusal reaches
    // staff as a clean 409 with an explanation, before any line is priced or
    // written, rather than as a service exception thrown halfway through.
    const owner = order.posSyncRecord?.strategy ?? null;
    if (owner !== null && owner !== PosSubmissionStrategy.native_table_round) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message:
            `This order is being delivered to IdealPOS by the '${owner}' pipeline, not the ` +
            'native handheld workflow. It was not sent again - doing so would put a second ' +
            "copy of it on the customer's bill.",
          error: 'not_native_owned',
          safeToRetry: false,
        },
        HttpStatus.CONFLICT,
      );
    }

    if (order.serviceMode !== ServiceMode.dine_in) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            'The native handheld protocol addresses a table, and a takeaway order has none. ' +
            'No table may be fabricated to give it one.',
          error: 'not_dine_in',
          safeToRetry: false,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Priced by the SAME code that priced round one - see
    // OrdersService.resolveRoundLines for why a second implementation is not
    // acceptable here. Resolved before the round opens so that an unknown or
    // unavailable item is refused without touching the order at all.
    const resolved =
      dto.items.length > 0
        ? await this.orders.resolveRoundLines(order.venueId, req.user.organizationId, dto.items)
        : [];

    let result: SubmitRoundResult;
    try {
      result = await this.native.submitRound({
        orderId,
        requestKey: dto.requestKey,
        newLines: resolved.map((line) => ({
          menuItemId: line.menuItemId,
          menuItemTitle: line.menuItemTitle,
          menuItemCategory: line.menuItemCategory,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          lineTotalCents: line.lineTotalCents,
          selectedModifiers: line.selectedModifiers,
          notes: line.notes,
          seat: line.seat,
        })),
      });
    } catch (err) {
      if (err instanceof NativeRoundError) throw this.refusal(err);
      throw err;
    }

    const outcome = OUTCOMES[result.status];
    const body: NativeRoundResponse = {
      roundId: result.roundId,
      sequence: result.sequence,
      status: result.status,
      message: result.message,
      // A REPLAYED REQUEST NEVER INVITES A RETRY, whatever the outcome table
      // says about that status in general. `replayed` means this request sent
      // nothing because an identical one already had - so the outcome being
      // reported belongs to that other request, and this one is in no position
      // to judge whether repeating it is safe. The other request may still be
      // mid-send as this line runs.
      safeToRetry: result.replayed ? false : outcome.safeToRetry,
      requiresReconciliation: outcome.requiresReconciliation,
      replayed: result.replayed,
    };

    if (outcome.httpStatus !== HttpStatus.ACCEPTED) {
      // Carried as an exception so the status code is the one this outcome
      // deserves. The body is the same object either way, so a client can read
      // one shape regardless of which branch it came from.
      throw new HttpException({ ...body }, outcome.httpStatus);
    }
    return body;
  }

  /**
   * WHERE THIS ORDER'S ROUNDS STAND. A read, and only a read.
   *
   * THE HOLE THIS CLOSES. `POST /rounds` answers once, about the instant it ran,
   * and the best it may ever say is `sentAwaitingConfirmation` - the receiver
   * ACKs before durable processing, so no send can report more. Everything that
   * happens after belongs to reconciliation: a round is confirmed against the
   * till's own token row, or, when nothing ever confirms it, ESCALATED to
   * `unresolved` so that a human looks at the till.
   *
   * Until this route existed that escalation reached nobody. It changed a row
   * the tablet never read, so the screen went on showing the POST's answer -
   * "SENT, AWAITING TILL CONFIRMATION" - for the rest of the service, about a
   * round the server had already stopped believing in. A stale reassuring
   * message is worse than an alarming true one, and this is the route that
   * lets the true one arrive.
   *
   * STAFF ROLES ONLY, unlike `GET /orders/:id/pos-sync` next door, which DL-087
   * widened to `viewer` so a guest could watch their own order. A native round
   * is opened by a waiter pressing Send to Kitchen and by nothing else; no guest
   * device has one to watch, and till state is not theirs to read.
   *
   * IT CANNOT SEND ANYTHING. `readRounds` returns rows. There is no branch here
   * that could react to finding a round in a worrying state by resending it -
   * which matters more on a route staff can refresh at will than anywhere else
   * in this module.
   */
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, RateLimitGuard)
  @Roles(...STAFF_ORDER_ROLES)
  @RateLimit(READ_RATE_LIMIT)
  @Get('admin/orders/:id/rounds')
  async listRounds(
    @Req() req: AuthedRequest,
    @Param('id') orderId: string,
  ): Promise<{ rounds: RoundStatusView[] }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, venueId: true, venue: { select: { organizationId: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    this.assertInScope(req, order);

    // Wrapped in an object rather than returned as a bare array so that a field
    // can be added later - a sweep timestamp, a venue-level reconciliation
    // notice - without every existing client's parse breaking.
    return { rounds: await this.native.readRounds(orderId) };
  }

  /**
   * SETTLE AN UNRESOLVED ROUND ON A HUMAN'S WORD. The way OUT of the dead end.
   *
   * THE DEAD END. `unresolved` occupies the table's single in-flight slot, so
   * while one stands no further round may be opened on that table. Both of its
   * machine exits are written by the reconciler and both need evidence read
   * from the till - and no connector build binds an evidence reader yet. So in
   * the configuration this integration ships in, the reconciler's verdict is
   * permanently `manualResolutionRequired`, every round escalates once its
   * window runs out, and the table is finished for the rest of the service.
   * The readback added the banner that says so; this is the button under it.
   *
   * IT SENDS NOTHING. No writer, no transport, no branch that could react to
   * what it finds by resending it. This route exists exactly where a round MAY
   * ALREADY BE ON THE TAB, which is the worst possible place to put code that
   * can send. Lines that need to reach the kitchen after all go on the NEXT
   * round, pressed by a waiter, with the table unblocked and the screen showing
   * what happened.
   *
   * 409 FOR EVERY REFUSAL, never 4xx-that-looks-retryable and never 5xx. The
   * two refusals it can produce - the round is not resolvable, or somebody else
   * resolved it first - are both "your request did nothing and repeating it
   * unchanged will also do nothing". A 5xx would invite a retry wrapper to
   * hammer a route that settles bills.
   *
   * MANAGER AND ADMIN ONLY - see `ROUND_RESOLUTION_ROLES`.
   */
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard, RateLimitGuard)
  @Roles(...ROUND_RESOLUTION_ROLES)
  @RateLimit(RESOLVE_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  @Post('admin/orders/:id/rounds/:sequence/resolve')
  async resolveRound(
    @Req() req: AuthedRequest,
    @Param('id') orderId: string,
    @Param('sequence') sequence: string,
    @Body() dto: ResolveNativeRoundDto,
  ): Promise<ManualResolutionResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, venueId: true, venue: { select: { organizationId: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    this.assertInScope(req, order);

    // Parsed rather than coerced. `Number('3abc')` is NaN and `Number('')` is
    // 0, and a sequence of 0 exists on no order - but a NaN reaching Prisma is
    // an error from the driver rather than a sentence for staff.
    const seq = Number.parseInt(sequence, 10);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: `'${sequence}' is not a round number.`,
          error: 'bad_sequence',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.native.resolveRound({
        orderId,
        sequence: seq,
        outcome: dto.outcome,
        basis: dto.basis,
        // FROM THE TOKEN, never from the body. A client-supplied author is not
        // an author, and the whole value of this record is that it names
        // somebody who can be asked.
        resolvedByUserId: req.user.id,
        // Both identities where a step-up produced this session, which is what
        // `actingStaffId` exists for.
        resolvedByActingStaffId: req.user.actingStaffId ?? null,
      });

      // ── THE AUDIT ROW, and it is written for BOTH outcomes. ──
      //
      // The four columns on the round carry the attestation; this carries the
      // ACT. They are not the same record and neither replaces the other: the
      // columns say what a round's final state rests on, and are overwritten by
      // nothing because the state is terminal, while the audit log is the
      // append-only account of who did what - including the `notFound` checks
      // that changed no state at all and would otherwise leave no trace that
      // anybody ever looked.
      //
      // Written AFTER the resolution, deliberately. A failure to record the act
      // must not roll back a settlement a manager has already been told about,
      // and an audit row for a resolution that did not happen is worse than a
      // missing one for a resolution that did.
      await this.audit
        .logAuthEvent({
          organizationId: req.user.organizationId,
          venueId: order.venueId,
          actorId: req.user.id,
          actorEmail: req.user.email,
          actorRole: req.user.role,
          action:
            result.outcome === 'present'
              ? 'NATIVE_ROUND_ATTESTED_PRESENT'
              : 'NATIVE_ROUND_CHECKED_NOT_FOUND',
          resource: 'native_table_round',
          resourceId: result.roundId,
          after: {
            orderId,
            sequence: seq,
            outcome: result.outcome,
            state: result.state,
            settled: result.settled,
            // Recorded explicitly rather than implied, so an incident review
            // never has to infer whether a customer's food could have been
            // sent twice off the back of this action.
            linesReleased: result.linesReleased,
            basis: dto.basis,
            actingStaffId: req.user.actingStaffId ?? null,
          },
        })
        .catch(() => {
          /* see above: never fail a settled resolution over its own audit row */
        });

      return result;
    } catch (err) {
      if (err instanceof NativeRoundError) {
        const status =
          err.reason === 'order_not_found' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
        throw new HttpException(
          {
            statusCode: status,
            message: err.message,
            error: err.reason,
            // Nothing was sent by this route under any outcome, so the field
            // that means "may a waiter press Send" is about the ROUND, and a
            // round this route refused to settle is a round nobody may send.
            safeToRetry: false,
          },
          status,
        );
      }
      throw err;
    }
  }

  /**
   * The venue/organization scoping every route on this controller applies.
   *
   * ONE IMPLEMENTATION ON PURPOSE. The read route and the send route must agree
   * exactly about who may see an order: a scoping check that drifts is how a
   * route that "only reads" becomes the one that leaks a neighbouring venue's
   * table state.
   */
  private assertInScope(
    req: AuthedRequest,
    order: { venueId: string; venue: { organizationId: string } },
  ): void {
    resolveVenueScope(req.user, order.venueId);
    if (order.venue.organizationId !== req.user.organizationId) {
      throw new ForbiddenException('Venue does not belong to your organization');
    }
  }

  /**
   * A refusal: the service declined before any byte could leave the host.
   *
   * Every one of these carries `safeToRetry: true` because nothing was sent -
   * except `round_in_flight`, where the PREVIOUS round is the thing that may be
   * in the kitchen and pressing again must not become a habit.
   */
  private refusal(err: NativeRoundError): HttpException {
    const status = REFUSALS[err.reason] ?? HttpStatus.UNPROCESSABLE_ENTITY;
    return new HttpException(
      {
        statusCode: status,
        message: err.message,
        error: err.reason,
        safeToRetry: err.reason !== 'round_in_flight' && err.reason !== 'not_native_owned',
        requiresReconciliation: err.reason === 'round_in_flight',
      },
      status,
    );
  }
}

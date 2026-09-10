/**
 * THE BUTTON. `POST /api/admin/orders/:id/rounds` is what Send to Kitchen calls
 * on the Order Tablet for a native IdealPOS venue, and there is no other route
 * into the native path from the running application. `GET` on the same path is
 * the way back OUT: it reads where those rounds now stand and can send nothing.
 * One writing route and one reading one, and only the first can reach the till.
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
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { resolveVenueScope } from '../auth/utils/resolve-venue-scope';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import {
  NativeRoundError,
  NativeTableRoundService,
  type RoundStatusView,
  type SubmitRoundResult,
} from './waiterpad/native-table-round.service';
import { SubmitNativeRoundDto } from './dto/submit-native-round.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

const STAFF_ORDER_ROLES = [
  StaffRole.admin,
  StaffRole.manager,
  StaffRole.cashier,
  StaffRole.kitchen,
] as const;

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

@Controller()
export class NativeRoundsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly native: NativeTableRoundService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard)
  @Roles(...STAFF_ORDER_ROLES)
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
  @UseGuards(JwtAuthGuard, RolesGuard, TabletTokenActiveGuard)
  @Roles(...STAFF_ORDER_ROLES)
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

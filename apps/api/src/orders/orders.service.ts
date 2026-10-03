import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { isProductionRuntime } from '../config/runtime-environment';
import * as argon2 from 'argon2';
import Stripe from 'stripe';
import {
  KdsDeliveryStatus,
  Order,
  OrderItem,
  OrderStatus,
  OrderSource,
  PrintJobStatus,
  Prisma,
  ServiceMode,
  Staff,
  StaffRole,
  Venue,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto, CreateOrderItemDto, OrderItemModifierDto } from './dto/create-order.dto';
import { CreateStaffOrderDto } from './dto/create-staff-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersGateway } from './orders.gateway';
import { AuditLogService } from '../audit/audit.service';
import { AuditActor } from '../audit/audit-actor';
import {
  LEGACY_EXTERNAL_POS_ORDER_INCLUDE,
  LegacyExternalPosHandoff,
} from '../legacy-external-pos/legacy-external-pos-handoff';
import { assertTableHasNoOpenSession } from './table-session-occupancy';

/**
 * Snapshot shape matches `docs/domain-model.md`'s `SelectedModifier` — for
 * the strict (staff/tablet) path every field is populated from real
 * `MenuItem.modifierGroups` data; for the legacy (kiosk) path
 * `modifierGroupId`/`optionId`/`modifierGroupName` are null (there is
 * nothing authoritative to resolve them from — see
 * `OrdersService.resolveModifiers`'s non-strict branch), matching exactly
 * what was already persisted before Story 15-3.
 */
interface ResolvedSelectedModifier {
  modifierGroupId: string | null;
  modifierGroupName: string | null;
  optionId: string | null;
  optionName: string;
  priceDeltaCents: number;
}

export interface ResolvedOrderItem {
  menuItemId: string;
  menuItemTitle: string;
  menuItemCategory: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  selectedModifiers: ResolvedSelectedModifier[];
  notes: string | null;
  seat: number | null;
}

interface ResolvedTable {
  tableId: string | null;
  tableNumber: string | null;
}

@Injectable()
export class OrdersService {
  // Must match the index names created by
  // prisma/migrations/20260815120000_order_idempotency_and_payment_linkage.
  private static readonly IDEMPOTENCY_CONSTRAINT_NAME = 'Order_venueId_idempotencyKey_key';
  private static readonly PAYMENT_REF_CONSTRAINT_NAME = 'Order_paymentProviderTransactionId_key';

  private readonly logger = new Logger(OrdersService.name);

  /**
   * A seat is a positive integer or "no seat" (null). Any non-integer or
   * non-positive value normalizes to null — never stored as seat 0. This is
   * the same rule buildIdealposOrderPayload applies, kept in lock-step so the
   * seat that survives persistence is exactly the seat that reaches the
   * native round.
   */
  private static normalizeSeat(seat: number | null | undefined): number | null {
    return Number.isInteger(seat) && (seat as number) > 0 ? (seat as number) : null;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersGateway: OrdersGateway,
    private readonly auditLogService: AuditLogService,
    // TEMPORARY: the only door from canonical order creation to IdealPOS.
    // Everything external-POS lives behind it; see legacy-external-pos/README.md.
    private readonly legacyExternalPos: LegacyExternalPosHandoff,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const venue = await this.resolveVenue(dto.venueId);

    // Idempotency lookup happens before any other validation. This matters:
    // a legitimate retry of an already-created order must not be rejected by
    // validateTableForOrder's "table already has an active order" guard,
    // which would otherwise trip on the retry's own prior order. See story
    // 6-1 Dev Notes for the full reasoning.
    const existingOrder = await this.findExistingByIdempotencyKey(dto.venueId, dto.idempotencyKey);

    if (!existingOrder) {
      // Only run the active-table guard for genuinely new orders.
      await this.validateTableForOrder(dto.venueId, dto.tableId, dto.tableNumber);
    }

    const { resolvedItems, subtotalCents } = await this.resolveOrderItems(dto.items, venue, false);

    const systemActor = await this.resolveKioskSystemActor(venue.organizationId);

    if (existingOrder) {
      return this.resolveIdempotentOutcome({
        existingOrder,
        expectedSource: OrderSource.kiosk,
        dto,
        resolvedItems,
        organizationId: venue.organizationId,
        venueId: dto.venueId,
        actorId: systemActor.id,
        actorEmail: systemActor.email,
        actorRole: StaffRole.viewer,
      });
    }

    // Only for genuinely new (non-replay) submissions — see
    // checkExpectedPrices's own doc comment for why a replay must never
    // reach this check.
    this.checkExpectedPrices(dto.items, resolvedItems);

    if (!dto.stripePaymentIntentId) {
      throw new BadRequestException('stripePaymentIntentId is required for payment verification');
    }

    // Defense-in-depth pre-check before hitting Stripe at all — the unique
    // index on paymentProviderTransactionId is the actual enforcement
    // mechanism (see the P2002 handling below), but rejecting an obviously
    // reused reference before an external call is cheaper and avoids
    // leaking PaymentIntent validity timing to a probing client.
    await this.rejectIfPaymentReferenceReused(
      dto.stripePaymentIntentId,
      dto.idempotencyKey,
      venue.organizationId,
      dto.venueId,
      systemActor,
    );

    // Re-resolve the table now that we know this is a new order — done
    // again here (not reused from the guard above) because that call only
    // validates; it does not return the resolved ids on this branch when an
    // existing order was found, and keeping both paths independent avoids a
    // stale-variable bug if the guard's signature changes later.
    const { tableId, tableNumber } = await this.validateTableForOrder(
      dto.venueId,
      dto.tableId,
      dto.tableNumber,
    );

    // Computed only now that this is confirmed to be a genuinely new order
    // (not a replay) — a venue tax-profile misconfiguration must fail closed
    // for a new submission, but must never block a legitimate idempotent
    // replay of an already-accepted order (DL-072 / 2026-08-20 GST fix).
    const { taxCents, totalCents } = this.computeTotals(venue, subtotalCents);

    await this.verifyKioskPayment(dto.stripePaymentIntentId, totalCents);

    const persistParams = {
      venue,
      tableId,
      tableNumber,
      // Story 15-13: the public kiosk path (Window Display) is out of
      // Order Tablet scope and has no takeaway concept of its own — every
      // kiosk order is persisted as dine_in, explicitly, matching this
      // migration's backfill policy for every pre-existing row.
      serviceMode: ServiceMode.dine_in,
      // The kiosk never asks for a cover count, so there is genuinely none to
      // record. Null rather than a stand-in number.
      guests: null,
      resolvedItems,
      subtotalCents,
      taxCents,
      totalCents,
      notes: dto.notes,
      source: OrderSource.kiosk,
      // Kiosk orders are prepaid at the terminal, so they start confirmed.
      initialStatus: OrderStatus.confirmed,
      confirmedAt: new Date(),
      idempotencyKey: dto.idempotencyKey,
      paymentProviderTransactionId: dto.stripePaymentIntentId,
    };

    let order: Order;
    try {
      order = await this.persistOrder(persistParams);
    } catch (e) {
      return this.recoverFromPersistConflict(e, {
        venueId: dto.venueId,
        expectedSource: OrderSource.kiosk,
        dto,
        resolvedItems,
        organizationId: venue.organizationId,
        actorId: systemActor.id,
        actorEmail: systemActor.email,
        actorRole: StaffRole.viewer,
        paymentProviderTransactionId: dto.stripePaymentIntentId,
        retryPersist: () => this.persistOrder(persistParams),
      });
    }

    await this.auditLogService.logAuthEvent({
      organizationId: venue.organizationId,
      venueId: dto.venueId,
      actorId: systemActor.id,
      actorEmail: systemActor.email,
      actorRole: StaffRole.viewer,
      action: 'CREATE_ORDER',
      resource: 'order',
      resourceId: order.id,
      after: {
        orderId: order.id,
        totalCents,
        source: 'kiosk',
        stripePaymentIntentId: dto.stripePaymentIntentId,
      },
    });

    await this.broadcastOrder(order.id, dto.venueId);
    return order;
  }

  /**
   * Order creation for staff-operated surfaces (Order Tablet). Never
   * prepaid at submission — payment happens later via native
   * IdealPOS/EFTPOS, not simulated here.
   *
   * Story 15-13: `dto.serviceMode` is the single authoritative dine-in/
   * takeaway signal. `dine_in` requires and resolves a real, venue-owned
   * `Table` exactly as before this story; `takeaway` requires the ABSENCE
   * of a table — a takeaway request carrying a `tableId` is rejected
   * outright (never silently discarded), and no table is ever fabricated
   * for one. Table 19's controlled-validation guard is checked for both
   * modes (with a null `tableNumber` for takeaway, which the guard's own
   * `resolvedTableNumber !== '19'` check already fails closed on) so an
   * active live-validation lockdown correctly blocks takeaway submissions
   * too, without any change to the guard itself.
   */
  async createStaffOrder(
    dto: CreateStaffOrderDto,
    organizationId: string,
    actor: { id: string; email: string; role: StaffRole },
  ): Promise<Order> {
    const venue = await this.resolveVenue(dto.venueId);
    if (venue.organizationId !== organizationId) {
      throw new ForbiddenException('Venue does not belong to your organization');
    }

    const existingOrder = await this.findExistingByIdempotencyKey(dto.venueId, dto.idempotencyKey);

    let tableId: string | null = null;
    let tableNumber: string | null = null;
    if (!existingOrder) {
      if (dto.serviceMode === ServiceMode.dine_in) {
        const resolved = await this.validateTableForOrder(dto.venueId, dto.tableId, undefined);
        if (!resolved.tableId) {
          throw new BadRequestException('A valid tableId is required for a dine-in order');
        }
        tableId = resolved.tableId;
        tableNumber = resolved.tableNumber;
      } else if (dto.serviceMode === ServiceMode.takeaway) {
        if (dto.tableId) {
          throw new BadRequestException('A takeaway order must not specify a table');
        }
      } else {
        // IsEnum on the DTO already rejects this at the HTTP boundary —
        // this branch exists only so a future ServiceMode value added to
        // the enum without updating this method fails closed here too,
        // rather than silently falling through with tableId/tableNumber
        // left null and no explicit rejection.
        throw new BadRequestException(`Unsupported service mode: ${String(dto.serviceMode)}`);
      }
      // Checked against the server-resolved table only, never the raw
      // client-supplied tableId/tableNumber — see the method's own doc
      // comment for why. Only for genuinely new submissions, same as
      // checkExpectedPrices/computeTotals below: a replay must never be
      // re-litigated against a guard that didn't exist (or a run that
      // wasn't reset) when the original order was accepted.
      await this.assertTable19ValidationModeAllows(venue, tableNumber);
    }

    const { resolvedItems, subtotalCents } = await this.resolveOrderItems(dto.items, venue, true);

    if (existingOrder) {
      return this.resolveIdempotentOutcome({
        existingOrder,
        expectedSource: OrderSource.staff,
        dto,
        resolvedItems,
        organizationId,
        venueId: dto.venueId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
      });
    }

    // Only for genuinely new (non-replay) submissions — a retry of an
    // already-accepted request must return the original result untouched,
    // never re-litigate whether the price it saw is still current.
    this.checkExpectedPrices(dto.items, resolvedItems);

    // Computed only now that this is confirmed to be a genuinely new order
    // (not a replay) — a venue tax-profile misconfiguration must fail closed
    // for a new submission, but must never block a legitimate idempotent
    // replay of an already-accepted order (DL-072 / 2026-08-20 GST fix).
    const { taxCents, totalCents } = this.computeTotals(venue, subtotalCents);

    // Already proven allowed above (assertTable19ValidationModeAllows) when
    // active — this just decides whether to unmistakably tag the order and
    // record the one-run-only tracking row, never re-evaluates the gate.
    const table19ValidationModeActive = this.isTable19ValidationModeActiveForVenue(venue);

    const persistParams = {
      venue,
      tableId,
      tableNumber,
      serviceMode: dto.serviceMode,
      // Covers as the waiter set them on the Order Tablet. Takeaway sends
      // none, and an older client that omits it stays null - never defaulted.
      guests: dto.guests ?? null,
      resolvedItems,
      subtotalCents,
      taxCents,
      totalCents,
      notes: table19ValidationModeActive
        ? `TABLE19-VALIDATION-${dto.notes ?? ''}`.trimEnd()
        : dto.notes,
      source: OrderSource.staff,
      // Matches the kiosk path so downstream KDS "start preparing" actions
      // (confirmed -> preparing) work identically regardless of source.
      initialStatus: OrderStatus.confirmed,
      confirmedAt: new Date(),
      idempotencyKey: dto.idempotencyKey,
      paymentProviderTransactionId: null,
      createTable19ValidationRun: table19ValidationModeActive,
    };

    let order: Order;
    try {
      order = await this.persistOrder(persistParams);
    } catch (e) {
      return this.recoverFromPersistConflict(e, {
        venueId: dto.venueId,
        expectedSource: OrderSource.staff,
        dto,
        resolvedItems,
        organizationId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        retryPersist: () => this.persistOrder(persistParams),
        paymentProviderTransactionId: null,
      });
    }

    await this.auditLogService.logAuthEvent({
      organizationId,
      venueId: dto.venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'CREATE_ORDER',
      resource: 'order',
      resourceId: order.id,
      after: {
        orderId: order.id,
        totalCents,
        source: 'staff',
        serviceMode: dto.serviceMode,
        tableId,
        takeawayReference: order.takeawayReference,
      },
    });

    await this.broadcastOrder(order.id, dto.venueId);
    return order;
  }

  // ── Idempotency and payment-reference-uniqueness helpers (Story 6-1) ──

  private async findExistingByIdempotencyKey(
    venueId: string,
    idempotencyKey: string,
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    return this.prisma.order.findUnique({
      where: { venueId_idempotencyKey: { venueId, idempotencyKey } },
      include: { items: true },
    });
  }

  /**
   * Canonical, order-independent fingerprint of a set of priced order
   * lines. Used to decide whether a replayed request is the "same"
   * commercial order as the one already persisted under this idempotency
   * key — comparison is against the server-computed snapshot (unit price,
   * quantity, resolved modifiers), never a client-supplied total.
   */
  /**
   * Canonical, order-independent fingerprint of a set of order lines' shape
   * — which item, how many, and which exact modifier selections (by id
   * when the strict path resolved them, else by name for the legacy kiosk
   * path). Deliberately excludes price entirely (unlike before this
   * story): idempotency-key semantics mean "this exact logical request,
   * already fulfilled" — a legitimate replay must return the original
   * accepted result even if a menu/modifier price changed in between (see
   * Story 15-3's stale-data requirements), not be treated as "a different
   * order" just because a fresh resolution would price it differently.
   * Genuinely different carts (different item/qty/modifier selection)
   * still fail to match, so key reuse for an unrelated request is still
   * correctly rejected.
   */
  private itemsFingerprint(
    items: Array<{
      menuItemId: string;
      quantity: number;
      selectedModifiers: unknown;
    }>,
  ): string {
    return items
      .map((item) => {
        const mods = Array.isArray(item.selectedModifiers)
          ? [
              ...(item.selectedModifiers as Array<{
                optionId?: string | null;
                optionName?: string;
              }>),
            ]
              .map((m) => m.optionId ?? `name:${(m.optionName ?? '').trim().toLowerCase()}`)
              .sort()
              .join(',')
          : '';
        return `${item.menuItemId}:${item.quantity}:[${mods}]`;
      })
      .sort()
      .join('|');
  }

  private ordersMatchForReplay(
    existingOrder: Order & { items: OrderItem[] },
    candidate: {
      expectedSource: OrderSource;
      tableId?: string;
      tableNumber?: string;
      /**
       * Story 15-13. Optional because the kiosk path (`create()`) has no
       * service-mode concept at all — `undefined` means "not part of this
       * caller's contract," so no check is performed, exactly mirroring
       * `tableReferenceMatches`'s existing undefined-means-uncompared
       * convention. The staff/tablet path always supplies it (required on
       * both DTOs), so a replay reusing the same idempotencyKey with a
       * different serviceMode is always caught here.
       */
      serviceMode?: ServiceMode;
      resolvedItems: ResolvedOrderItem[];
    },
  ): boolean {
    // Without this check, a kiosk request and a staff request that happen to
    // reuse the same idempotencyKey with a coincidentally-matching
    // table/items would cross-match — a staff-order call could silently
    // return a kiosk order's row (or vice versa). Source is part of the
    // commercial identity of the request, not an incidental field.
    if (existingOrder.source !== candidate.expectedSource) return false;

    if (
      candidate.serviceMode !== undefined &&
      candidate.serviceMode !== existingOrder.serviceMode
    ) {
      return false;
    }

    const tableMatches = this.tableReferenceMatches(
      candidate.tableId,
      candidate.tableNumber,
      existingOrder.tableId,
      existingOrder.tableNumber,
    );

    // Deliberately price-independent (Story 15-3) — see itemsFingerprint's
    // own doc comment. Matching by cart shape alone is what makes "replay
    // after menu changes" return the original accepted result instead of a
    // false "different order" conflict.
    const itemsMatch =
      this.itemsFingerprint(candidate.resolvedItems) === this.itemsFingerprint(existingOrder.items);

    return tableMatches && itemsMatch;
  }

  /**
   * Best-effort audit write. The business outcome (which order is returned,
   * or which exception is thrown) is always decided before this is called
   * and must never depend on the audit write succeeding — an idempotent
   * replay is, by definition, a safe no-op against already-committed state,
   * and a transient audit-log failure must not turn that safe path into a
   * 500. Logged to stderr so a failure is still observable operationally.
   */
  private async logAuditEventSafely(
    event: Parameters<AuditLogService['logAuthEvent']>[0],
  ): Promise<void> {
    try {
      await this.auditLogService.logAuthEvent(event);
    } catch (auditError) {
      console.error(
        '[OrdersService] audit log write failed (non-fatal):',
        event.action,
        auditError,
      );
    }
  }

  /**
   * Compares a candidate request's table reference against a persisted
   * order's resolved tableId/tableNumber. Only fields the candidate DTO
   * actually carries are compared — CreateStaffOrderDto never has a
   * tableNumber field at all (staff orders are always identified by
   * tableId), so unconditionally comparing tableNumber would falsely flag
   * every legitimate staff-order replay as "materially different" once the
   * table was resolved and persisted. If the candidate supplies neither
   * field (a kiosk order with no table selected), the original must also
   * have neither for the replay to match.
   */
  private tableReferenceMatches(
    candidateTableId: string | undefined,
    candidateTableNumber: string | undefined,
    existingTableId: string | null,
    existingTableNumber: string | null,
  ): boolean {
    if (candidateTableId !== undefined && candidateTableId !== existingTableId) return false;
    if (candidateTableNumber !== undefined && candidateTableNumber !== existingTableNumber)
      return false;
    if (candidateTableId === undefined && candidateTableNumber === undefined) {
      return existingTableId === null && existingTableNumber === null;
    }
    return true;
  }

  /**
   * An idempotency key that has been seen before was found. If the incoming
   * request's server-computed commercial snapshot matches what was
   * originally persisted, this is a legitimate replay: return the original
   * order untouched — no re-verification, no re-release of KDS/KOT/POS. If
   * it does not match, the key is being reused for a materially different
   * request: reject deterministically without mutating the original order.
   */
  private async resolveIdempotentOutcome(params: {
    existingOrder: Order & { items: OrderItem[] };
    expectedSource: OrderSource;
    dto: {
      tableId?: string;
      tableNumber?: string;
      serviceMode?: ServiceMode;
      idempotencyKey: string;
    };
    resolvedItems: ResolvedOrderItem[];
    organizationId: string;
    venueId: string;
    actorId: string;
    actorEmail: string;
    actorRole: StaffRole;
  }): Promise<Order> {
    const { existingOrder, dto, organizationId, venueId, actorId, actorEmail, actorRole } = params;
    const matches = this.ordersMatchForReplay(existingOrder, {
      expectedSource: params.expectedSource,
      tableId: dto.tableId,
      tableNumber: dto.tableNumber,
      serviceMode: dto.serviceMode,
      resolvedItems: params.resolvedItems,
    });

    if (matches) {
      await this.logAuditEventSafely({
        organizationId,
        venueId,
        actorId,
        actorEmail,
        actorRole,
        action: 'ORDER_IDEMPOTENT_REPLAY',
        resource: 'order',
        resourceId: existingOrder.id,
        after: { idempotencyKey: dto.idempotencyKey },
      });
      return existingOrder;
    }

    await this.logAuditEventSafely({
      organizationId,
      venueId,
      actorId,
      actorEmail,
      actorRole,
      action: 'ORDER_IDEMPOTENCY_CONFLICT',
      resource: 'order',
      resourceId: existingOrder.id,
      after: {
        idempotencyKey: dto.idempotencyKey,
        reason: 'same idempotencyKey, different request',
      },
    });
    throw new ConflictException(
      `idempotencyKey "${dto.idempotencyKey}" was already used to create a different order`,
    );
  }

  /**
   * Pre-check only — an optimization to reject an obvious reuse before
   * hitting Stripe, not the enforcement mechanism (the DB unique index is).
   * It therefore has the same TOCTOU gap as the idempotency-key lookup that
   * runs before it: under real concurrent load, `findExistingByIdempotencyKey`
   * can miss the winner (not committed yet at that instant) while THIS check
   * — running a few milliseconds later in the same request — sees it once it
   * has committed. Confirmed against real Postgres (Story 6-1
   * re-verification, 2026-08-15): without the `idempotencyKey` comparison
   * below, a request that is genuinely its own replay was being rejected
   * here as "reused by another order" purely because of that timing gap.
   * Only reject when the conflicting order is a genuinely different
   * idempotencyKey — otherwise, no-op and let the caller continue; the
   * insert attempt (and its P2002 recovery) will resolve it correctly
   * either way.
   */
  private async rejectIfPaymentReferenceReused(
    paymentProviderTransactionId: string,
    idempotencyKey: string,
    organizationId: string,
    venueId: string,
    actor: { id: string; email: string },
  ): Promise<void> {
    const conflicting = await this.prisma.order.findUnique({
      where: { paymentProviderTransactionId },
    });
    if (!conflicting) return;
    if (conflicting.venueId === venueId && conflicting.idempotencyKey === idempotencyKey) return;

    await this.logAuditEventSafely({
      organizationId,
      venueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: StaffRole.viewer,
      action: 'ORDER_PAYMENT_REFERENCE_REUSE_REJECTED',
      resource: 'order',
      resourceId: conflicting.id,
      after: { paymentProviderTransactionId },
    });
    throw new ConflictException('This payment reference is already linked to another order');
  }

  /**
   * Handles a unique-constraint violation surfaced by persistOrder's
   * transaction. This is the actual enforcement path for the concurrent
   * duplicate-submission race: two requests can both pass the pre-checks
   * above, but only one insert can win the database constraint — the loser
   * lands here, re-fetches the winner's row, and applies the same
   * match-or-reject logic used for a sequential replay, so both callers
   * receive a deterministic, consistent outcome.
   */
  private async recoverFromPersistConflict(
    error: unknown,
    ctx: {
      venueId: string;
      expectedSource: OrderSource;
      dto: {
        tableId?: string;
        tableNumber?: string;
        serviceMode?: ServiceMode;
        idempotencyKey: string;
      };
      resolvedItems: ResolvedOrderItem[];
      organizationId: string;
      actorId: string;
      actorEmail: string;
      actorRole: StaffRole;
      paymentProviderTransactionId?: string | null;
      /**
       * Re-invokes persistOrder with the same commercial parameters (a
       * fresh call, not a raw SQL retry) — used only for a primary-key
       * collision, see below. Never used for idempotency/payment-reference
       * conflicts, which resolve to the existing row instead of retrying.
       */
      retryPersist: () => Promise<Order>;
    },
    /**
     * Internal recursion guard, never set by callers. Bounded to the same
     * maxAttempts convention already used for print-job retries elsewhere
     * in this file. Each retry can itself fail — on another id collision
     * (more callers still racing) or, once the true winner of an earlier
     * collision has committed, on the idempotencyKey/payment-reference
     * constraint — either is resolved through this same function with the
     * counter decremented, so this is bounded, never unbounded, but
     * generous enough to resolve realistic small-N concurrent-creation
     * pileups rather than only a single 2-way collision.
     */
    idCollisionRetriesRemaining = 3,
  ): Promise<Order> {
    if (!(error instanceof PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    // Postgres reports a compound unique-constraint violation by the
    // *constraint name* (e.g. "Order_venueId_idempotencyKey_key"), not the
    // bare column name — meta.target is not guaranteed to be a plain array
    // of field names for a multi-column constraint. Match on both the known
    // constraint name and the bare field name so this holds regardless of
    // which shape a given Postgres/Prisma version surfaces.
    const target = (error.meta?.target as string[] | string | undefined) ?? [];
    const targetFields = Array.isArray(target) ? target : [target];
    const targetsAny = (needles: string[]) =>
      targetFields.some((t) => needles.some((needle) => t.includes(needle)));

    if (targetsAny(['idempotencyKey', OrdersService.IDEMPOTENCY_CONSTRAINT_NAME])) {
      const winner = await this.findExistingByIdempotencyKey(ctx.venueId, ctx.dto.idempotencyKey);
      if (!winner) {
        // Should be unreachable — the constraint violation proves a row
        // exists — but never silently swallow an unexplained state.
        throw error;
      }
      return this.resolveIdempotentOutcome({
        existingOrder: winner,
        expectedSource: ctx.expectedSource,
        dto: ctx.dto,
        resolvedItems: ctx.resolvedItems,
        organizationId: ctx.organizationId,
        venueId: ctx.venueId,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail,
        actorRole: ctx.actorRole,
      });
    }

    if (targetsAny(['paymentProviderTransactionId', OrdersService.PAYMENT_REF_CONSTRAINT_NAME])) {
      // Look up the order that won the race so the audit record carries the
      // same conflicting-order-id shape as the pre-check rejection path
      // (rejectIfPaymentReferenceReused) — the story requires every rejected
      // duplicate-payment-reference attempt to be logged with that id.
      const conflicting = ctx.paymentProviderTransactionId
        ? await this.prisma.order.findUnique({
            where: { paymentProviderTransactionId: ctx.paymentProviderTransactionId },
            include: { items: true },
          })
        : null;

      // Real-Postgres evidence (Story 6-1 re-verification, 2026-08-15): when
      // N truly concurrent requests share BOTH the same idempotencyKey AND
      // the same paymentProviderTransactionId (the exact shape of a genuine
      // duplicate-submission retry), the loser's insert can violate EITHER
      // unique index — Postgres's constraint-check evaluation order under
      // contention is not something this code may assume, and it is NOT
      // always the idempotencyKey index. Without this check, a losing
      // request that hit the payment-reference index first was being
      // rejected as "reused by another order" even though the winning row
      // was its own legitimate replay target — confirmed by a 4/5-caller
      // failure in the real-Postgres concurrency integration test before
      // this fix. If the winning row shares this request's own venue AND
      // idempotencyKey, it IS this request's own order, not a reuse
      // conflict: resolve it exactly like the idempotency-collision branch.
      if (
        conflicting &&
        conflicting.venueId === ctx.venueId &&
        conflicting.idempotencyKey === ctx.dto.idempotencyKey
      ) {
        return this.resolveIdempotentOutcome({
          existingOrder: conflicting,
          expectedSource: ctx.expectedSource,
          dto: ctx.dto,
          resolvedItems: ctx.resolvedItems,
          organizationId: ctx.organizationId,
          venueId: ctx.venueId,
          actorId: ctx.actorId,
          actorEmail: ctx.actorEmail,
          actorRole: ctx.actorRole,
        });
      }

      await this.logAuditEventSafely({
        organizationId: ctx.organizationId,
        venueId: ctx.venueId,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail,
        actorRole: ctx.actorRole,
        action: 'ORDER_PAYMENT_REFERENCE_REUSE_REJECTED',
        resource: 'order',
        resourceId: conflicting?.id,
        after: {
          reason: 'race on payment reference uniqueness',
          paymentProviderTransactionId: ctx.paymentProviderTransactionId,
        },
      });
      throw new ConflictException('This payment reference is already linked to another order');
    }

    // Primary-key collision: the pre-existing ORD-6xxxxx order-numbering
    // scheme (findFirst-then-increment, out of this story's scope to
    // redesign — see deferred-work.md) lets two genuinely-different, brand
    // new concurrent orders compute the same next id. This is NOT an
    // idempotency or payment-reference conflict — there is no existing row
    // to return, because both callers are creating distinct orders that
    // simply collided on id. Confirmed against real Postgres (Story 6-1
    // re-verification, 2026-08-15): this reproduces under genuinely
    // concurrent brand-new-order creation and, unhandled, surfaces as an
    // opaque 500 to one of the two legitimate callers — a real failure of
    // this story's own "deterministic loser recovery" concurrency
    // guarantee, even though the root cause (id generation) is out of
    // scope. A bounded retry — re-running persistOrder, which recomputes
    // the next id fresh — resolves it without touching the numbering
    // algorithm itself. Confirmed against real Postgres (Story 6-1
    // re-verification) that a single retry is not always enough once more
    // than two requests race the same slot concurrently; bounded to 3
    // attempts total (matching this file's existing maxAttempts convention
    // for print-job retries) rather than either "exactly once" (insufficient
    // under realistic small-N concurrency) or unbounded (a real risk if
    // every retry kept re-colliding).
    if (targetsAny(['id', 'Order_pkey']) && idCollisionRetriesRemaining > 0) {
      try {
        return await ctx.retryPersist();
      } catch (retryError) {
        return this.recoverFromPersistConflict(retryError, ctx, idCollisionRetriesRemaining - 1);
      }
    }

    throw error;
  }

  async findAll(organizationId: string, venueId?: string, activeOnly = false): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: {
        venue: { organizationId },
        ...(venueId ? { venueId } : {}),
        ...(activeOnly
          ? { status: { in: [OrderStatus.confirmed, OrderStatus.preparing, OrderStatus.ready] } }
          : {}),
      },
      // posSyncRecord included so staff-facing responses (and this data's
      // WS counterpart, IdealposOrderDispatcherService.broadcastPosSyncUpdate)
      // carry attemptCount/nextRetryAt/errorMessage detail, not just the
      // coarse Order.posSyncStatus scalar -- needed to distinguish "never
      // attempted" from "retrying" from "permanently failed" in the UI.
      include: { items: true, table: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string, venueId?: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
      include: { items: true, table: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    dto: UpdateOrderStatusDto,
    actor: AuditActor,
    venueId?: string,
  ): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
      include: { venue: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const oldStatus = order.status;
    const newStatus = dto.status;

    if (oldStatus !== newStatus) {
      const allowed = this.validateOrderStatusTransition(oldStatus, newStatus);
      if (!allowed) {
        throw new ConflictException(
          `Invalid order status transition from ${oldStatus} to ${newStatus}`,
        );
      }
    }

    // A cancelled order must also stop any legacy external-POS dispatch
    // created alongside it, or it could still reach IdealposBridge and print
    // a real native KOT. Must run BEFORE the Order.status write so a crash
    // between the two steps never leaves Order=cancelled with the
    // dispatch-stop attempt silently skipped.
    let posDispatchStopped: boolean | null = null;
    if (newStatus === OrderStatus.cancelled && oldStatus !== OrderStatus.cancelled) {
      // Only a named staff member cancels (the kitchen role and devices are
      // refused by the controller); the connector cancel is attributed to them.
      if (actor.actorType === 'device' || actor.actorType === 'system') {
        throw new ForbiddenException('Only a staff member may cancel an order');
      }
      posDispatchStopped = await this.legacyExternalPos.stopHandoffForCancelledOrder(
        order,
        organizationId,
        { id: actor.actorId, email: actor.actorEmail, role: actor.actorRole },
      );
    }

    const updateData: Prisma.OrderUpdateInput = { status: newStatus };
    if (newStatus === OrderStatus.confirmed) {
      updateData.confirmedAt = new Date();
    } else if (newStatus === OrderStatus.preparing) {
      updateData.preparingAt = new Date();
    } else if (newStatus === OrderStatus.ready) {
      updateData.readyAt = new Date();
    } else if (newStatus === OrderStatus.completed) {
      updateData.completedAt = new Date();
    } else if (newStatus === OrderStatus.cancelled) {
      updateData.cancelledAt = new Date();
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: updateData,
      include: { items: true, table: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
    });

    // Audit log state transition, attributed to the real actor (Story 12.15):
    // a KDS screen is recorded as a device, never as a Staff row.
    await this.auditLogService.logAuthEvent({
      organizationId,
      venueId: order.venueId,
      ...actor,
      action: 'UPDATE_ORDER_STATUS',
      resource: 'order',
      resourceId: order.id,
      before: { status: oldStatus },
      after: {
        status: newStatus,
        ...(posDispatchStopped !== null ? { posDispatchStopped } : {}),
      },
    });

    // Notify KDS / Admin dashboards via WebSockets
    this.ordersGateway.sendOrderUpdate(order.venueId, updatedOrder);

    return updatedOrder;
  }

  async createConnectionToken(): Promise<{ secret: string }> {
    const stripeApiKey = this.requireStripeKey();
    const stripe = new Stripe(stripeApiKey, {
      apiVersion: '2024-06-20' as unknown as Stripe.LatestApiVersion,
    });
    try {
      const token = await stripe.terminal.connectionTokens.create();
      return { secret: token.secret };
    } catch {
      throw new ServiceUnavailableException('Stripe Terminal is unavailable');
    }
  }

  async createPaymentIntent(amountCents: number): Promise<{ clientSecret: string | null }> {
    const stripeApiKey = this.requireStripeKey();
    const stripe = new Stripe(stripeApiKey, {
      apiVersion: '2024-06-20' as unknown as Stripe.LatestApiVersion,
    });
    try {
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'nzd',
        payment_method_types: ['card_present'],
      });
      return { clientSecret: intent.client_secret };
    } catch {
      throw new ServiceUnavailableException('Stripe payment setup is unavailable');
    }
  }

  private requireStripeKey(): string {
    const stripeApiKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeApiKey || stripeApiKey === 'sk_test_dummy') {
      throw new ServiceUnavailableException('Stripe payment is not configured');
    }
    return stripeApiKey;
  }

  private async verifyKioskPayment(
    paymentIntentId: string,
    expectedAmountCents: number,
  ): Promise<void> {
    // Unit tests exercise order-domain behavior without external provider I/O.
    // Every real server mode fails closed and verifies Stripe's authoritative state.
    if (process.env.NODE_ENV === 'test') return;

    const stripe = new Stripe(this.requireStripeKey(), {
      apiVersion: '2024-06-20' as unknown as Stripe.LatestApiVersion,
    });
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch {
      throw new BadRequestException('Unable to verify the Stripe payment');
    }
    if (intent.status !== 'succeeded') {
      throw new BadRequestException('Stripe payment has not succeeded');
    }
    if (intent.amount !== expectedAmountCents || intent.currency.toLowerCase() !== 'nzd') {
      throw new ConflictException('Stripe payment amount or currency does not match the order');
    }
  }

  /**
   * AuditLog.actorId is a required FK to a real Staff row — kiosk orders
   * have no authenticated staff member, so audit logging needs a real,
   * org-scoped "system" account rather than a fabricated string id (which
   * would violate the FK against real Postgres). Inactive/unusable for
   * login: it only exists to satisfy the audit trail's referential
   * integrity. Idempotent per organization via upsert on its reserved email.
   */
  private async resolveKioskSystemActor(organizationId: string): Promise<Staff> {
    const email = `kiosk-system+${organizationId}@verdura.internal`;
    return this.prisma.staff.upsert({
      where: { email },
      create: {
        organizationId,
        email,
        name: 'Kiosk System',
        passwordHash: await argon2.hash(randomUUID(), { type: argon2.argon2id }),
        role: StaffRole.viewer,
        isActive: false,
      },
      update: {},
    });
  }

  private async resolveVenue(venueId: string): Promise<Venue> {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }
    return venue;
  }

  /**
   * The active-order check below is a fast-fail pre-check only, run before
   * the (potentially expensive) item-resolution work — it is NOT the
   * enforcement mechanism for "at most one active order per table". Under
   * real concurrency it has the same TOCTOU gap as the idempotency-key
   * lookup that precedes it in both callers: a second request can pass this
   * check before the first has committed. The actual guarantee is the
   * `FOR UPDATE` row lock + recheck inside persistOrder's transaction; this
   * pre-check only makes the common, non-racing case fail fast with a
   * cheap read instead of doing full item resolution first.
   */
  private async validateTableForOrder(
    venueId: string,
    tableId?: string,
    tableNumber?: string,
  ): Promise<ResolvedTable> {
    if (!tableId && !tableNumber) {
      return { tableId: null, tableNumber: null };
    }

    const table = await this.prisma.table.findFirst({
      where: {
        venueId,
        isActive: true,
        OR: [...(tableId ? [{ id: tableId }] : []), ...(tableNumber ? [{ tableNumber }] : [])],
      },
    });
    if (!table) {
      throw new BadRequestException('Invalid or inactive table');
    }

    // TEMPORARY (Phase D3 occupancy bridge): see table-session-occupancy.ts.
    await assertTableHasNoOpenSession(this.prisma, table);

    const activeOrder = await this.prisma.order.findFirst({
      where: {
        venueId,
        OR: [{ tableId: table.id }, { tableNumber: table.tableNumber }],
        status: {
          in: [
            OrderStatus.pending,
            OrderStatus.confirmed,
            OrderStatus.preparing,
            OrderStatus.ready,
          ],
        },
      },
    });
    if (activeOrder) {
      throw new ConflictException(`Table ${table.tableNumber} already has an active order`);
    }

    return { tableId: table.id, tableNumber: table.tableNumber };
  }

  /**
   * Validates/prices each submitted line item against PostgreSQL — the
   * base price is always the DB (or venue-override) price, never the
   * client's. Modifier price deltas are matched against the menu item's
   * configured `modifierGroups` catalog when one exists; when an item has
   * no configured catalog yet, a submitted modifier is kept as an
   * annotation (name/notes) but its price contribution is always zero, so
   * a client can never inject an unverifiable price delta.
   */
  /**
   * Validates/prices each submitted line item against PostgreSQL — the
   * base price is always the DB (or venue-override) price, never the
   * client's. `strict` selects which modifier-resolution contract applies
   * (see `resolveModifiers`): `true` for the staff/tablet order-creation
   * surfaces (Story 15-3's ID-based, independently-validated path — used
   * by both `/api/admin/orders` and `/api/tablet/orders`, since
   * `createStaffOrder` is their shared implementation); `false` for the
   * public kiosk path, preserved exactly as it worked before this story
   * (Window Display's separate, out-of-scope legacy flow depends on it).
   */
  /**
   * Price and validate lines for a further native round on an EXISTING order.
   *
   * WHY THIS EXISTS RATHER THAN THE ROUND CONTROLLER DOING ITS OWN LOOKUP.
   * There must be exactly one authority on what a line costs, what it is
   * called, and which category it belongs to, and it is the same code that
   * priced round one. A second implementation would drift, and the drift would
   * show up as round two of a table priced differently from round one - on one
   * bill, in front of the customer who ordered both.
   *
   * `strict: true` matches the staff-order path: an unknown item, an
   * unavailable item or an unresolvable modifier is a rejection, never a
   * silently-dropped line. A round that quietly lost an item is a customer who
   * does not get their food.
   */
  async resolveRoundLines(
    venueId: string,
    organizationId: string,
    items: CreateOrderItemDto[],
  ): Promise<ResolvedOrderItem[]> {
    const venue = await this.resolveVenue(venueId);
    if (venue.organizationId !== organizationId) {
      throw new ForbiddenException('Venue does not belong to your organization');
    }
    const { resolvedItems } = await this.resolveOrderItems(items, venue, true);
    return resolvedItems;
  }

  private async resolveOrderItems(
    items: CreateOrderItemDto[],
    venue: Venue,
    strict: boolean,
  ): Promise<{ resolvedItems: ResolvedOrderItem[]; subtotalCents: number }> {
    let subtotalCents = 0;
    const resolvedItems: ResolvedOrderItem[] = [];

    for (const itemDto of items) {
      const menuItem = await this.prisma.menuItem.findFirst({
        where: { id: itemDto.menuItemId, organizationId: venue.organizationId, deletedAt: null },
        include: { category: true },
      });
      if (!menuItem) {
        throw new BadRequestException(`MenuItem with ID ${itemDto.menuItemId} not found`);
      }

      const override = await this.prisma.menuItemVenueOverride.findUnique({
        where: {
          menuItemId_venueId: {
            menuItemId: itemDto.menuItemId,
            venueId: venue.id,
          },
        },
      });

      const isAvailable = override?.isAvailable ?? menuItem.isAvailable;
      if (!isAvailable) {
        throw new ConflictException(`Menu item "${menuItem.title}" is currently unavailable`);
      }

      const basePriceCents = override?.priceCents ?? menuItem.priceCents;

      const { modifiers: resolvedModifiers, priceDelta: modifiersPriceDelta } =
        this.resolveModifiers(menuItem.modifierGroups, itemDto.selectedModifiers || [], strict);

      const unitPriceCents = basePriceCents + modifiersPriceDelta;
      const lineTotalCents = unitPriceCents * itemDto.quantity;

      subtotalCents += lineTotalCents;

      resolvedItems.push({
        menuItemId: menuItem.id,
        menuItemTitle: menuItem.title,
        menuItemCategory: menuItem.category.name,
        unitPriceCents,
        quantity: itemDto.quantity,
        lineTotalCents,
        selectedModifiers: resolvedModifiers,
        notes: itemDto.notes || null,
        // Normalize to a positive integer or null — never seat 0 — matching
        // buildIdealposOrderPayload's own rule so the same seat value behaves
        // identically at persistence and at native-payload build time.
        seat: OrdersService.normalizeSeat(itemDto.seat),
      });
    }

    if (resolvedItems.length === 0) {
      throw new BadRequestException('An order must contain at least one item');
    }

    return { resolvedItems, subtotalCents };
  }

  /**
   * Defensively parses the raw `MenuItem.modifierGroups` JSON (still an
   * embedded column per DL-017 — no schema change) into the typed shape
   * `ModifierGroupDto`/`ModifierOptionDto` authors via Menu Management.
   * Anything not matching the expected shape (legacy/malformed rows) is
   * silently skipped, never thrown on — a defensively-empty catalog is
   * exactly what the strict path already needs to fail closed on.
   */
  private parseModifierGroups(raw: unknown): Array<{
    id: string;
    name: string;
    required: boolean;
    minSelections: number;
    maxSelections: number;
    options: Array<{ id: string; name: string; priceDeltaCents: number; isAvailable: boolean }>;
  }> {
    if (!Array.isArray(raw)) return [];
    const groups: ReturnType<OrdersService['parseModifierGroups']> = [];
    for (const g of raw as Array<Record<string, unknown>>) {
      if (typeof g?.id !== 'string' || typeof g?.name !== 'string') continue;
      const options: (typeof groups)[number]['options'] = [];
      const rawOptions = Array.isArray(g.options) ? g.options : [];
      for (const o of rawOptions as Array<Record<string, unknown>>) {
        if (
          typeof o?.id !== 'string' ||
          typeof o?.name !== 'string' ||
          typeof o?.priceDeltaCents !== 'number'
        ) {
          continue;
        }
        options.push({
          id: o.id,
          name: o.name,
          priceDeltaCents: o.priceDeltaCents,
          isAvailable: o.isAvailable !== false,
        });
      }
      groups.push({
        id: g.id,
        name: g.name,
        required: g.required === true,
        minSelections: typeof g.minSelections === 'number' ? g.minSelections : 0,
        maxSelections: typeof g.maxSelections === 'number' ? g.maxSelections : options.length,
        options,
      });
    }
    return groups;
  }

  /**
   * Two independent resolution contracts, selected by `strict`:
   *
   * - Non-strict (kiosk, unchanged from before Story 15-3): matches by
   *   trimmed/lowercased name against a flattened catalog built from real
   *   `modifierGroups` data. An unrecognized name is rejected only if the
   *   item has *some* configured catalog; if the item has none at all, the
   *   name is kept as an annotation with its price forced to zero — this
   *   is the pre-existing, deliberately-conservative anti-injection
   *   fallback (see `orders.integration-spec.ts`'s negative-price-injection
   *   test) and Window Display's separate legacy ordering flow depends on
   *   it continuing to work exactly as before.
   * - Strict (staff/tablet, Story 15-3): every selection must resolve to a
   *   real `modifierGroupId`+`optionId` on *this* item. Nothing is ever
   *   silently zeroed, dropped, or annotated-only — anything the server
   *   cannot independently verify is rejected outright, and every group's
   *   `required`/`minSelections`/`maxSelections` is enforced against what
   *   actually resolved to it.
   */
  private resolveModifiers(
    menuItemModifierGroups: unknown,
    selectedModifiers: OrderItemModifierDto[],
    strict: boolean,
  ): { modifiers: ResolvedSelectedModifier[]; priceDelta: number } {
    const groups = this.parseModifierGroups(menuItemModifierGroups);

    if (!strict) {
      const catalog = new Map<string, number>();
      for (const group of groups) {
        for (const option of group.options) {
          catalog.set(option.name.trim().toLowerCase(), option.priceDeltaCents);
        }
      }

      let priceDelta = 0;
      const modifiers = selectedModifiers.map((mod) => {
        const name = (mod.name ?? '').trim();
        if (!name) {
          throw new BadRequestException('Each selected modifier must supply a name');
        }
        const catalogPrice = catalog.get(name.toLowerCase());
        if (catalogPrice !== undefined) {
          priceDelta += catalogPrice;
          return {
            modifierGroupId: null,
            modifierGroupName: null,
            optionId: null,
            optionName: name,
            priceDeltaCents: catalogPrice,
          };
        }
        if (catalog.size > 0) {
          throw new BadRequestException(`"${name}" is not a valid option for this item`);
        }
        return {
          modifierGroupId: null,
          modifierGroupName: null,
          optionId: null,
          optionName: name,
          priceDeltaCents: 0,
        };
      });

      return { modifiers, priceDelta };
    }

    // Strict path.
    for (const mod of selectedModifiers) {
      if (!mod.modifierGroupId || !mod.optionId) {
        throw new BadRequestException(
          'Each selected modifier must specify modifierGroupId and optionId',
        );
      }
    }
    if (groups.length === 0 && selectedModifiers.length > 0) {
      throw new BadRequestException('This item has no configurable options');
    }

    const seenOptionIds = new Set<string>();
    const selectionsByGroup = new Map<string, ResolvedSelectedModifier[]>();
    let priceDelta = 0;

    for (const mod of selectedModifiers) {
      const group = groups.find((g) => g.id === mod.modifierGroupId);
      if (!group) {
        throw new BadRequestException('Unknown modifier group for this item');
      }
      const option = group.options.find((o) => o.id === mod.optionId);
      if (!option) {
        throw new BadRequestException('Unknown modifier option for this item');
      }
      if (!option.isAvailable) {
        throw new ConflictException(`"${option.name}" is no longer available`);
      }
      if (seenOptionIds.has(option.id)) {
        throw new BadRequestException('Duplicate modifier option selected');
      }
      seenOptionIds.add(option.id);

      const resolved: ResolvedSelectedModifier = {
        modifierGroupId: group.id,
        modifierGroupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDeltaCents: option.priceDeltaCents,
      };
      priceDelta += option.priceDeltaCents;
      const bucket = selectionsByGroup.get(group.id) ?? [];
      bucket.push(resolved);
      selectionsByGroup.set(group.id, bucket);
    }

    for (const group of groups) {
      const count = selectionsByGroup.get(group.id)?.length ?? 0;
      if (group.required && count === 0) {
        throw new BadRequestException(`"${group.name}" requires a selection`);
      }
      if ((group.required || count > 0) && count < group.minSelections) {
        throw new BadRequestException(
          `"${group.name}" requires at least ${group.minSelections} selection(s)`,
        );
      }
      if (count > group.maxSelections) {
        throw new BadRequestException(
          `"${group.name}" allows at most ${group.maxSelections} selection(s)`,
        );
      }
    }

    const modifiers = [...selectionsByGroup.values()].flat();
    return { modifiers, priceDelta };
  }

  /**
   * Only relevant to genuinely new (non-replay) submissions — call sites
   * run this strictly after confirming no matching idempotent order was
   * found, so a legitimate retry never re-litigates whether the price it
   * originally saw is still current (it returns the original result
   * unchanged instead — see `itemsFingerprint`/`ordersMatchForReplay`).
   * Compares each line's caller-supplied `expectedUnitPriceCents` (the
   * price it displayed before submitting) against what was just resolved
   * from current authoritative data; a mismatch means the menu/modifier
   * price changed between load and submission, and the whole request
   * fails closed with the authoritative line(s) attached rather than
   * silently charging a different amount than what was reviewed (Story
   * 15-3). Items that never supply `expectedUnitPriceCents` (the kiosk/
   * legacy path never does) are not checked — this is additive, not a
   * behavior change for callers that don't opt in.
   */
  private checkExpectedPrices(
    items: CreateOrderItemDto[],
    resolvedItems: ResolvedOrderItem[],
  ): void {
    const conflicts: Array<{
      menuItemId: string;
      menuItemTitle: string;
      expectedUnitPriceCents: number;
      authoritativeUnitPriceCents: number;
    }> = [];
    items.forEach((item, index) => {
      if (item.expectedUnitPriceCents === undefined) return;
      const resolved = resolvedItems[index];
      if (resolved.unitPriceCents !== item.expectedUnitPriceCents) {
        conflicts.push({
          menuItemId: resolved.menuItemId,
          menuItemTitle: resolved.menuItemTitle,
          expectedUnitPriceCents: item.expectedUnitPriceCents,
          authoritativeUnitPriceCents: resolved.unitPriceCents,
        });
      }
    });
    if (conflicts.length > 0) {
      throw new ConflictException({
        message:
          'One or more menu prices changed since this order was built — review the updated price(s) before resubmitting',
        code: 'STALE_PRICE',
        conflicts,
      });
    }
  }

  /**
   * The only venue tax configuration this method's arithmetic is correct
   * for (DL-072): NZ, GST-inclusive menu prices. Mirrors
   * `apps/web/admin-console/src/pages/order-tablet/billing.ts`'s
   * `SUPPORTED_TAX_PROFILE`/`containedGstCents` exactly — this is a
   * deliberate parity duplication, not an independent formula. If either
   * the supported profile or the `3/23` extraction formula ever changes,
   * both places must change together, or the Order Tablet's displayed
   * provisional total and this backend's persisted total will diverge
   * again (see 2026-08-20 GST reconciliation fix and its regression
   * tests, `orders.service.spec.ts` "computeTotals (GST correction)").
   * A real cross-app shared package was considered and deliberately not
   * built this session (apps/api is CommonJS/ts-node, apps/web/admin-console
   * is Vite/ESM — wiring a dual-consumable workspace package safely was
   * judged disproportionate risk for this fix); flagged as a follow-up.
   */
  private static readonly SUPPORTED_TAX_PROFILE = {
    currency: 'NZD',
    taxJurisdiction: 'NZ_GST',
    pricesIncludeTax: true,
  } as const;

  private isSupportedTaxProfile(venue: Venue): boolean {
    const p = OrdersService.SUPPORTED_TAX_PROFILE;
    return (
      venue.currency === p.currency &&
      venue.taxJurisdiction === p.taxJurisdiction &&
      venue.pricesIncludeTax === p.pricesIncludeTax
    );
  }

  /**
   * Table 19 controlled live-validation guard (Order Tablet Idealpos+KDS+KOT
   * orchestration validation). Entirely inert — a no-op, zero behavior
   * change for every table/venue — unless BOTH `TABLE19_LIVE_TEST_ENABLED`
   * is exactly the string `'true'` AND `NODE_ENV !== 'production'`;
   * production is hard-disabled regardless of the flag's value, mirroring
   * `IdealposFixtureInjectionController.assertNonProduction()`'s identical
   * pattern. Checked only against the server-*resolved* table (the caller
   * passes the value `validateTableForOrder` already returned, never the
   * raw client-supplied `tableId`/`tableNumber`), so it cannot be bypassed
   * by request-body tampering. Only called for genuinely new submissions —
   * see the call site's own comment for why a replay must never re-run it.
   */
  private isTable19ValidationModeActiveForVenue(venue: Venue): boolean {
    if (process.env.TABLE19_LIVE_TEST_ENABLED !== 'true' || isProductionRuntime()) {
      return false;
    }
    return venue.id === process.env.TABLE19_LIVE_TEST_VENUE_ID;
  }

  private async assertTable19ValidationModeAllows(
    venue: Venue,
    resolvedTableNumber: string | null,
  ): Promise<void> {
    if (process.env.TABLE19_LIVE_TEST_ENABLED !== 'true' || isProductionRuntime()) {
      return;
    }
    const configuredVenueId = process.env.TABLE19_LIVE_TEST_VENUE_ID;
    if (!configuredVenueId || venue.id !== configuredVenueId) {
      throw new ForbiddenException(
        'Table 19 controlled-validation mode is active for a different venue than this request targets — refusing to process.',
      );
    }
    if (resolvedTableNumber !== '19') {
      throw new ForbiddenException(
        'Table 19 controlled-validation mode is active — only Table 19 may accept orders while it is enabled.',
      );
    }
    const openRun = await this.prisma.table19ValidationRun.findFirst({
      where: { venueId: venue.id, resetAt: null },
      select: { id: true },
    });
    if (openRun) {
      throw new ForbiddenException(
        'A controlled Table 19 validation order already exists for this venue — ask an authorised operator to reset it (POST /admin/table19-validation/reset) before submitting another.',
      );
    }
  }

  /**
   * Authorised-operator reset for the Table 19 controlled-validation guard
   * — see assertTable19ValidationModeAllows. Always resolves the venue from
   * server-side config (`TABLE19_LIVE_TEST_VENUE_ID`), never from a
   * client-supplied id, so this endpoint cannot be pointed at an
   * arbitrary venue by request tampering.
   */
  async resetTable19ValidationRun(
    organizationId: string,
    actor: { id: string; email: string; role: StaffRole },
    scopedVenueId: string | undefined,
  ): Promise<{ reset: true }> {
    const configuredVenueId = process.env.TABLE19_LIVE_TEST_VENUE_ID;
    if (!configuredVenueId) {
      throw new NotFoundException('Table 19 validation mode is not configured for any venue.');
    }
    if (scopedVenueId && scopedVenueId !== configuredVenueId) {
      throw new ForbiddenException(
        'This device is not authorized for the Table 19 validation venue.',
      );
    }
    const venue = await this.resolveVenue(configuredVenueId);
    if (venue.organizationId !== organizationId) {
      throw new ForbiddenException(
        'Table 19 validation venue does not belong to your organization',
      );
    }
    const openRun = await this.prisma.table19ValidationRun.findFirst({
      where: { venueId: configuredVenueId, resetAt: null },
    });
    if (!openRun) {
      throw new NotFoundException('No open Table 19 validation run to reset.');
    }
    await this.prisma.table19ValidationRun.update({
      where: { id: openRun.id },
      data: { resetAt: new Date(), resetByStaffId: actor.id },
    });
    await this.logAuditEventSafely({
      organizationId,
      venueId: configuredVenueId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'TABLE19_VALIDATION_RESET',
      resource: 'table19ValidationRun',
      resourceId: openRun.id,
      after: { orderId: openRun.orderId },
    });
    return { reset: true };
  }

  /**
   * DL-072: for a GST-inclusive venue, menu prices already contain GST —
   * the payable total is the subtotal, unchanged. GST is disclosed as the
   * *contained* component (`gross × 3/23`, the standard NZ 15%-rate
   * GST-inclusive extraction formula) for receipt/reporting purposes only
   * and must never be added on top of the subtotal. An unsupported or
   * unrecognized venue tax configuration fails closed rather than
   * guessing which convention (additive vs. contained) applies.
   */
  private computeTotals(
    venue: Venue,
    subtotalCents: number,
  ): { taxCents: number; totalCents: number } {
    if (!this.isSupportedTaxProfile(venue)) {
      throw new UnprocessableEntityException(
        `Venue ${venue.id} has an unsupported tax configuration for total calculation ` +
          `(currency=${venue.currency}, taxJurisdiction=${venue.taxJurisdiction}, ` +
          `pricesIncludeTax=${venue.pricesIncludeTax}) — refusing to guess a payable total.`,
      );
    }
    const taxCents = Math.round((subtotalCents * 3) / 23);
    return { taxCents, totalCents: subtotalCents };
  }

  private async persistOrder(params: {
    venue: Venue;
    tableId: string | null;
    tableNumber: string | null;
    /** Story 15-13. Always explicit — never left to the schema's own DEFAULT to decide, so every caller's intent is traceable in this method's own args. */
    serviceMode: ServiceMode;
    /** Covers, exactly as the waiter set them. Null when genuinely unknown - never inferred, because a native Order2 round sends this to the till as fact. */
    guests: number | null;
    resolvedItems: ResolvedOrderItem[];
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    notes?: string;
    source: OrderSource;
    initialStatus: OrderStatus;
    confirmedAt?: Date;
    idempotencyKey: string;
    paymentProviderTransactionId: string | null;
    /** Table 19 controlled-validation tracking row — see assertTable19ValidationModeAllows. Never set outside that guard's own active check. */
    createTable19ValidationRun?: boolean;
  }): Promise<Order> {
    const {
      venue,
      tableId,
      tableNumber,
      serviceMode,
      guests,
      resolvedItems,
      subtotalCents,
      taxCents,
      totalCents,
      notes,
      source,
      initialStatus,
      confirmedAt,
      idempotencyKey,
      paymentProviderTransactionId,
      createTable19ValidationRun,
    } = params;

    // Legacy external-POS plan, decided once for every order-creating path
    // (kiosk, staff tablet, restricted tablet). Deliberately OUTSIDE the
    // transaction below and BEFORE any sequence is drawn: a refusal must cost
    // nothing and leave nothing behind. A venue with no external POS gets
    // `none` and never consults IdealPOS configuration.
    const legacyPosPlan = this.legacyExternalPos.planForNewOrder(venue, serviceMode);

    // Story 15-13: a stable, human-readable takeaway reference, minted from
    // a dedicated Postgres sequence (never a "latest row + 1" read — see
    // this migration's own comment on why that pattern is not repeated
    // here). nextval() is inherently concurrency-safe and collision-free;
    // it is NOT transactional (a rollback after this point leaves a
    // permanent, harmless gap rather than reusing the number — see the
    // migration's comment for why a gap is the correct trade-off). Called
    // OUTSIDE the transaction below deliberately: nextval() gains no
    // atomicity benefit from being inside it (it isn't rolled back either
    // way), and an earlier version that called it inside the transaction
    // measurably widened the pre-existing ORD-6xxxxx findFirst-then-
    // increment race (deferred-work.md's own "Order-ID generation... races
    // under concurrent load" entry) by adding a round-trip between that
    // read and its write — reproduced live via this story's own 5-concurrent
    // -distinct-takeaway-orders integration test, fixed by moving this call
    // here. Only generated for a genuinely new takeaway order — every other
    // call path (dine-in, kiosk, and every idempotent-replay path, which
    // returns the ORIGINAL order without ever reaching this method) leaves
    // takeawayReference null.
    let takeawayReference: string | null = null;
    if (serviceMode === ServiceMode.takeaway) {
      const [{ nextval }] = await this.prisma.$queryRaw<
        [{ nextval: bigint }]
      >`SELECT nextval('"TakeawayReference_seq"') AS nextval`;
      takeawayReference = `TA-${nextval.toString().padStart(6, '0')}`;
    }

    // ORD-6XXXXX order id, minted from a dedicated Postgres sequence for
    // the identical reason takeawayReference is above: nextval() is
    // atomic and collision-free under concurrent load, unlike the
    // findFirst-then-increment read this replaces (a real, previously-
    // known, never-fixed race — see migration 20260824000000_order_id_sequence's
    // own comment). Called outside the transaction for the same
    // no-atomicity-benefit-from-being-inside-it reasoning as
    // takeawayReference above.
    const [{ nextval: orderNextval }] = await this.prisma.$queryRaw<
      [{ nextval: bigint }]
    >`SELECT nextval('"Order_ORD6_seq"') AS nextval`;
    const orderId = `ORD-${orderNextval.toString()}`;

    const order = await this.prisma.$transaction(async (tx) => {
      // Closes a real TOCTOU race left open by validateTableForOrder's
      // pre-check (a plain, non-transactional findFirst): two concurrent
      // requests carrying DIFFERENT idempotency keys for the SAME table
      // (e.g. a browser reload regenerates OrderTabletPage's in-memory
      // orderIdempotencyKey — see OrderTabletPage.tsx — so a genuine retry
      // after a lost response no longer shares a key with the original,
      // in-flight request) can both pass that pre-check before either has
      // committed, and both go on to create a distinct durable order for
      // the same table. `FOR UPDATE` takes a row lock on the Table itself,
      // so a second concurrent transaction targeting the same table blocks
      // here until the first commits or rolls back — at which point this
      // recheck deterministically sees any order the first transaction
      // just created and rejects, instead of racing it. A no-op (lock
      // acquired instantly, recheck finds nothing) in the common
      // non-concurrent case, since validateTableForOrder's pre-check has
      // already ruled out an active order for the fast-fail path above.
      if (tableId) {
        await tx.$queryRaw`SELECT id FROM "Table" WHERE id = ${tableId} FOR UPDATE`;
        // TEMPORARY (Phase D3 occupancy bridge): the authoritative check,
        // under the same Table row lock Servvia Core's session open takes
        // FOR SHARE. See table-session-occupancy.ts.
        await assertTableHasNoOpenSession(tx, { id: tableId, tableNumber });
        const stillActiveOrder = await tx.order.findFirst({
          where: {
            venueId: venue.id,
            OR: [{ tableId }, ...(tableNumber ? [{ tableNumber }] : [])],
            status: {
              in: [
                OrderStatus.pending,
                OrderStatus.confirmed,
                OrderStatus.preparing,
                OrderStatus.ready,
              ],
            },
          },
        });
        if (stillActiveOrder) {
          throw new ConflictException(
            `Table ${tableNumber ?? tableId} already has an active order`,
          );
        }
      }

      const newOrder = await tx.order.create({
        data: {
          id: orderId,
          venueId: venue.id,
          tableId,
          tableNumber,
          serviceMode,
          // Covers. Persisted exactly as sent and never inferred: a native
          // Order2 round carries this number to the till as fact, so a guess
          // here becomes a wrong cover count on a real bill. Absent stays
          // null, which every consumer reads as "unknown".
          guests,
          takeawayReference,
          status: initialStatus,
          posSyncStatus: this.legacyExternalPos.initialOrderPosSyncStatus(legacyPosPlan),
          subtotalCents,
          taxCents,
          totalCents,
          notes: notes || null,
          source,
          confirmedAt: confirmedAt ?? null,
          idempotencyKey,
          paymentProviderTransactionId,
        },
      });

      for (const resItem of resolvedItems) {
        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            menuItemId: resItem.menuItemId,
            menuItemTitle: resItem.menuItemTitle,
            menuItemCategory: resItem.menuItemCategory,
            unitPriceCents: resItem.unitPriceCents,
            quantity: resItem.quantity,
            lineTotalCents: resItem.lineTotalCents,
            selectedModifiers: resItem.selectedModifiers as unknown as Prisma.InputJsonValue,
            notes: resItem.notes,
            seat: resItem.seat,
          },
        });
      }

      if (createTable19ValidationRun) {
        // One row per open validation run, enforced by
        // assertTable19ValidationModeAllows's own read-before-this-call
        // check (not a DB constraint) — acceptable for this narrowly
        // scoped, staff-only, non-production validation feature; the
        // check-then-act window is the same one this codebase already
        // accepts for the pre-existing ORD-6xxxxx numbering scheme above.
        await tx.table19ValidationRun.create({
          data: { venueId: venue.id, orderId: newOrder.id },
        });
      }

      // Legacy external-POS outbox row (IdealPOS), written in this same
      // transaction so the handoff commits atomically with the order. A
      // Servvia-native venue (`none`) writes nothing here.
      await this.legacyExternalPos.recordHandoffInTransaction(tx, legacyPosPlan, {
        orderId: newOrder.id,
        venueId: venue.id,
      });

      // Servvia's own KOT pipeline (PrinterJob -> PrinterDispatcherService)
      // prints for every venue, except while a legacy external POS prints the
      // ticket itself - creating both would print two tickets for one order.
      const printers = this.legacyExternalPos.externalPosPrintsKitchenTicket(venue)
        ? []
        : await tx.printer.findMany({
            where: { venueId: venue.id, isActive: true },
          });

      for (const printer of printers) {
        await tx.printerJob.create({
          data: {
            printerId: printer.id,
            orderId: newOrder.id,
            venueId: venue.id,
            status: PrintJobStatus.queued,
            // Placeholder only -- PrinterDispatcherService re-renders the
            // real, money-field-free KOT content from live order data via
            // kot-renderer.ts at dispatch time (see
            // printer-dispatcher.service.ts processDispatchCandidate). This
            // column is never read/sent as-is by any dispatch path; it
            // exists only because `payload` is a required, non-nullable
            // String on this model. Previously this held a receipt-style
            // string with Subtotal/GST/Total, which contradicted
            // kot-renderer.ts's "KOT excludes money" invariant at the point
            // of creation even though it was never actually sent anywhere --
            // fixed here rather than left as a dead but misleading value.
            payload: `Order ${newOrder.id} queued for printer ${printer.id}`,
            payloadFormat: printer.protocol,
          },
        });
      }

      // Durable KDS delivery-intent outbox row (mirrors the POSSyncRecord and
      // PrinterJob rows above) -- see KdsDeliveryRecord's own schema comment.
      // Unconditional: every order needs exactly one KDS delivery intent,
      // regardless of venue POS configuration (unlike the POSSyncRecord
      // branch above, which is gated on posAdapterType). KdsDispatcherService
      // periodically sweeps `queued` rows and pushes them over the same
      // WebSocket room broadcastOrder already targets -- this row is a
      // durability backstop for the crash window between this transaction's
      // commit and broadcastOrder's post-commit emit, not a replacement for
      // it. Do not add a direct dispatch call here -- see
      // KdsDispatcherService's own class doc comment.
      await tx.kdsDeliveryRecord.create({
        data: {
          orderId: newOrder.id,
          venueId: venue.id,
          status: KdsDeliveryStatus.queued,
        },
      });

      // Every other order-serving path (findAll, findOne, broadcastOrder's
      // WebSocket push) includes `items` -- returning the bare `newOrder`
      // here made the immediate POST /admin/orders|kiosk/orders response
      // the one inconsistent shape. Real defect found during Story 15-5
      // browser verification (2026-08-20): the Order Tablet frontend caches
      // this response directly and later re-hydrates a re-opened table's
      // cart from it (OrderTabletPage.hydrateTableOrder), which crashed on
      // `order.items.map` for any order re-opened before the next
      // WebSocket/list refetch reconciled it with the items-included
      // shape -- a real, reproducible TypeError, and (had the crash not
      // aborted the handler first) a risk of the cart panel silently
      // continuing to show a previously-viewed table's stale items under
      // the newly-selected table's label.
      const withItems = await tx.order.findUnique({
        where: { id: newOrder.id },
        // posSyncRecord included for the same reason `items` is: every other
        // order-serving path (findAll, findOne, broadcastOrder) carries it, and
        // this response was the one inconsistent shape. The Order Tablet now
        // reads `posSyncRecord.strategy` from it to learn whether this order
        // takes the native handheld path - which it must know BEFORE it can
        // send round one, and which it would otherwise have to guess from
        // configuration the client has no business holding.
        include: { items: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
      });
      // Unreachable in practice -- this row was created earlier in this
      // same transaction -- but never silently fall back to the
      // items-less shape this fix exists to eliminate.
      if (!withItems)
        throw new Error(`Order ${newOrder.id} vanished within its own creation transaction`);
      return withItems;
    });

    return order;
  }

  private async broadcastOrder(orderId: string, venueId: string): Promise<void> {
    const orderWithItems = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, ...LEGACY_EXTERNAL_POS_ORDER_INCLUDE },
    });
    this.ordersGateway.sendOrderUpdate(venueId, orderWithItems);
  }

  private validateOrderStatusTransition(oldStatus: OrderStatus, newStatus: OrderStatus): boolean {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.pending]: [OrderStatus.confirmed, OrderStatus.cancelled],
      [OrderStatus.confirmed]: [OrderStatus.preparing, OrderStatus.cancelled],
      [OrderStatus.preparing]: [OrderStatus.ready, OrderStatus.cancelled],
      [OrderStatus.ready]: [OrderStatus.completed, OrderStatus.cancelled],
      [OrderStatus.completed]: [],
      [OrderStatus.cancelled]: [],
    };
    return (allowedTransitions[oldStatus] || []).includes(newStatus);
  }
}

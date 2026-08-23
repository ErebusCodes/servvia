import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  Prisma,
  PaymentObservationSourceKind,
  PaymentObservationState,
  IdealposEvidenceTier,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parsePaymentObservationEvent } from './dto/payment-observation-event.dto';
import {
  PAYMENT_DISCREPANCY_STATE,
  PAYMENT_OBSERVATION_ALLOWED_TRANSITIONS,
} from './payment-observation.constants';

const MAX_CAS_ATTEMPTS = 5;
const TERMINAL_MONEY_STATES = new Set(['paid', 'reversed', 'refunded']);

function fingerprintOf(fields: {
  state: string;
  nativeReference: string | null;
  amountCents: number | null;
  currency: string | null;
  tenderMethod: string | null;
  nativeTimestamp: string | null;
}): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export interface RecordObservationResult {
  outcome: 'applied' | 'conflict' | 'duplicate';
  eventId: string;
}

/**
 * Story 15-6: native IdealPOS payment-state OBSERVATION and reconciliation.
 * Never a payment-initiation service -- there is no method here, and must
 * never be one, that selects a tender, submits a transaction, or otherwise
 * mutates native IdealPOS/EFTPOS state. See payment-observation.constants.ts
 * and schema.prisma's own PaymentObservation/PaymentObservationEvent doc
 * comments for the full rationale and current Bridge-contract boundary.
 */
@Injectable()
export class PaymentObservationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one raw observation event (immutably) and applies it to the
   * order's current projection via a bounded-retry database CAS. Never
   * calls any external system -- this is a pure inbound report, whether it
   * originates from this story's own fixture-injection endpoint (the only
   * real caller today) or a future connector-reported observation.
   */
  async recordObservation(
    orderId: string,
    organizationId: string,
    venueId: string | undefined,
    rawPayload: unknown,
    sourceKind: PaymentObservationSourceKind,
    evidenceTier: IdealposEvidenceTier,
    handlerVersion: number | null = null,
  ): Promise<RecordObservationResult> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
      select: { id: true, venueId: true, totalCents: true, venue: { select: { currency: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const parsed = parsePaymentObservationEvent(rawPayload);
    if (!parsed.ok) {
      throw new BadRequestException(parsed.malformedReason);
    }
    const r = parsed.result;

    const fingerprintFields = {
      state: r.state,
      nativeReference: r.nativeReference,
      amountCents: r.amountCents,
      currency: r.currency,
      tenderMethod: r.tenderMethod,
      nativeTimestamp: r.nativeTimestamp?.toISOString() ?? null,
    };
    const fingerprint = fingerprintOf(fingerprintFields);

    // Step 1: durably record the raw fact FIRST, before any projection
    // side effect -- mirrors the connector handler's own persist-before-
    // side-effect discipline (Story 15-5), applied here to "before
    // updating the projected order state" rather than "before an HTTP
    // call", since this service has no external call to make.
    let event;
    try {
      event = await this.prisma.paymentObservationEvent.create({
        data: {
          orderId: order.id,
          venueId: order.venueId,
          observationId: r.observationId,
          schemaVersion: r.schemaVersion,
          sourceKind,
          state: r.state,
          nativeReference: r.nativeReference,
          amountCents: r.amountCents,
          currency: r.currency,
          tenderMethod: r.tenderMethod,
          nativeTimestamp: r.nativeTimestamp,
          evidenceTier,
          payloadFingerprint: fingerprint,
          handlerVersion,
          sanitizedReason: r.sanitizedReason,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.paymentObservationEvent.findUniqueOrThrow({
          where: { orderId_observationId: { orderId: order.id, observationId: r.observationId } },
        });
        if (existing.payloadFingerprint !== fingerprint) {
          // A genuinely different order could also reuse an observationId
          // that collides only by coincidence of caller behaviour -- the
          // fingerprint (not just the id) is the actual substitution guard.
          throw new ConflictException(
            `observationId ${r.observationId} was already recorded for this order with a different payload -- refusing to reprocess`,
          );
        }
        return { outcome: 'duplicate', eventId: existing.id };
      }
      throw err;
    }

    // Step 2: apply to the projection.
    const applied = await this.applyToProjection(
      order.id,
      order.venueId,
      order.totalCents,
      order.venue.currency,
      event,
    );
    return { outcome: applied ? 'applied' : 'conflict', eventId: event.id };
  }

  private async applyToProjection(
    orderId: string,
    venueId: string,
    provisionalPayableCents: number,
    venueCurrency: string,
    event: {
      id: string;
      observationId: string;
      state: PaymentObservationState;
      nativeReference: string | null;
      amountCents: number | null;
      currency: string | null;
      tenderMethod: string | null;
      nativeTimestamp: Date | null;
    },
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      let proj = await this.prisma.paymentObservation.findUnique({ where: { orderId } });
      if (!proj) {
        try {
          proj = await this.prisma.paymentObservation.create({
            data: { orderId, venueId, provisionalPayableCents },
          });
        } catch (err: unknown) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            proj = await this.prisma.paymentObservation.findUniqueOrThrow({ where: { orderId } });
          } else {
            throw err;
          }
        }
      }

      const currentState = proj.state;
      const allowed: boolean =
        event.state === currentState ||
        PAYMENT_OBSERVATION_ALLOWED_TRANSITIONS[currentState].includes(event.state);
      const nextState: PaymentObservationState = allowed ? event.state : 'conflict';

      const data: Prisma.PaymentObservationUpdateManyMutationInput = {
        lastObservedAt: new Date(),
      };
      if (allowed) {
        data.state = nextState;
        data.lastAppliedObservationId = event.observationId;
        if (event.nativeReference !== null) data.nativeReference = event.nativeReference;
        if (event.tenderMethod !== null) data.tenderMethod = event.tenderMethod;
        if (event.nativeTimestamp !== null) data.nativeTimestamp = event.nativeTimestamp;

        if (TERMINAL_MONEY_STATES.has(nextState)) {
          if (event.amountCents === null) {
            data.discrepancyState = PAYMENT_DISCREPANCY_STATE.MISSING_NATIVE_AMOUNT;
            data.discrepancyCents = null;
          } else if (event.currency !== venueCurrency) {
            data.discrepancyState = PAYMENT_DISCREPANCY_STATE.CURRENCY_MISMATCH;
            data.discrepancyCents = null;
            data.nativeAmountCents = event.amountCents;
            data.nativeCurrency = event.currency;
          } else {
            const discrepancyCents = event.amountCents - provisionalPayableCents;
            data.nativeAmountCents = event.amountCents;
            data.nativeCurrency = event.currency;
            data.discrepancyCents = discrepancyCents;
            data.discrepancyState =
              discrepancyCents === 0
                ? PAYMENT_DISCREPANCY_STATE.EXACT_MATCH
                : PAYMENT_DISCREPANCY_STATE.MISMATCH;
          }
        }
      } else {
        data.state = 'conflict';
      }

      const updateResult = await this.prisma.paymentObservation.updateMany({
        where: { id: proj.id, state: currentState },
        data,
      });
      if (updateResult.count === 1) {
        await this.prisma.paymentObservationEvent.update({
          where: { id: event.id },
          data: {
            applied: allowed,
            conflictReason: allowed
              ? null
              : `Transition ${currentState} -> ${event.state} is not permitted`,
          },
        });
        return allowed;
      }
      // Lost the CAS race to a concurrent request for the same order -- retry.
    }
    throw new ConflictException(
      'Could not apply payment observation after repeated concurrent contention -- please retry',
    );
  }

  /**
   * Records an unverified amount observation (e.g. a future heuristic
   * bridge figure analogous to TableDto.Amount) WITHOUT touching `state`,
   * `nativeAmountCents`, or any discrepancy field -- mirrors
   * IdealposOrderReconciliationService.recordUnverifiedTableAmount's own
   * pattern exactly. Never promoted to authoritative by any code path.
   */
  async recordUnverifiedAmount(
    orderId: string,
    organizationId: string,
    amountCents: number,
    source: string,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, venue: { organizationId } },
      select: { id: true, venueId: true, totalCents: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.paymentObservation.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        venueId: order.venueId,
        provisionalPayableCents: order.totalCents,
        unverifiedAmountCents: amountCents,
        unverifiedAmountSource: source,
      },
      update: { unverifiedAmountCents: amountCents, unverifiedAmountSource: source },
    });
  }

  async getForOrder(orderId: string, organizationId: string, venueId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, venue: { organizationId }, ...(venueId ? { venueId } : {}) },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const proj = await this.prisma.paymentObservation.findUnique({ where: { orderId: order.id } });
    if (proj) return proj;

    // No row exists -- the CURRENT, honest default: no payment-observation
    // channel exists yet for any venue (see this module's own doc comment
    // in schema.prisma). Synthesized, never persisted, so a purely-read
    // request never creates a row.
    return {
      id: null,
      orderId: order.id,
      state: 'observation_unsupported' as const,
      provisionalPayableCents: null,
      nativeReference: null,
      nativeAmountCents: null,
      nativeCurrency: null,
      tenderMethod: null,
      nativeTimestamp: null,
      unverifiedAmountCents: null,
      unverifiedAmountSource: null,
      discrepancyCents: null,
      discrepancyState: PAYMENT_DISCREPANCY_STATE.PENDING_AUTHORITATIVE_TOTAL,
      lastObservedAt: null,
      reviewedAt: null,
      reviewedByStaffId: null,
      reviewNote: null,
    };
  }

  async listForVenue(venueId: string, organizationId: string, state?: string) {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, organizationId },
      select: { id: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');

    return this.prisma.paymentObservation.findMany({
      where: { venueId, ...(state ? { state: state as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            serviceMode: true,
            takeawayReference: true,
            tableId: true,
            tableNumber: true,
          },
        },
      },
    });
  }

  /**
   * Staff-attested review of a `conflict` row. Never itself changes
   * `state`, `nativeAmountCents`, or any other evidence field -- records
   * only that a human reviewed it, and who. Idempotent: reviewing an
   * already-reviewed row returns without a second mutation or a second
   * audit event, mirroring IdealposOrderReconciliationService.manualReconcile.
   */
  async acknowledge(
    paymentObservationId: string,
    organizationId: string,
    venueId: string | undefined,
    staffId: string,
    note: string,
  ): Promise<{ acknowledged: boolean }> {
    const record = await this.prisma.paymentObservation.findFirst({
      where: {
        id: paymentObservationId,
        venue: { organizationId },
        ...(venueId ? { venueId } : {}),
      },
    });
    if (!record) return { acknowledged: false };
    if (record.reviewedAt) return { acknowledged: true };

    const updated = await this.prisma.paymentObservation.updateMany({
      where: { id: paymentObservationId, reviewedAt: null },
      data: { reviewedAt: new Date(), reviewedByStaffId: staffId, reviewNote: note.slice(0, 500) },
    });
    return { acknowledged: updated.count > 0 };
  }
}

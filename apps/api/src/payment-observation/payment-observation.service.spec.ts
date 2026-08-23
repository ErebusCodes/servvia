/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PaymentObservationService } from './payment-observation.service';
import { PAYMENT_OBSERVATION_SCHEMA_VERSION } from './payment-observation.constants';

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

describe('PaymentObservationService', () => {
  let prisma: any;
  let service: PaymentObservationService;

  const order = {
    id: 'order-1',
    venueId: 'venue-1',
    totalCents: 7000,
    venue: { currency: 'NZD' },
  };

  beforeEach(() => {
    prisma = {
      order: { findFirst: jest.fn() },
      paymentObservationEvent: {
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      paymentObservation: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        findFirst: jest.fn(),
      },
      venue: { findFirst: jest.fn() },
    };
    service = new PaymentObservationService(prisma);
  });

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: PAYMENT_OBSERVATION_SCHEMA_VERSION,
      observationId: 'obs-1',
      state: 'paid',
      amountCents: 7000,
      currency: 'NZD',
      nativeReference: 'IPS-1',
      tenderMethod: 'eftpos',
      ...overrides,
    };
  }

  describe('order/payload validation', () => {
    it('throws NotFoundException when the order does not belong to the caller scope', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(
        service.recordObservation(
          'order-x',
          'org-1',
          'venue-1',
          validPayload(),
          'fixture',
          'fixture_contract',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a malformed payload and never touches the event/projection tables', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      await expect(
        service.recordObservation(
          'order-1',
          'org-1',
          undefined,
          { not: 'valid' },
          'fixture',
          'fixture_contract',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.paymentObservationEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('state machine', () => {
    it('initial state (no row yet) transitions not_observed -> pending', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'pending',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue(null);
      prisma.paymentObservation.create.mockResolvedValue({ id: 'proj-1', state: 'not_observed' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          state: 'pending',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );

      expect(result.outcome).toBe('applied');
      const updateCall = prisma.paymentObservation.updateMany.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'proj-1', state: 'not_observed' });
      expect(updateCall.data.state).toBe('pending');
    });

    it('a genuinely authoritative paid observation is applied and computes exact_match', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'paid',
        nativeReference: 'IPS-1',
        amountCents: 7000,
        currency: 'NZD',
        tenderMethod: 'eftpos',
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'pending' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({ state: 'paid' }),
        'fixture',
        'fixture_contract',
      );

      expect(result.outcome).toBe('applied');
      const updateCall = prisma.paymentObservation.updateMany.mock.calls[0][0];
      expect(updateCall.data.state).toBe('paid');
      expect(updateCall.data.discrepancyState).toBe('exact_match');
      expect(updateCall.data.discrepancyCents).toBe(0);
    });

    it('a mismatched authoritative amount is applied as paid but flagged as a mismatch, never silently corrected', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'paid',
        nativeReference: 'IPS-1',
        amountCents: 7500,
        currency: 'NZD',
        tenderMethod: 'eftpos',
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'pending' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({ state: 'paid', amountCents: 7500 }),
        'fixture',
        'fixture_contract',
      );

      expect(result.outcome).toBe('applied'); // state DID transition -- the mismatch is a reconciliation flag, not a rejection
      const updateCall = prisma.paymentObservation.updateMany.mock.calls[0][0];
      expect(updateCall.data.discrepancyState).toBe('mismatch');
      expect(updateCall.data.discrepancyCents).toBe(500);
    });

    it('an unsupported adapter observation is accepted as a valid initial state', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'observation_unsupported',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue(null);
      prisma.paymentObservation.create.mockResolvedValue({ id: 'proj-1', state: 'not_observed' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          state: 'observation_unsupported',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('applied');
    });

    it('declined is accepted from pending', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'declined',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'pending' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          state: 'declined',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('applied');
    });

    it('uncertain is accepted from pending', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-1',
        state: 'uncertain',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'pending' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          state: 'uncertain',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('applied');
    });

    it('a conflict is raised, never silently overwritten, when a "declined" event arrives against an already-"paid" projection', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-2',
        state: 'declined',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'paid' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          observationId: 'obs-2',
          state: 'declined',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );

      expect(result.outcome).toBe('conflict');
      const updateCall = prisma.paymentObservation.updateMany.mock.calls[0][0];
      expect(updateCall.data.state).toBe('conflict');
      const eventUpdateCall = prisma.paymentObservationEvent.update.mock.calls[0][0];
      expect(eventUpdateCall.data.applied).toBe(false);
      expect(eventUpdateCall.data.conflictReason).toMatch(/paid -> declined/);
    });

    it('forbidden regression: a "pending" event arriving after "paid" is rejected as a conflict, never regressing the terminal state', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-2',
        state: 'pending',
        nativeReference: null,
        amountCents: null,
        currency: null,
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'paid' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({
          observationId: 'obs-2',
          state: 'pending',
          amountCents: undefined,
          currency: undefined,
          nativeReference: undefined,
        }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('conflict');
    });

    it('paid -> refunded is a permitted forward transition', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-2',
        state: 'refunded',
        nativeReference: 'IPS-1',
        amountCents: 7000,
        currency: 'NZD',
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'paid' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({ observationId: 'obs-2', state: 'refunded' }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('applied');
    });

    it('never leaves an already-declined row, a later contradictory "paid" is a conflict', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.paymentObservationEvent.create.mockResolvedValue({
        id: 'evt-1',
        observationId: 'obs-2',
        state: 'paid',
        nativeReference: 'IPS-1',
        amountCents: 7000,
        currency: 'NZD',
        tenderMethod: null,
        nativeTimestamp: null,
      });
      prisma.paymentObservation.findUnique.mockResolvedValue({ id: 'proj-1', state: 'declined' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        validPayload({ observationId: 'obs-2', state: 'paid' }),
        'fixture',
        'fixture_contract',
      );
      expect(result.outcome).toBe('conflict');
    });
  });

  describe('duplicate / substitution guard', () => {
    it('a duplicate observationId with an IDENTICAL payload is a safe no-op', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      const fingerprintMatchingPayload = validPayload();
      prisma.paymentObservationEvent.create.mockRejectedValue(p2002(['orderId', 'observationId']));
      // Simulate the existing row having the identical fingerprint by
      // recomputing it the same way the service does -- rather than
      // duplicating the hashing logic here, just assert the service
      // treats a matching fingerprint as a duplicate by constructing the
      // existing row via a first, successful call's own persisted shape.
      // We approximate by calling the service twice against the same mock
      // sequence: first call succeeds (create), second call collides.
      prisma.paymentObservation.findUnique.mockResolvedValue(null);
      prisma.paymentObservation.create.mockResolvedValue({ id: 'proj-1', state: 'not_observed' });
      prisma.paymentObservation.updateMany.mockResolvedValue({ count: 1 });

      // First call establishes the "existing" event the second call will collide with.
      prisma.paymentObservationEvent.create.mockResolvedValueOnce({
        id: 'evt-1',
        observationId: 'obs-1',
        state: fingerprintMatchingPayload.state,
        nativeReference: fingerprintMatchingPayload.nativeReference,
        amountCents: fingerprintMatchingPayload.amountCents,
        currency: fingerprintMatchingPayload.currency,
        tenderMethod: fingerprintMatchingPayload.tenderMethod,
        nativeTimestamp: null,
        payloadFingerprint: 'irrelevant-for-this-mocked-path',
      });
      const first = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        fingerprintMatchingPayload,
        'fixture',
        'fixture_contract',
      );
      expect(first.outcome).toBe('applied');

      // Second call: create() now rejects with P2002 (duplicate key); the
      // service must fetch the existing row and, since the fingerprints it
      // computes internally for the identical payload are equal, return a
      // safe no-op rather than throwing or reapplying.
      prisma.paymentObservationEvent.create.mockRejectedValueOnce(
        p2002(['orderId', 'observationId']),
      );
      prisma.paymentObservationEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-1',
        payloadFingerprint: computeExpectedFingerprint(fingerprintMatchingPayload),
      });

      const second = await service.recordObservation(
        'order-1',
        'org-1',
        undefined,
        fingerprintMatchingPayload,
        'fixture',
        'fixture_contract',
      );
      expect(second.outcome).toBe('duplicate');
      expect(prisma.paymentObservation.updateMany).toHaveBeenCalledTimes(1); // not called again for the duplicate
    });

    it('a duplicate observationId with a DIFFERENT payload fails closed with ConflictException', async () => {
      prisma.order.findFirst.mockResolvedValue(order);
      const payload = validPayload({ observationId: 'obs-dup' });
      prisma.paymentObservationEvent.create.mockRejectedValue(p2002(['orderId', 'observationId']));
      prisma.paymentObservationEvent.findUniqueOrThrow.mockResolvedValue({
        id: 'evt-existing',
        payloadFingerprint: 'a-completely-different-fingerprint',
      });

      await expect(
        service.recordObservation(
          'order-1',
          'org-1',
          undefined,
          payload,
          'fixture',
          'fixture_contract',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('acknowledge', () => {
    it('is idempotent -- re-acknowledging an already-reviewed row does not re-mutate or re-audit', async () => {
      prisma.paymentObservation.findFirst.mockResolvedValue({
        id: 'proj-1',
        reviewedAt: new Date('2026-01-01'),
      });
      const result = await service.acknowledge(
        'proj-1',
        'org-1',
        undefined,
        'staff-1',
        'already reviewed',
      );
      expect(result.acknowledged).toBe(true);
      expect(prisma.paymentObservation.updateMany).not.toHaveBeenCalled();
    });

    it('returns acknowledged:false for a record outside the caller scope', async () => {
      prisma.paymentObservation.findFirst.mockResolvedValue(null);
      const result = await service.acknowledge('proj-x', 'org-1', undefined, 'staff-1', 'note');
      expect(result.acknowledged).toBe(false);
    });
  });
});

// Mirrors the service's own private fingerprint function exactly, for the
// "identical payload replay" test above -- kept in sync deliberately (not
// imported, since the service does not export it) so a future change to
// the hashing scheme fails this test loudly rather than silently.
function computeExpectedFingerprint(input: {
  state: string;
  nativeReference?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  tenderMethod?: string | null;
}): string {
  const fields = {
    state: input.state,
    nativeReference: input.nativeReference ?? null,
    amountCents: input.amountCents ?? null,
    currency: input.currency ?? null,
    tenderMethod: input.tenderMethod ?? null,
    nativeTimestamp: null,
  };
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

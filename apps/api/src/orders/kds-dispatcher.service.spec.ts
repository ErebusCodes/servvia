import { KdsDispatcherService } from './kds-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersGateway } from './orders.gateway';

function configWith(overrides: Record<string, number> = {}) {
  return {
    get: (key: string, fallback?: number) => overrides[key] ?? fallback,
  };
}

describe('KdsDispatcherService', () => {
  let mockPrisma: {
    kdsDeliveryRecord: { findMany: jest.Mock; updateMany: jest.Mock };
    order: { findUnique: jest.Mock };
  };
  let mockGateway: { sendOrderUpdate: jest.Mock };
  let service: KdsDispatcherService;

  beforeEach(() => {
    mockPrisma = {
      kdsDeliveryRecord: { findMany: jest.fn(), updateMany: jest.fn() },
      order: { findUnique: jest.fn() },
    };
    mockGateway = { sendOrderUpdate: jest.fn() };
    service = new KdsDispatcherService(
      mockPrisma as unknown as PrismaService,
      mockGateway as unknown as OrdersGateway,
      configWith() as any,
    );
  });

  it('fails closed at construction if the claim lease is not strictly less than the safety-net window', () => {
    expect(
      () =>
        new KdsDispatcherService(
          mockPrisma as unknown as PrismaService,
          mockGateway as unknown as OrdersGateway,
          configWith({
            KDS_DISPATCH_CLAIM_LEASE_MS: 60_000,
            KDS_DISPATCH_SAFETY_NET_MS: 60_000,
          }) as any,
        ),
    ).toThrow(/must be strictly less than/);
  });

  describe('sweepDispatch', () => {
    it('claims a queued candidate, pushes over the gateway, and marks it pushed', async () => {
      mockPrisma.kdsDeliveryRecord.findMany.mockResolvedValue([
        {
          id: 'kds-1',
          venueId: 'venue-1',
          orderId: 'ORD-1',
          pushAttemptCount: 0,
          order: { id: 'ORD-1', status: 'confirmed' },
        },
      ]);
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 }); // claim
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ORD-1', items: [] });
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 }); // confirm pushed

      const result = await service.sweepDispatch();

      expect(mockGateway.sendOrderUpdate).toHaveBeenCalledWith('venue-1', {
        id: 'ORD-1',
        items: [],
      });
      expect(result).toEqual({
        eligible: 1,
        claimed: 1,
        pushed: 1,
        pushFailed: 0,
        markedCancelled: 0,
        exhausted: 0,
      });
    });

    it('marks a cancelled order live and never attempts a claim/push for it', async () => {
      mockPrisma.kdsDeliveryRecord.findMany.mockResolvedValue([
        {
          id: 'kds-1',
          venueId: 'venue-1',
          orderId: 'ORD-1',
          pushAttemptCount: 0,
          order: { id: 'ORD-1', status: 'cancelled' },
        },
      ]);
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.sweepDispatch();

      expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
      expect(mockPrisma.kdsDeliveryRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'kds-1', status: { in: ['queued', 'pushed'] } },
        data: { status: 'cancelled' },
      });
      expect(result.markedCancelled).toBe(1);
      expect(result.claimed).toBe(0);
    });

    it('marks a record exhausted once its push-attempt budget is met, never claiming it', async () => {
      mockPrisma.kdsDeliveryRecord.findMany.mockResolvedValue([
        {
          id: 'kds-1',
          venueId: 'venue-1',
          orderId: 'ORD-1',
          pushAttemptCount: 5,
          order: { id: 'ORD-1', status: 'confirmed' },
        },
      ]);
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.sweepDispatch();

      expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
      expect(result.exhausted).toBe(1);
      expect(result.claimed).toBe(0);
    });

    it('a lost claim race (another sweeper won) is a safe no-op — no push, no error', async () => {
      mockPrisma.kdsDeliveryRecord.findMany.mockResolvedValue([
        {
          id: 'kds-1',
          venueId: 'venue-1',
          orderId: 'ORD-1',
          pushAttemptCount: 0,
          order: { id: 'ORD-1', status: 'confirmed' },
        },
      ]);
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 0 }); // claim lost

      const result = await service.sweepDispatch();

      expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
      expect(result.claimed).toBe(0);
      expect(result.pushed).toBe(0);
    });

    it('a failure fetching the order for push is recorded and counted, never thrown out of the sweep', async () => {
      mockPrisma.kdsDeliveryRecord.findMany.mockResolvedValue([
        {
          id: 'kds-1',
          venueId: 'venue-1',
          orderId: 'ORD-1',
          pushAttemptCount: 0,
          order: { id: 'ORD-1', status: 'confirmed' },
        },
      ]);
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 }); // claim
      mockPrisma.order.findUnique.mockRejectedValue(new Error('db blip'));
      mockPrisma.kdsDeliveryRecord.updateMany.mockResolvedValueOnce({ count: 1 }); // error write

      const result = await service.sweepDispatch();

      expect(result.pushFailed).toBe(1);
      expect(result.pushed).toBe(0);
    });
  });
});

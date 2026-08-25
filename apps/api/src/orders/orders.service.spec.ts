import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersGateway } from './orders.gateway';
import { AuditLogService } from '../audit/audit.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateStaffOrderDto } from './dto/create-staff-order.dto';
import { OrderSource, OrderStatus, POSSyncStatus, ServiceMode, StaffRole } from '@prisma/client';

const mockPrisma: any = {
  venue: { findUnique: jest.fn() },
  table: { findFirst: jest.fn() },
  staff: { upsert: jest.fn() },
  menuItem: { findFirst: jest.fn() },
  menuItemVenueOverride: { findUnique: jest.fn() },
  order: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  orderItem: { create: jest.fn() },
  pOSSyncRecord: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  printer: { findMany: jest.fn() },
  printerJob: { create: jest.fn() },
  kdsDeliveryRecord: { create: jest.fn() },
  table19ValidationRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  // Used for: (1) persistOrder's own-table row lock (tx.$queryRaw, return
  // value unused); (2) minting the ORD-6XXXXX order id from Order_ORD6_seq
  // (matches this file's pre-existing 'ORD-600001' expectations, which
  // predate the sequence-based fix and are kept as-is rather than
  // renumbered); (3) minting a takeaway reference from
  // TakeawayReference_seq (destructured — no test asserts a specific
  // reference string, so the same default value is harmless there too).
  $queryRaw: jest.fn().mockResolvedValue([{ nextval: 600001n }]),
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

function p2002(target: string | string[]): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

const mockGateway = {
  sendOrderUpdate: jest.fn(),
};

const mockAuditLog = {
  logAuthEvent: jest.fn(),
};

const mockConnectorCommandService = {
  cancel: jest.fn(),
};

const orgId = 'org-uuid';
const venueId = 'venue-uuid';

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrdersGateway, useValue: mockGateway },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: ConnectorCommandService, useValue: mockConnectorCommandService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
    // order.findUnique backs three different lookups (idempotency-key
    // replay check, payment-reference-reuse check, and broadcastOrder) —
    // clearAllMocks() does not clear queued mockResolvedValueOnce/implementation
    // state, so every test must explicitly configure exactly the calls it
    // expects rather than relying on leftover state from a previous test.
    mockPrisma.order.findUnique.mockReset();
    mockPrisma.staff.upsert.mockResolvedValue({
      id: 'kiosk-system-staff-uuid',
      email: `kiosk-system+${orgId}@verdura.internal`,
    });
  });

  describe('create', () => {
    const createDto: CreateOrderDto = {
      venueId,
      stripePaymentIntentId: 'pi_test123',
      idempotencyKey: 'idem-key-1',
      items: [
        {
          menuItemId: 'item-uuid',
          quantity: 2,
          selectedModifiers: [{ name: 'Extra Sauce', priceDeltaCents: 50 }],
          notes: 'Make it hot',
        },
      ],
      notes: 'Table 5 Order',
    };

    const mockVenue = {
      id: venueId,
      organizationId: orgId,
      posAdapterType: 'none',
      // DL-072 supported tax profile — required for computeTotals's
      // fail-closed isSupportedTaxProfile check (2026-08-20 GST fix).
      currency: 'NZD',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
    };
    const mockMenuItem = {
      id: 'item-uuid',
      title: 'Burger',
      priceCents: 1000,
      isAvailable: true,
      category: { name: 'Mains' },
    };

    /** No existing idempotency-key row, no payment-reference conflict — the two order.findUnique calls before persistOrder. */
    function mockNewOrderPreChecks() {
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // rejectIfPaymentReferenceReused
    }

    it('creates an order successfully with correct total and tax', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockNewOrderPreChecks();

      const createdOrder = {
        id: 'order-uuid',
        venueId,
        status: OrderStatus.confirmed,
        subtotalCents: 2100, // (1000 + 50) * 2 = 2100
        taxCents: 274, // contained GST, round(2100 * 3 / 23) = 274 (DL-072, not additive)
        totalCents: 2100, // GST-inclusive: total == subtotal, GST not added on top
        submittedAt: new Date(),
      };

      mockPrisma.order.create.mockResolvedValue(createdOrder);
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] }); // persistOrder's own items-included re-fetch
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] }); // broadcastOrder

      const result = await service.create(createDto);

      expect(mockPrisma.venue.findUnique).toHaveBeenCalledWith({ where: { id: venueId } });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey: 'idem-key-1',
            paymentProviderTransactionId: 'pi_test123',
          }),
        }),
      );
      expect(result).toEqual({ ...createdOrder, items: [] });
      expect(mockGateway.sendOrderUpdate).toHaveBeenCalledWith(venueId, expect.any(Object));
      expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_ORDER' }),
      );
    });

    it('Story 9-1: a non-none posAdapterType venue creates a not_synced POSSyncRecord, never a fabricated status', async () => {
      const apiAdapterVenue = { ...mockVenue, posAdapterType: 'api' };
      mockPrisma.venue.findUnique.mockResolvedValue(apiAdapterVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockNewOrderPreChecks();

      const createdOrder = {
        id: 'order-uuid',
        venueId,
        status: OrderStatus.confirmed,
        subtotalCents: 2100,
        taxCents: 274,
        totalCents: 2100,
        submittedAt: new Date(),
      };
      mockPrisma.order.create.mockResolvedValue(createdOrder);
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] });

      await service.create(createDto);

      // The `posSyncStatus` set directly on the Order row must match the
      // dedicated `not_synced`-vs-`not_applicable` branch keyed on adapter
      // type — never a value implying sync already happened.
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ posSyncStatus: 'not_synced' }),
        }),
      );
      // Integration-branch note: main's dirty-tree IdealposOrderReconciliationService
      // lineage (reconciliationState/provisional*Cents columns) was excluded
      // per DL-094 — this integration branch's chosen IdealposOrderDispatcherService
      // (apps/api/src/pos-sync/idealpos-order-dispatcher.service.ts) claims
      // eligible `not_synced` rows directly via its own sweepDispatch(), so
      // persistOrder writes no additional reconciliation-specific signal here.
      expect(mockPrisma.pOSSyncRecord.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-uuid',
          venueId,
          adapterType: 'api',
          status: 'not_synced',
          attemptCount: 0,
        },
      });
    });

    it('a venue on the real IdealPOS Bridge (posAdapterType "api") never creates a Verdura PrinterJob, even with active printers configured — IdealPOS owns kitchen-ticket printing for this order, and creating both would print two physical tickets', async () => {
      const apiAdapterVenue = { ...mockVenue, posAdapterType: 'api' };
      mockPrisma.venue.findUnique.mockResolvedValue(apiAdapterVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([
        { id: 'printer-1', venueId, isActive: true, protocol: 'raw' },
      ]);
      mockNewOrderPreChecks();

      const createdOrder = {
        id: 'order-uuid',
        venueId,
        status: OrderStatus.confirmed,
        subtotalCents: 2100,
        taxCents: 274,
        totalCents: 2100,
        submittedAt: new Date(),
      };
      mockPrisma.order.create.mockResolvedValue(createdOrder);
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] });

      await service.create(createDto);

      expect(mockPrisma.printer.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
    });

    it('applies venue overrides for price and availability', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);

      // Override price to 1200 cents
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue({
        priceCents: 1200,
        isAvailable: true,
      });
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockNewOrderPreChecks();

      const createdOrder = {
        id: 'order-uuid',
        venueId,
        status: OrderStatus.confirmed,
        subtotalCents: 2500, // (1200 + 50) * 2 = 2500
        taxCents: 326, // contained GST, round(2500 * 3 / 23) = 326
        totalCents: 2500, // GST-inclusive: total == subtotal
        submittedAt: new Date(),
      };

      mockPrisma.order.create.mockResolvedValue(createdOrder);
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] });

      const result = await service.create(createDto);

      expect(result.subtotalCents).toBe(2500);
      expect(result.totalCents).toBe(2500);
    });

    it('throws ConflictException if item is unavailable in override', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue({
        priceCents: 1000,
        isAvailable: false,
      });
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if venue not found', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if table already has an active order', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber: '12',
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue({ id: 'existing-active-order' });
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey

      const createDtoWithTable = {
        ...createDto,
        tableId: 'table-uuid',
      };

      await expect(service.create(createDtoWithTable)).rejects.toThrow(ConflictException);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    describe('idempotency and payment-reference uniqueness (Story 6-1)', () => {
      function mockHappyPathResolution() {
        mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
        mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
        mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
        mockPrisma.printer.findMany.mockResolvedValue([]);
      }

      // mockMenuItem has no modifierGroups catalog, so resolveModifiers
      // (non-strict/kiosk path) forces every submitted modifier's
      // priceDeltaCents to 0 (see OrdersService.resolveModifiers) —
      // unitPriceCents is base price only (1000), not 1000+50. This
      // fixture must match that real computed snapshot, not the
      // client-submitted (and ignored) modifier price. The persisted
      // shape (Story 15-3) is always {modifierGroupId, modifierGroupName,
      // optionId, optionName, priceDeltaCents} — the legacy/kiosk path
      // just leaves the id/group fields null.
      const existingOrderRow = {
        id: 'order-uuid',
        venueId,
        tableId: null,
        tableNumber: null,
        source: OrderSource.kiosk,
        status: OrderStatus.confirmed,
        subtotalCents: 2000,
        taxCents: 261,
        totalCents: 2000,
        submittedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            orderId: 'order-uuid',
            menuItemId: 'item-uuid',
            quantity: 2,
            unitPriceCents: 1000,
            lineTotalCents: 2000,
            selectedModifiers: [
              {
                modifierGroupId: null,
                modifierGroupName: null,
                optionId: null,
                optionName: 'Extra Sauce',
                priceDeltaCents: 0,
              },
            ],
            menuItemTitle: 'Burger',
            menuItemCategory: 'Mains',
            notes: 'Make it hot',
          },
        ],
      };

      it('an exact retry (same key, same server-computed request) returns the original order and creates nothing new', async () => {
        mockHappyPathResolution();
        mockPrisma.order.findUnique.mockResolvedValueOnce(existingOrderRow); // findExistingByIdempotencyKey — matches

        const result = await service.create(createDto);

        expect(result).toEqual(existingOrderRow);
        expect(mockPrisma.order.create).not.toHaveBeenCalled();
        expect(mockPrisma.orderItem.create).not.toHaveBeenCalled();
        expect(mockPrisma.pOSSyncRecord.create).not.toHaveBeenCalled();
        expect(mockPrisma.printerJob.create).not.toHaveBeenCalled();
        expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
        expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'ORDER_IDEMPOTENT_REPLAY', resourceId: 'order-uuid' }),
        );
      });

      it('the same idempotency key with a materially different request is rejected without mutating the original', async () => {
        mockHappyPathResolution();
        // Same key, but this request resolves to a different quantity (3, not 2) —
        // the server-computed snapshot will not match existingOrderRow's.
        mockPrisma.order.findUnique.mockResolvedValueOnce(existingOrderRow);

        const differentPayload: CreateOrderDto = {
          ...createDto,
          items: [{ ...createDto.items[0], quantity: 3 }],
        };

        await expect(service.create(differentPayload)).rejects.toThrow(ConflictException);
        expect(mockPrisma.order.create).not.toHaveBeenCalled();
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
        expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'ORDER_IDEMPOTENCY_CONFLICT',
            resourceId: 'order-uuid',
          }),
        );
      });

      it('reusing a captured PaymentIntent under a new idempotency key is rejected before persistOrder or Stripe verification', async () => {
        mockHappyPathResolution();
        mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey — new key
        mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'other-order-uuid' }); // rejectIfPaymentReferenceReused — conflict

        await expect(
          service.create({ ...createDto, idempotencyKey: 'a-brand-new-key' }),
        ).rejects.toThrow(ConflictException);
        expect(mockPrisma.order.create).not.toHaveBeenCalled();
        expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'ORDER_PAYMENT_REFERENCE_REUSE_REJECTED',
            resourceId: 'other-order-uuid',
          }),
        );
      });

      it("a concurrent duplicate submission that loses the database race is resolved deterministically to the winner's order", async () => {
        mockHappyPathResolution();
        mockNewOrderPreChecks(); // this caller sees no existing row and no reference conflict — it still loses the DB race
        mockPrisma.order.create.mockRejectedValueOnce(p2002(['Order_venueId_idempotencyKey_key']));
        // Recovery re-fetch after losing the race finds the winner's row.
        mockPrisma.order.findUnique.mockResolvedValueOnce(existingOrderRow);

        const result = await service.create(createDto);

        expect(result).toEqual(existingOrderRow);
        expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
        expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'ORDER_IDEMPOTENT_REPLAY', resourceId: 'order-uuid' }),
        );
      });

      it('a database-level race on the payment reference (both pre-checks pass, insert loses) is rejected, not silently duplicated', async () => {
        mockHappyPathResolution();
        mockNewOrderPreChecks();
        mockPrisma.order.create.mockRejectedValueOnce(
          p2002(['Order_paymentProviderTransactionId_key']),
        );

        await expect(service.create(createDto)).rejects.toThrow(ConflictException);
        expect(mockGateway.sendOrderUpdate).not.toHaveBeenCalled();
      });

      it('a generic database error during persistOrder is not swallowed or reinterpreted as a conflict', async () => {
        mockHappyPathResolution();
        mockNewOrderPreChecks();
        mockPrisma.order.create.mockRejectedValueOnce(new Error('connection reset'));

        await expect(service.create(createDto)).rejects.toThrow('connection reset');
      });

      it('scopes the idempotency lookup by venue, not globally', async () => {
        mockHappyPathResolution();
        mockNewOrderPreChecks();
        mockPrisma.order.create.mockResolvedValue(existingOrderRow);
        mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] });

        await service.create(createDto);

        expect(mockPrisma.order.findUnique).toHaveBeenNthCalledWith(1, {
          where: { venueId_idempotencyKey: { venueId, idempotencyKey: 'idem-key-1' } },
          include: { items: true },
        });
      });
    });
  });

  describe('updateStatus', () => {
    const mockOrder = {
      id: 'order-uuid',
      venueId,
      status: OrderStatus.confirmed,
      createdAt: new Date(),
    };

    const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };

    it('successfully transitions from confirmed to preparing', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.preparing,
        preparingAt: new Date(),
      });

      const result = await service.updateStatus(
        'order-uuid',
        orgId,
        { status: OrderStatus.preparing },
        staffActor,
      );

      expect(result.status).toBe(OrderStatus.preparing);
      expect(mockGateway.sendOrderUpdate).toHaveBeenCalled();
    });

    it('throws ConflictException on invalid transition', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.completed,
      });

      await expect(
        service.updateStatus('order-uuid', orgId, { status: OrderStatus.preparing }, staffActor),
      ).rejects.toThrow(ConflictException);
    });

    // Regression coverage for a real defect: cancelling an Order used to
    // only ever write Order.status, leaving its POSSyncRecord/
    // ConnectorCommand free to keep dispatching to IdealposBridge on its own
    // schedule — a "cancelled" order could still reach IdealPOS and print a
    // real native KOT. See attemptCancelPosDispatch in orders.service.ts.
    describe('cancellation stops POS dispatch (or truthfully reports it could not)', () => {
      it('cancels a not_synced POSSyncRecord outright — nothing was ever dispatched', async () => {
        mockPrisma.order.findFirst.mockResolvedValue({
          ...mockOrder,
          posSyncRecord: {
            id: 'sync-1',
            status: POSSyncStatus.not_synced,
            connectorSubmitCommandId: null,
          },
        });
        mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: OrderStatus.cancelled });

        await service.updateStatus(
          'order-uuid',
          orgId,
          { status: OrderStatus.cancelled },
          staffActor,
        );

        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'sync-1', status: POSSyncStatus.not_synced },
          data: { status: POSSyncStatus.cancelled },
        });
        expect(mockConnectorCommandService.cancel).not.toHaveBeenCalled();
        expect(mockPrisma.pOSSyncRecord.update).not.toHaveBeenCalled();
      });

      it('cancels the underlying ConnectorCommand when still queued_for_connector and not yet accepted', async () => {
        mockPrisma.order.findFirst.mockResolvedValue({
          ...mockOrder,
          posSyncRecord: {
            id: 'sync-1',
            status: POSSyncStatus.queued_for_connector,
            connectorSubmitCommandId: 'cmd-1',
          },
        });
        mockConnectorCommandService.cancel.mockResolvedValue(undefined);
        mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: OrderStatus.cancelled });

        await service.updateStatus(
          'order-uuid',
          orgId,
          { status: OrderStatus.cancelled },
          staffActor,
        );

        expect(mockConnectorCommandService.cancel).toHaveBeenCalledWith(
          'cmd-1',
          orgId,
          venueId,
          staffActor.id,
          staffActor.email,
          staffActor.role,
        );
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
          data: { status: POSSyncStatus.cancelled },
        });
        expect(mockPrisma.pOSSyncRecord.update).not.toHaveBeenCalled();
      });

      it('never fabricates a stopped dispatch once the connector already accepted the command — order still cancels, but the record is truthfully warned', async () => {
        mockPrisma.order.findFirst.mockResolvedValue({
          ...mockOrder,
          posSyncRecord: {
            id: 'sync-1',
            status: POSSyncStatus.queued_for_connector,
            connectorSubmitCommandId: 'cmd-1',
          },
        });
        mockConnectorCommandService.cancel.mockRejectedValue(
          new NotFoundException(
            'Command is not currently accepted by this connector installation, or is no longer reportable',
          ),
        );
        mockPrisma.pOSSyncRecord.update.mockResolvedValue({});
        mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: OrderStatus.cancelled });

        const result = await service.updateStatus(
          'order-uuid',
          orgId,
          { status: OrderStatus.cancelled },
          staffActor,
        );

        // The order-level status transition must still succeed (staff needs
        // to be able to record the business fact of cancellation) — but the
        // POSSyncRecord itself is never marked cancelled here (it may still
        // be genuinely in flight / already delivered), and it is never
        // silently left looking untouched either.
        expect(result.status).toBe(OrderStatus.cancelled);
        expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: { status: POSSyncStatus.cancelled } }),
        );
        expect(mockPrisma.pOSSyncRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'sync-1' },
            data: expect.objectContaining({
              errorMessage: expect.stringContaining('could not be stopped'),
            }),
          }),
        );
      });

      it('does not attempt to stop dispatch a second time when an already-cancelled order is re-cancelled', async () => {
        mockPrisma.order.findFirst.mockResolvedValue({
          ...mockOrder,
          status: OrderStatus.cancelled,
          posSyncRecord: {
            id: 'sync-1',
            status: POSSyncStatus.cancelled,
            connectorSubmitCommandId: null,
          },
        });
        mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: OrderStatus.cancelled });

        await service.updateStatus(
          'order-uuid',
          orgId,
          { status: OrderStatus.cancelled },
          staffActor,
        );

        expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
        expect(mockConnectorCommandService.cancel).not.toHaveBeenCalled();
      });
    });
  });

  describe('createStaffOrder (Story 6-1 idempotency)', () => {
    const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };
    const mockVenue = {
      id: venueId,
      organizationId: orgId,
      posAdapterType: 'none',
      // DL-072 supported tax profile — required for computeTotals's
      // fail-closed isSupportedTaxProfile check (2026-08-20 GST fix).
      currency: 'NZD',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
    };
    const mockMenuItem = {
      id: 'item-uuid',
      title: 'Burger',
      priceCents: 1000,
      isAvailable: true,
      category: { name: 'Mains' },
    };
    const staffDto: CreateStaffOrderDto = {
      venueId,
      tableId: 'table-uuid',
      serviceMode: ServiceMode.dine_in,
      idempotencyKey: 'staff-idem-1',
      items: [{ menuItemId: 'item-uuid', quantity: 1 }],
    };

    function mockHappyPathResolution() {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(mockMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber: 'T1',
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue(null); // no active order at this table
    }

    it('creates a staff order carrying the idempotency key and no payment reference', async () => {
      mockHappyPathResolution();
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey

      const createdOrder = {
        id: 'order-uuid',
        venueId,
        tableId: 'table-uuid',
        status: OrderStatus.confirmed,
        subtotalCents: 1000,
        taxCents: 130, // round(1000 * 3 / 23) = 130 (contained GST, DL-072)
        totalCents: 1000,
        submittedAt: new Date(),
      };
      mockPrisma.order.create.mockResolvedValue(createdOrder);
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] }); // persistOrder's own items-included re-fetch
      mockPrisma.order.findUnique.mockResolvedValueOnce({ ...createdOrder, items: [] }); // broadcastOrder

      const result = await service.createStaffOrder(staffDto, orgId, staffActor);

      expect(result).toEqual({ ...createdOrder, items: [] });
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey: 'staff-idem-1',
            paymentProviderTransactionId: null,
          }),
        }),
      );
    });

    it('an exact retry of a staff order returns the original without a second active-table check', async () => {
      mockHappyPathResolution();
      const existingStaffOrder = {
        id: 'order-uuid',
        venueId,
        tableId: 'table-uuid',
        tableNumber: 'T1',
        serviceMode: ServiceMode.dine_in,
        source: OrderSource.staff,
        status: OrderStatus.confirmed,
        subtotalCents: 1000,
        taxCents: 130,
        totalCents: 1000,
        submittedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            menuItemId: 'item-uuid',
            quantity: 1,
            unitPriceCents: 1000,
            selectedModifiers: [],
          },
        ],
      };
      mockPrisma.order.findUnique.mockResolvedValueOnce(existingStaffOrder);

      const result = await service.createStaffOrder(staffDto, orgId, staffActor);

      expect(result).toEqual(existingStaffOrder);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
      // The retry must not be blocked by the active-order-at-this-table
      // guard that its own prior order would otherwise trip.
      expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
    });

    it("a staff request reusing a kiosk order's idempotencyKey is rejected, never silently returned as a matching replay", async () => {
      mockHappyPathResolution();
      // Same venue, same idempotencyKey, and a table/items/total shape that
      // would otherwise satisfy ordersMatchForReplay — the only difference
      // is the persisted order's source. Regression test for the
      // cross-surface collision found in Story 6-1 review.
      const kioskOrderUnderSameKey = {
        id: 'kiosk-order-uuid',
        venueId,
        tableId: 'table-uuid',
        tableNumber: 'T1',
        source: OrderSource.kiosk,
        status: OrderStatus.confirmed,
        subtotalCents: 1000,
        taxCents: 130,
        totalCents: 1000,
        submittedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            menuItemId: 'item-uuid',
            quantity: 1,
            unitPriceCents: 1000,
            selectedModifiers: [],
          },
        ],
      };
      mockPrisma.order.findUnique.mockResolvedValueOnce(kioskOrderUnderSameKey);

      await expect(service.createStaffOrder(staffDto, orgId, staffActor)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
      expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORDER_IDEMPOTENCY_CONFLICT',
          resourceId: 'kiosk-order-uuid',
        }),
      );
    });
  });

  // Story 15-3: strict, ID-based modifier resolution for the staff/tablet
  // order-creation path (createStaffOrder — shared by both
  // /api/admin/orders and /api/tablet/orders). Regression coverage for the
  // exact defect Story 15-4 found and deferred: a tablet-displayed
  // non-zero modifier price silently persisted at $0 because the item had
  // no real modifier catalog to validate against.
  describe('createStaffOrder modifier validation (Story 15-3)', () => {
    const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };
    const mockVenue = {
      id: venueId,
      organizationId: orgId,
      posAdapterType: 'none',
      // DL-072 supported tax profile — required for computeTotals's
      // fail-closed isSupportedTaxProfile check (2026-08-20 GST fix).
      currency: 'NZD',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
    };

    const SAUCE_GROUP_ID = 'group-sauce';
    const GARLIC_OPTION_ID = 'option-garlic';
    const NONE_OPTION_ID = 'option-none';
    const EXTRAS_GROUP_ID = 'group-extras';
    const PITA_OPTION_ID = 'option-pita';
    const CHEESE_OPTION_ID = 'option-cheese';
    const DEACTIVATED_OPTION_ID = 'option-deactivated';

    const mockMenuItemWithModifiers = {
      id: 'item-uuid',
      title: 'Mezze Board',
      priceCents: 7000,
      isAvailable: true,
      category: { name: 'Mains' },
      modifierGroups: [
        {
          id: SAUCE_GROUP_ID,
          name: 'Sauce',
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              id: GARLIC_OPTION_ID,
              name: 'Toum Garlic Paste',
              priceDeltaCents: 50,
              isAvailable: true,
              sortOrder: 0,
            },
            {
              id: NONE_OPTION_ID,
              name: 'No Sauce',
              priceDeltaCents: 0,
              isAvailable: true,
              sortOrder: 1,
            },
          ],
        },
        {
          id: EXTRAS_GROUP_ID,
          name: 'Extras',
          required: false,
          minSelections: 0,
          maxSelections: 1,
          options: [
            {
              id: PITA_OPTION_ID,
              name: 'Extra Pita',
              priceDeltaCents: 150,
              isAvailable: true,
              sortOrder: 0,
            },
            {
              id: CHEESE_OPTION_ID,
              name: 'Extra Cheese',
              priceDeltaCents: 200,
              isAvailable: true,
              sortOrder: 1,
            },
            {
              id: DEACTIVATED_OPTION_ID,
              name: 'Retired Extra',
              priceDeltaCents: 100,
              isAvailable: false,
              sortOrder: 2,
            },
          ],
        },
      ],
    };

    const mockMenuItemNoModifiers = {
      id: 'item-uuid',
      title: 'Falafel Plate',
      priceCents: 1500,
      isAvailable: true,
      category: { name: 'Mains' },
      modifierGroups: [],
    };

    function mockResolution(menuItem: unknown) {
      mockPrisma.venue.findUnique.mockResolvedValue(mockVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(menuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber: 'T1',
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey
    }

    function dtoWith(selectedModifiers: unknown[], extra?: Record<string, unknown>) {
      return {
        venueId,
        tableId: 'table-uuid',
        serviceMode: ServiceMode.dine_in,
        idempotencyKey: 'staff-idem-modifiers-1',
        items: [{ menuItemId: 'item-uuid', quantity: 1, selectedModifiers, ...extra }],
      } as CreateStaffOrderDto;
    }

    it('THE $0.50 DEFECT REGRESSION: a real, authored +$0.50 modifier persists at exactly $0.50, never silently at $0', async () => {
      mockResolution(mockMenuItemWithModifiers);
      mockPrisma.order.create.mockResolvedValue({ id: 'order-uuid' });
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] }); // broadcastOrder

      await service.createStaffOrder(
        dtoWith([{ modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID }]),
        orgId,
        staffActor,
      );

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotalCents: 7050 }), // 7000 base + 50 modifier
        }),
      );
      expect(mockPrisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unitPriceCents: 7050,
            selectedModifiers: [
              {
                modifierGroupId: SAUCE_GROUP_ID,
                modifierGroupName: 'Sauce',
                optionId: GARLIC_OPTION_ID,
                optionName: 'Toum Garlic Paste',
                priceDeltaCents: 50,
              },
            ],
          }),
        }),
      );
    });

    it('accepts and correctly prices a zero-priced modifier (not treated as "no selection")', async () => {
      mockResolution(mockMenuItemWithModifiers);
      mockPrisma.order.create.mockResolvedValue({ id: 'order-uuid' });
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] });

      await service.createStaffOrder(
        dtoWith([{ modifierGroupId: SAUCE_GROUP_ID, optionId: NONE_OPTION_ID }]),
        orgId,
        staffActor,
      );

      expect(mockPrisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unitPriceCents: 7000,
            selectedModifiers: expect.arrayContaining([
              expect.objectContaining({ optionId: NONE_OPTION_ID, priceDeltaCents: 0 }),
            ]),
          }),
        }),
      );
    });

    it('an item with no configured modifier catalog rejects any submitted modifier outright (never silently zeroes it)', async () => {
      mockResolution(mockMenuItemNoModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([{ modifierGroupId: 'whatever', optionId: 'whatever' }]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('This item has no configurable options');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects a missing required group', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(service.createStaffOrder(dtoWith([]), orgId, staffActor)).rejects.toThrow(
        '"Sauce" requires a selection',
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects too many selections for a single-select group', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([
            { modifierGroupId: EXTRAS_GROUP_ID, optionId: PITA_OPTION_ID },
            { modifierGroupId: EXTRAS_GROUP_ID, optionId: CHEESE_OPTION_ID },
            { modifierGroupId: SAUCE_GROUP_ID, optionId: NONE_OPTION_ID },
          ]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('"Extras" allows at most 1 selection');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate option id', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([
            { modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID },
            { modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID },
          ]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('Duplicate modifier option selected');
    });

    it('rejects an option id that belongs to a different group than the one submitted', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([{ modifierGroupId: EXTRAS_GROUP_ID, optionId: GARLIC_OPTION_ID }]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('Unknown modifier option for this item');
    });

    it('rejects an unknown modifier group id', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([{ modifierGroupId: 'not-a-real-group', optionId: GARLIC_OPTION_ID }]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('Unknown modifier group for this item');
    });

    it('rejects an unavailable (deactivated) option with a 409, distinct from "never existed"', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([
            { modifierGroupId: SAUCE_GROUP_ID, optionId: NONE_OPTION_ID },
            { modifierGroupId: EXTRAS_GROUP_ID, optionId: DEACTIVATED_OPTION_ID },
          ]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects the legacy name-based shape on the strict path — IDs are mandatory, names are not identity', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([{ name: 'Toum Garlic Paste', priceDeltaCents: 50 }]),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow('Each selected modifier must specify modifierGroupId and optionId');
    });

    it('a forged client-supplied price on a valid ID-based selection has no effect — price always comes from the catalog', async () => {
      mockResolution(mockMenuItemWithModifiers);
      mockPrisma.order.create.mockResolvedValue({ id: 'order-uuid' });
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] });

      await service.createStaffOrder(
        dtoWith([
          {
            modifierGroupId: SAUCE_GROUP_ID,
            optionId: GARLIC_OPTION_ID,
            priceDeltaCents: 99999, // forged — must be ignored entirely
          },
        ]),
        orgId,
        staffActor,
      );

      expect(mockPrisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitPriceCents: 7050 }), // real catalog price, not the forged one
        }),
      );
    });

    it('fails closed with a 409 STALE_PRICE conflict when the authoritative price differs from what the caller expected — no order is created', async () => {
      mockResolution(mockMenuItemWithModifiers);

      await expect(
        service.createStaffOrder(
          dtoWith([{ modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID }], {
            expectedUnitPriceCents: 6999, // stale — real resolved price is 7050
          }),
          orgId,
          staffActor,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('does not raise a stale-price conflict when expectedUnitPriceCents matches the authoritative price', async () => {
      mockResolution(mockMenuItemWithModifiers);
      mockPrisma.order.create.mockResolvedValue({ id: 'order-uuid' });
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] });

      await service.createStaffOrder(
        dtoWith([{ modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID }], {
          expectedUnitPriceCents: 7050,
        }),
        orgId,
        staffActor,
      );

      expect(mockPrisma.order.create).toHaveBeenCalled();
    });

    it('an idempotent replay after the option price changes returns the original order unchanged, never re-priced', async () => {
      mockResolution({
        ...mockMenuItemWithModifiers,
        modifierGroups: mockMenuItemWithModifiers.modifierGroups.map((g) =>
          g.id === SAUCE_GROUP_ID
            ? {
                ...g,
                options: g.options.map(
                  (o) => (o.id === GARLIC_OPTION_ID ? { ...o, priceDeltaCents: 500 } : o), // price changed since original order
                ),
              }
            : g,
        ),
      });
      const originalOrder = {
        id: 'order-uuid',
        venueId,
        tableId: 'table-uuid',
        tableNumber: 'T1',
        serviceMode: ServiceMode.dine_in,
        source: OrderSource.staff,
        status: OrderStatus.confirmed,
        subtotalCents: 7050,
        taxCents: 920, // round(7050 * 3 / 23) = 920 (contained GST, DL-072)
        totalCents: 7050,
        submittedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            menuItemId: 'item-uuid',
            quantity: 1,
            unitPriceCents: 7050,
            selectedModifiers: [
              {
                modifierGroupId: SAUCE_GROUP_ID,
                modifierGroupName: 'Sauce',
                optionId: GARLIC_OPTION_ID,
                optionName: 'Toum Garlic Paste',
                priceDeltaCents: 50,
              },
            ],
          },
        ],
      };
      mockPrisma.order.findUnique.mockReset();
      mockPrisma.order.findUnique.mockResolvedValueOnce(originalOrder); // findExistingByIdempotencyKey — matches by cart shape

      const result = await service.createStaffOrder(
        dtoWith([{ modifierGroupId: SAUCE_GROUP_ID, optionId: GARLIC_OPTION_ID }]),
        orgId,
        staffActor,
      );

      expect(result).toEqual(originalOrder); // original $50 price, NOT re-priced to the new $500
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });
  });

  // 2026-08-20: computeTotals's additive-15%-GST defect (DL-072) fabricated
  // a false Story 15-5 reconciliation discrepancy even when Idealpos
  // returned the correct payable amount, because the persisted
  // provisional total was ~15% too high. These tests prove the correction
  // directly against OrdersService.create/createStaffOrder's real
  // computeTotals call, independent of the mocked-Prisma
  // POSSyncRecord-fixture-based reconciliation tests (which never
  // exercised computeTotals at all -- see
  // apps/api/test/idealpos-order-reconciliation.integration-spec.ts's new
  // "real order" describe block for the real-Postgres end-to-end proof).
  describe('computeTotals (GST correction, 2026-08-20)', () => {
    const supportedVenue = {
      id: venueId,
      organizationId: orgId,
      posAdapterType: 'none',
      currency: 'NZD',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
    };

    // DL-072's own worked example: a $70.00 GST-inclusive item stays
    // $70.00, never $80.50 (the additive-GST defect). Matches
    // apps/admin-console/src/pages/order-tablet/billing.test.ts's
    // identical worked example for the same $70.00 figure -- the closest
    // parity evidence available without a real shared cross-app package
    // (see computeTotals's own doc comment for why one wasn't built this
    // session).
    const dollarSeventyMenuItem = {
      id: 'item-70',
      title: 'DL-072 worked example item',
      priceCents: 7000,
      isAvailable: true,
      category: { name: 'Mains' },
    };

    function dollarSeventyDto(): CreateOrderDto {
      return {
        venueId,
        stripePaymentIntentId: 'pi_gst_fix_test',
        idempotencyKey: 'idem-gst-fix-1',
        items: [{ menuItemId: 'item-70', quantity: 1 }],
      };
    }

    function mockHappyResolution(venue: unknown, menuItem: unknown) {
      mockPrisma.venue.findUnique.mockResolvedValue(venue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(menuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      // persistOrder's ORD-6xxxxx order-numbering lookup reuses this same
      // mock function — pin it to null so leftover mockResolvedValue state
      // from other tests in this file cannot leak into order-numbering.
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // rejectIfPaymentReferenceReused
      mockPrisma.staff.upsert.mockResolvedValue({
        id: 'kiosk-system-staff-uuid',
        email: `kiosk-system+${orgId}@verdura.internal`,
      });
    }

    it('a $70.00 GST-inclusive item persists totalCents=7000, never 8050 (additive-GST regression guard)', async () => {
      mockHappyResolution(supportedVenue, dollarSeventyMenuItem);
      mockPrisma.order.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] }); // broadcastOrder

      await service.create(dollarSeventyDto());

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotalCents: 7000,
            taxCents: 913, // round(7000 * 3 / 23) = 913, contained GST -- disclosure only
            totalCents: 7000, // NOT 8050 (the pre-fix subtotal + 15% additive defect)
          }),
        }),
      );
    });

    it('rejects (fails closed) rather than guessing a total for an unsupported tax profile (pricesIncludeTax=false)', async () => {
      const exclusiveTaxVenue = { ...supportedVenue, pricesIncludeTax: false };
      mockHappyResolution(exclusiveTaxVenue, dollarSeventyMenuItem);

      await expect(service.create(dollarSeventyDto())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects (fails closed) rather than guessing a total for an unrecognized tax jurisdiction', async () => {
      const unknownJurisdictionVenue = { ...supportedVenue, taxJurisdiction: 'AU_GST' };
      mockHappyResolution(unknownJurisdictionVenue, dollarSeventyMenuItem);

      await expect(service.create(dollarSeventyDto())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects (fails closed) rather than defaulting when tax configuration is entirely missing/undefined', async () => {
      const missingTaxConfigVenue = {
        id: venueId,
        organizationId: orgId,
        posAdapterType: 'none',
        // currency/taxJurisdiction/pricesIncludeTax deliberately absent.
      };
      mockHappyResolution(missingTaxConfigVenue, dollarSeventyMenuItem);

      await expect(service.create(dollarSeventyDto())).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('createStaffOrder (Order Tablet path) applies the identical corrected formula as the kiosk path', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(supportedVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(dollarSeventyMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber: 'T1',
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey
      mockPrisma.order.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] }); // broadcastOrder

      const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };
      await service.createStaffOrder(
        {
          venueId,
          tableId: 'table-uuid',
          serviceMode: ServiceMode.dine_in,
          idempotencyKey: 'idem-gst-fix-staff-1',
          items: [{ menuItemId: 'item-70', quantity: 1 }],
        },
        orgId,
        staffActor,
      );

      // Backend persisted totals must equal what the Order Tablet's own
      // billing.ts displays for the identical $70.00 GST-inclusive cart --
      // the whole point of this fix (see billing.test.ts's own $70.00
      // worked-example assertions).
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotalCents: 7000,
            taxCents: 913,
            totalCents: 7000,
          }),
        }),
      );
    });

    it('an unsupported/changed tax profile does not block a legitimate idempotent replay of an already-accepted order', async () => {
      // Regression test for a bug this fix's own review caught: computeTotals
      // must never run (and therefore cannot throw) on a pure replay path --
      // a venue's tax config becoming invalid/unsupported after an order was
      // already accepted must never block returning that order's original,
      // unchanged result (see computeTotals's call sites, deliberately
      // deferred until after the existingOrder check).
      const laterUnsupportedVenue = { ...supportedVenue, pricesIncludeTax: false };
      mockPrisma.venue.findUnique.mockResolvedValue(laterUnsupportedVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(dollarSeventyMenuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber: 'T1',
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue(null);

      const existingStaffOrder = {
        id: 'order-uuid',
        venueId,
        tableId: 'table-uuid',
        tableNumber: 'T1',
        serviceMode: ServiceMode.dine_in,
        source: OrderSource.staff,
        status: OrderStatus.confirmed,
        subtotalCents: 7000,
        taxCents: 913,
        totalCents: 7000,
        submittedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            menuItemId: 'item-70',
            quantity: 1,
            unitPriceCents: 7000,
            selectedModifiers: [],
          },
        ],
      };
      mockPrisma.order.findUnique.mockResolvedValueOnce(existingStaffOrder); // findExistingByIdempotencyKey — matches

      const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };
      const result = await service.createStaffOrder(
        {
          venueId,
          tableId: 'table-uuid',
          serviceMode: ServiceMode.dine_in,
          idempotencyKey: 'idem-gst-fix-staff-1',
          items: [{ menuItemId: 'item-70', quantity: 1 }],
        },
        orgId,
        staffActor,
      );

      expect(result).toEqual(existingStaffOrder);
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });
  });

  // Table 19 controlled live-validation guard (Order Tablet Idealpos+KDS+KOT
  // orchestration validation). Entirely inert unless both env vars below are
  // set AND NODE_ENV !== 'production' -- these tests explicitly set/restore
  // process.env around each case so no other test in this file is affected.
  describe('Table 19 controlled-validation guard (2026-08-20)', () => {
    const staffActor = { id: 'staff-1', email: 'cook@verdura.co.nz', role: StaffRole.kitchen };
    const guardVenue = {
      id: venueId,
      organizationId: orgId,
      posAdapterType: 'none',
      currency: 'NZD',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
    };
    const menuItem = {
      id: 'item-uuid',
      title: 'Burger',
      priceCents: 1000,
      isAvailable: true,
      category: { name: 'Mains' },
    };

    let originalEnabled: string | undefined;
    let originalVenueId: string | undefined;
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalEnabled = process.env.TABLE19_LIVE_TEST_ENABLED;
      originalVenueId = process.env.TABLE19_LIVE_TEST_VENUE_ID;
      originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      if (originalEnabled === undefined) delete process.env.TABLE19_LIVE_TEST_ENABLED;
      else process.env.TABLE19_LIVE_TEST_ENABLED = originalEnabled;
      if (originalVenueId === undefined) delete process.env.TABLE19_LIVE_TEST_VENUE_ID;
      else process.env.TABLE19_LIVE_TEST_VENUE_ID = originalVenueId;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    });

    function mockResolution(tableNumber: string, table19ValidationRunOpen: unknown = null) {
      mockPrisma.venue.findUnique.mockResolvedValue(guardVenue);
      mockPrisma.menuItem.findFirst.mockResolvedValue(menuItem);
      mockPrisma.menuItemVenueOverride.findUnique.mockResolvedValue(null);
      mockPrisma.printer.findMany.mockResolvedValue([]);
      mockPrisma.table.findFirst.mockResolvedValue({
        id: 'table-uuid',
        tableNumber,
        isActive: true,
      });
      mockPrisma.order.findFirst.mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValueOnce(null); // findExistingByIdempotencyKey
      mockPrisma.table19ValidationRun.findFirst.mockResolvedValue(table19ValidationRunOpen);
      mockPrisma.order.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => data,
      );
      mockPrisma.order.findUnique.mockResolvedValueOnce({ id: 'order-uuid', items: [] }); // broadcastOrder
    }

    function dto(tableId = 'table-uuid') {
      return {
        venueId,
        tableId,
        serviceMode: ServiceMode.dine_in,
        idempotencyKey: `idem-table19-${Math.random()}`,
        items: [{ menuItemId: 'item-uuid', quantity: 1 }],
      };
    }

    it('is fully inert when the env vars are unset -- any table works, no Table19ValidationRun row created', async () => {
      delete process.env.TABLE19_LIVE_TEST_ENABLED;
      delete process.env.TABLE19_LIVE_TEST_VENUE_ID;
      mockResolution('12');

      await service.createStaffOrder(dto(), orgId, staffActor);

      expect(mockPrisma.order.create).toHaveBeenCalled();
      expect(mockPrisma.table19ValidationRun.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.table19ValidationRun.create).not.toHaveBeenCalled();
    });

    it('is inert in NODE_ENV=production even when both env vars are set -- production is hard-disabled regardless of the flag', async () => {
      process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
      process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
      process.env.NODE_ENV = 'production';
      mockResolution('12'); // a non-19 table, which would be rejected if the guard were active

      await service.createStaffOrder(dto(), orgId, staffActor);

      expect(mockPrisma.order.create).toHaveBeenCalled();
      expect(mockPrisma.table19ValidationRun.findFirst).not.toHaveBeenCalled();
    });

    it('rejects every table except the resolved Table 19 when active -- proves the check uses server-resolved data, not client input (CreateStaffOrderDto carries no client tableNumber field at all to tamper with)', async () => {
      process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
      process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
      mockResolution('12');

      await expect(service.createStaffOrder(dto(), orgId, staffActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects when the configured venue does not match the request venue', async () => {
      process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
      process.env.TABLE19_LIVE_TEST_VENUE_ID = 'a-different-venue-id';
      mockResolution('19');

      await expect(service.createStaffOrder(dto(), orgId, staffActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('allows Table 19 once, tags the order, and creates one Table19ValidationRun row', async () => {
      process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
      process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
      mockResolution('19');

      await service.createStaffOrder(dto(), orgId, staffActor);

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notes: expect.stringMatching(/^TABLE19-VALIDATION-/) }),
        }),
      );
      expect(mockPrisma.table19ValidationRun.create).toHaveBeenCalledWith({
        data: { venueId, orderId: 'ORD-600001' },
      });
    });

    it('rejects a second Table 19 submission while an unresolved run is open, before reset', async () => {
      process.env.TABLE19_LIVE_TEST_ENABLED = 'true';
      process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
      mockResolution('19', { id: 'run-1' }); // an open (resetAt: null) run already exists

      await expect(service.createStaffOrder(dto(), orgId, staffActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('reset endpoint clears the gate for a genuinely new submission', async () => {
      mockPrisma.venue.findUnique.mockResolvedValue(guardVenue);
      mockPrisma.table19ValidationRun.findFirst.mockResolvedValue({
        id: 'run-1',
        orderId: 'ORD-600001',
      });

      process.env.TABLE19_LIVE_TEST_VENUE_ID = venueId;
      const result = await service.resetTable19ValidationRun(orgId, staffActor, undefined);

      expect(result).toEqual({ reset: true });
      expect(mockPrisma.table19ValidationRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({ resetByStaffId: staffActor.id }),
      });
      expect(mockAuditLog.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TABLE19_VALIDATION_RESET' }),
      );
    });

    it('reset endpoint fails closed when no venue is configured', async () => {
      delete process.env.TABLE19_LIVE_TEST_VENUE_ID;
      await expect(service.resetTable19ValidationRun(orgId, staffActor, undefined)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

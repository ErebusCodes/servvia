import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandStatus, POSSyncStatus } from '@prisma/client';
import { IdealposOrderDispatcherService } from './idealpos-order-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE } from './idealpos-order-dispatch.constants';

const mockPrisma: any = {
  pOSSyncRecord: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
  },
  menuItem: {
    findMany: jest.fn(),
  },
  connectorCommand: {
    findUnique: jest.fn(),
  },
};

const mockConnectorCommandService: any = {
  createCommand: jest.fn(),
};

const mockOrdersGateway: any = {
  sendOrderUpdate: jest.fn(),
};

function dispatchCandidate(overrides: Record<string, unknown> = {}) {
  return { id: 'sync-1', orderId: 'order-1', venueId: 'venue-1', attemptCount: 0, ...overrides };
}

function mappedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    venueId: 'venue-1',
    notes: null,
    venue: { organizationId: 'org-1' },
    table: { posTableCode: 'T5' },
    items: [
      {
        menuItemId: 'item-1',
        menuItemTitle: 'Mixed Grill',
        quantity: 2,
        selectedModifiers: [],
      },
    ],
    ...overrides,
  };
}

describe('IdealposOrderDispatcherService', () => {
  let service: IdealposOrderDispatcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([]);
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.menuItem.findMany.mockResolvedValue([{ id: 'item-1', posProductCode: 'PLU-4821' }]);
    mockConnectorCommandService.createCommand.mockResolvedValue({ id: 'cmd-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdealposOrderDispatcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConnectorCommandService, useValue: mockConnectorCommandService },
        { provide: OrdersGateway, useValue: mockOrdersGateway },
        { provide: ConfigService, useValue: { get: (_key: string, def?: unknown) => def } },
      ],
    }).compile();

    service = module.get<IdealposOrderDispatcherService>(IdealposOrderDispatcherService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('sweepDispatch', () => {
    it('does nothing when there are no eligible candidates', async () => {
      const result = await service.sweepDispatch();
      expect(result).toEqual({ eligible: 0, dispatched: 0, ineligible: 0, errored: 0 });
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    });

    it('dispatches a fully-mapped, modifier-free order: creates a ConnectorCommand and marks the record queued_for_connector, and broadcasts the new status over the existing OrdersGateway', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      // First call: payload-building fetch. Second call: broadcastPosSyncUpdate's
      // own re-fetch after the winning status CAS, proving the real-time push
      // reflects the post-dispatch state, not a stale pre-dispatch snapshot.
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
      mockPrisma.order.findUnique.mockResolvedValueOnce(
        mappedOrder({ posSyncRecord: { status: POSSyncStatus.queued_for_connector } }),
      );

      const result = await service.sweepDispatch();

      expect(result).toEqual({ eligible: 1, dispatched: 1, ineligible: 0, errored: 0 });
      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
          idempotencyKey: 'idealpos-submit-order:order-1',
          sourceAggregateType: 'Order',
          sourceRecordId: 'order-1',
          correlationId: 'order-1',
          payload: {
            externalOrderId: 'order-1',
            table: 'T5',
            items: [{ productCode: 'PLU-4821', quantity: 2 }],
          },
        }),
      );
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'sync-1', status: POSSyncStatus.not_synced },
        data: expect.objectContaining({
          status: POSSyncStatus.queued_for_connector,
          connectorSubmitCommandId: 'cmd-1',
          nextRetryAt: null,
        }),
      });
      expect(mockOrdersGateway.sendOrderUpdate).toHaveBeenCalledWith(
        'venue-1',
        expect.objectContaining({
          id: 'order-1',
          posSyncRecord: expect.objectContaining({ status: POSSyncStatus.queued_for_connector }),
        }),
      );
    });

    it('a retry attempt (attemptCount > 0) uses an attempt-qualified idempotency key, never the original one', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
        dispatchCandidate({ attemptCount: 2 }),
      ]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());

      await service.sweepDispatch();

      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'idealpos-submit-order:order-1:retry:2',
          // The Bridge-facing identity never changes on retry.
          payload: expect.objectContaining({ externalOrderId: 'order-1' }),
        }),
      );
    });

    it('never sends a modifier-bearing order to the connector — marks it failed with a diagnostic reason instead, and broadcasts the failure', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      const orderWithModifier = mappedOrder({
        items: [
          {
            menuItemId: 'item-1',
            menuItemTitle: 'Mixed Grill',
            quantity: 1,
            selectedModifiers: [{ optionId: 'opt-1' }],
          },
        ],
      });
      mockPrisma.order.findUnique.mockResolvedValueOnce(orderWithModifier);
      // broadcastPosSyncUpdate's own post-failure re-fetch.
      mockPrisma.order.findUnique.mockResolvedValueOnce({
        ...orderWithModifier,
        posSyncRecord: { status: POSSyncStatus.failed },
      });

      const result = await service.sweepDispatch();

      expect(result).toEqual({ eligible: 1, dispatched: 0, ineligible: 1, errored: 0 });
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'sync-1', status: POSSyncStatus.not_synced },
        data: expect.objectContaining({
          status: POSSyncStatus.failed,
          errorMessage: expect.stringContaining('unsupported_modifiers'),
        }),
      });
      // Staff watching the Order Tablet must be pushed the failure too, not
      // just a successful dispatch — never silently stuck showing a stale
      // "submitting" state.
      expect(mockOrdersGateway.sendOrderUpdate).toHaveBeenCalledWith(
        'venue-1',
        expect.objectContaining({
          posSyncRecord: expect.objectContaining({ status: POSSyncStatus.failed }),
        }),
      );
    });

    it('fails closed on an unmapped table — never guesses, never dispatches', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(
        mappedOrder({ table: { posTableCode: null } }),
      );

      const result = await service.sweepDispatch();

      expect(result.ineligible).toBe(1);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: POSSyncStatus.failed,
            errorMessage: expect.stringContaining('unmapped_table'),
          }),
        }),
      );
    });

    it('fails closed on an unmapped item PLU — never falls back to the menuItemId', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
      mockPrisma.menuItem.findMany.mockResolvedValueOnce([{ id: 'item-1', posProductCode: null }]);

      const result = await service.sweepDispatch();

      expect(result.ineligible).toBe(1);
      expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: POSSyncStatus.failed,
            errorMessage: expect.stringContaining('unmapped_item'),
          }),
        }),
      );
    });

    it('an active linked PosProductIdentity wins over a stale legacy posProductCode (Menu Management dual-read precedence)', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
      mockPrisma.menuItem.findMany.mockResolvedValueOnce([
        {
          id: 'item-1',
          posProductCode: '999-STALE',
          posIdentity: { nativeCode: '710', lifecycleStatus: 'active' },
        },
      ]);

      const result = await service.sweepDispatch();

      expect(result.dispatched).toBe(1);
      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            items: [expect.objectContaining({ productCode: '710' })],
          }),
        }),
      );
    });

    it('falls back to the legacy posProductCode only when no PosProductIdentity is linked at all', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
      mockPrisma.menuItem.findMany.mockResolvedValueOnce([
        { id: 'item-1', posProductCode: 'PLU-4821', posIdentity: null },
      ]);

      const result = await service.sweepDispatch();

      expect(result.dispatched).toBe(1);
      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            items: [expect.objectContaining({ productCode: 'PLU-4821' })],
          }),
        }),
      );
    });

    it.each([
      ['source_missing'],
      ['source_inactive'],
      ['hidden'],
      ['unavailable'],
      ['pending_review'],
    ])(
      'fails closed when the linked PosProductIdentity is %s — never falls back to a legacy posProductCode even if one is set',
      async (lifecycleStatus) => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
        mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
        mockPrisma.menuItem.findMany.mockResolvedValueOnce([
          {
            id: 'item-1',
            posProductCode: 'PLU-4821', // deliberately present, must still be ignored
            posIdentity: { nativeCode: '710', lifecycleStatus },
          },
        ]);

        const result = await service.sweepDispatch();

        expect(result.ineligible).toBe(1);
        expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: POSSyncStatus.failed,
              errorMessage: expect.stringContaining(lifecycleStatus),
            }),
          }),
        );
      },
    );

    it('marks an orphaned record (order no longer exists) failed rather than looping forever', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(null);

      const result = await service.sweepDispatch();

      expect(result.ineligible).toBe(1);
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: POSSyncStatus.failed }),
        }),
      );
    });

    it('one candidate throwing an unexpected error does not abort the rest of the batch', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
        dispatchCandidate({ id: 'sync-poison', orderId: 'order-poison' }),
        dispatchCandidate({ id: 'sync-2', orderId: 'order-2' }),
      ]);
      mockPrisma.order.findUnique
        .mockRejectedValueOnce(new Error('transient DB error'))
        .mockResolvedValueOnce(mappedOrder({ id: 'order-2' }));

      const result = await service.sweepDispatch();

      expect(result.errored).toBe(1);
      expect(result.dispatched).toBe(1);
    });

    it('a lost race (another instance already moved the row out of not_synced) is a safe no-op, not a duplicate command', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([dispatchCandidate()]);
      mockPrisma.order.findUnique.mockResolvedValueOnce(mappedOrder());
      mockPrisma.pOSSyncRecord.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.sweepDispatch();

      // The command was still created-or-fetched idempotently — that call
      // happening is correct and safe (see the service's own doc comment);
      // only the local win/loss bookkeeping differs.
      expect(mockConnectorCommandService.createCommand).toHaveBeenCalledTimes(1);
      expect(result.dispatched).toBe(0);
    });
  });

  describe('sweepReconcile', () => {
    function reconcileCandidate(overrides: Record<string, unknown> = {}) {
      return {
        id: 'sync-1',
        connectorSubmitCommandId: 'cmd-1',
        orderId: 'order-1',
        venueId: 'venue-1',
        attemptCount: 1,
        ...overrides,
      };
    }

    it('does nothing when there are no eligible candidates', async () => {
      const result = await service.sweepReconcile();
      expect(result).toEqual({
        eligible: 0,
        confirmed: 0,
        failed: 0,
        retryScheduled: 0,
        recovered: 0,
        stillPending: 0,
        errored: 0,
      });
    });

    it('a succeeded command becomes submitted_awaiting_confirmation — never the stronger synced claim', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
      mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
        id: 'cmd-1',
        status: ConnectorCommandStatus.succeeded,
        resultPayload: { bridgeStatus: 201 },
        failureReason: null,
      });

      const result = await service.sweepReconcile();

      expect(result.confirmed).toBe(1);
      expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
        data: expect.objectContaining({ status: POSSyncStatus.submitted_awaiting_confirmation }),
      });
    });

    describe('DL-092: failure taxonomy — deterministic vs. transient vs. administratively cancelled', () => {
      it('bridge_rejected stays terminal failed — never scheduled for retry', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 1 }),
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
          id: 'cmd-1',
          status: ConnectorCommandStatus.failed,
          resultType: 'bridge_rejected',
          resultPayload: null,
          failureReason: 'unknown table',
        });

        const result = await service.sweepReconcile();

        expect(result.failed).toBe(1);
        expect(result.retryScheduled).toBe(0);
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
          data: expect.objectContaining({ status: POSSyncStatus.failed }),
        });
      });

      it('a malformed-payload rejection (connector_payload_invalid) stays terminal failed — never scheduled for retry', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 1 }),
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
          id: 'cmd-1',
          status: ConnectorCommandStatus.failed,
          resultType: 'connector_payload_invalid',
          resultPayload: null,
          failureReason: 'externalOrderId is required',
        });

        const result = await service.sweepReconcile();

        expect(result.failed).toBe(1);
        expect(result.retryScheduled).toBe(0);
      });

      it('cancelled stays terminal failed — never resurrected automatically, regardless of resultType', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 1 }),
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
          id: 'cmd-1',
          status: ConnectorCommandStatus.cancelled,
          resultType: null,
          resultPayload: null,
          failureReason: null,
        });

        const result = await service.sweepReconcile();

        expect(result.failed).toBe(1);
        expect(result.retryScheduled).toBe(0);
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
          data: expect.objectContaining({
            status: POSSyncStatus.failed,
            errorMessage: expect.stringContaining('administratively cancelled'),
          }),
        });
      });

      it.each([
        ['bridge_unreachable_or_failed', ConnectorCommandStatus.failed],
        [null, ConnectorCommandStatus.failed], // unrecognized/absent resultType defaults to retryable, not terminal
        [null, ConnectorCommandStatus.expired], // never claimed/accepted — zero side effects, always safe to retry
      ])(
        'transient failure (resultType=%s, status=%s) returns the record to not_synced with a scheduled nextRetryAt, never terminal failed',
        async (resultType, status) => {
          mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
            reconcileCandidate({ attemptCount: 1 }),
          ]);
          mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
            id: 'cmd-1',
            status,
            resultType,
            resultPayload: null,
            failureReason: 'Bridge returned HTTP 503',
          });

          const result = await service.sweepReconcile();

          expect(result.retryScheduled).toBe(1);
          expect(result.failed).toBe(0);
          expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
            where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
            data: expect.objectContaining({
              status: POSSyncStatus.not_synced,
              nextRetryAt: expect.any(Date),
              errorMessage: expect.stringContaining('Transient delivery failure (attempt 1/5)'),
            }),
          });
        },
      );

      it('exponential backoff: nextRetryAt grows with attemptCount (30s, 60s, 120s...)', async () => {
        const baseline = new Date('2026-08-23T00:00:00.000Z');
        jest.useFakeTimers().setSystemTime(baseline);

        for (const [attemptCount, expectedDelayMs] of [
          [1, 30_000],
          [2, 60_000],
          [3, 120_000],
        ] as const) {
          mockPrisma.pOSSyncRecord.updateMany.mockClear();
          mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
            reconcileCandidate({ attemptCount }),
          ]);
          mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
            id: 'cmd-1',
            status: ConnectorCommandStatus.failed,
            resultType: 'bridge_unreachable_or_failed',
            resultPayload: null,
            failureReason: 'connection refused',
          });

          await service.sweepReconcile();

          expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                nextRetryAt: new Date(baseline.getTime() + expectedDelayMs),
              }),
            }),
          );
        }

        jest.useRealTimers();
      });

      it('exhaustion: attemptCount at the configured ceiling becomes terminal failed with retryExhaustedAt set, not another scheduled retry', async () => {
        // maxDispatchAttempts defaults to 5 in this suite's ConfigService stub.
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 5 }),
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
          id: 'cmd-1',
          status: ConnectorCommandStatus.failed,
          resultType: 'bridge_unreachable_or_failed',
          resultPayload: null,
          failureReason: 'Bridge returned HTTP 503',
        });

        const result = await service.sweepReconcile();

        expect(result.retryScheduled).toBe(0);
        expect(result.failed).toBe(1);
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: { id: 'sync-1', status: POSSyncStatus.queued_for_connector },
          data: expect.objectContaining({
            status: POSSyncStatus.failed,
            retryExhaustedAt: expect.any(Date),
            errorMessage: expect.stringContaining('automatic retry exhausted'),
          }),
        });
      });
    });

    it.each([
      ConnectorCommandStatus.pending,
      ConnectorCommandStatus.claimed,
      ConnectorCommandStatus.accepted,
    ])(
      'a %s command is genuinely unresolved — POSSyncRecord stays queued_for_connector, never guessed either way',
      async (status) => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce({
          id: 'cmd-1',
          status,
          resultPayload: null,
          failureReason: null,
        });

        const result = await service.sweepReconcile();

        expect(result.stillPending).toBe(1);
        expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
      },
    );

    it('an orphaned reference (command not found) is treated as still-pending, not an error', async () => {
      mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
      mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(null);

      const result = await service.sweepReconcile();

      expect(result.stillPending).toBe(1);
      expect(result.errored).toBe(0);
    });

    describe('DL-093: stale `unknown` recovery — grace period, payload reuse, bounded, concurrency-safe', () => {
      const GRACE_MS = 10 * 60_000; // service default

      function unknownCommand(overrides: Record<string, unknown> = {}) {
        return {
          id: 'cmd-unknown-1',
          organizationId: 'org-1',
          status: ConnectorCommandStatus.unknown,
          resultType: null,
          resultPayload: null,
          failureReason: null,
          updatedAt: new Date(Date.now() - GRACE_MS - 1000), // just past grace
          payload: {
            externalOrderId: 'order-1',
            table: 'T5-ORIGINAL',
            items: [{ productCode: 'PLU-ORIGINAL', quantity: 2 }],
          },
          ...overrides,
        };
      }

      it('an unknown command still within the grace period is left stillPending — no recovery command created', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(
          unknownCommand({ updatedAt: new Date(Date.now() - 1000) }), // 1s old, not stale
        );

        const result = await service.sweepReconcile();

        expect(result.stillPending).toBe(1);
        expect(result.recovered).toBe(0);
        expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
        expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalled();
      });

      it('a stale unknown command creates exactly one new recovery ConnectorCommand, reusing the ORIGINAL stored payload verbatim', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 1 }),
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(unknownCommand());
        mockConnectorCommandService.createCommand.mockResolvedValueOnce({ id: 'cmd-recovery-1' });

        const result = await service.sweepReconcile();

        expect(result.recovered).toBe(1);
        expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
            idempotencyKey: 'idealpos-submit-order:order-1:retry:1',
            sourceAggregateType: 'Order',
            sourceRecordId: 'order-1',
            correlationId: 'order-1',
            // Byte-identical to the ORIGINAL command's payload — never
            // rebuilt from current Table/MenuItem mappings (this mock
            // stub deliberately never provides current mapping data at
            // all, proving the recovery path never looks it up).
            payload: {
              externalOrderId: 'order-1',
              table: 'T5-ORIGINAL',
              items: [{ productCode: 'PLU-ORIGINAL', quantity: 2 }],
            },
          }),
        );
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'sync-1',
            status: POSSyncStatus.queued_for_connector,
            connectorSubmitCommandId: 'cmd-unknown-1',
          },
          data: expect.objectContaining({
            connectorSubmitCommandId: 'cmd-recovery-1',
            attemptCount: { increment: 1 },
          }),
        });
      });

      it('mapping changes after the original attempt do not alter the recovery payload', async () => {
        // mockPrisma.menuItem lookup is never called by the recovery path
        // itself — asserting that directly proves current mappings cannot
        // leak into a recovery payload, regardless of what they say now.
        // order.findUnique IS called once (order.findUnique below resolves
        // undefined since no mockResolvedValueOnce is queued for it here),
        // but only by broadcastPosSyncUpdate's post-recovery WebSocket
        // push — a separate concern from payload construction, which never
        // reads the order at all for this path (the recovery payload is
        // reused byte-for-byte from the original command, see below).
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(unknownCommand());
        mockPrisma.menuItem.findMany.mockResolvedValueOnce([
          { id: 'item-1', posProductCode: 'PLU-CHANGED-AFTER-UNKNOWN' },
        ]);

        await service.sweepReconcile();

        expect(mockPrisma.order.findUnique).toHaveBeenCalledTimes(1);
        expect(mockPrisma.menuItem.findMany).not.toHaveBeenCalled();
        expect(mockConnectorCommandService.createCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({ table: 'T5-ORIGINAL' }),
          }),
        );
      });

      it('a lost CAS race (another tick already recovered this record) is a safe no-op', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([reconcileCandidate()]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(unknownCommand());
        mockConnectorCommandService.createCommand.mockResolvedValueOnce({ id: 'cmd-recovery-1' });
        mockPrisma.pOSSyncRecord.updateMany.mockResolvedValueOnce({ count: 0 });

        const result = await service.sweepReconcile();

        // createCommand is idempotent on the shared attempt-qualified key —
        // still safe to have been called, but this tick's own local
        // bookkeeping correctly reflects that it did not win.
        expect(mockConnectorCommandService.createCommand).toHaveBeenCalledTimes(1);
        expect(result.recovered).toBe(0);
      });

      it('exhaustion: attemptCount at the ceiling produces a truthful "unknown, not proven" terminal failed — no recovery command created', async () => {
        mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
          reconcileCandidate({ attemptCount: 5 }), // maxDispatchAttempts defaults to 5
        ]);
        mockPrisma.connectorCommand.findUnique.mockResolvedValueOnce(unknownCommand());

        const result = await service.sweepReconcile();

        expect(result.failed).toBe(1);
        expect(result.recovered).toBe(0);
        expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
        expect(mockPrisma.pOSSyncRecord.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'sync-1',
            status: POSSyncStatus.queued_for_connector,
            connectorSubmitCommandId: 'cmd-unknown-1',
          },
          data: expect.objectContaining({
            status: POSSyncStatus.failed,
            retryExhaustedAt: expect.any(Date),
            errorMessage: expect.stringContaining('UNPROVEN'),
          }),
        });
        // Never a fabricated native rejection.
        expect(mockPrisma.pOSSyncRecord.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ errorMessage: expect.stringContaining('rejected') }),
          }),
        );
      });
    });
  });
});

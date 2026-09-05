import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorCommandStatus, POSSyncStatus } from '@prisma/client';
import { IdealposOrderDispatcherService } from './idealpos-order-dispatcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCommandService } from '../connector/connector-command.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE } from './idealpos-order-dispatch.constants';
import {
  DINE_IN_ROUTE_CONFIG_KEY,
  IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
  IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY,
} from './dine-in-route';

/**
 * The dine-in routing seam, exercised through the REAL dispatcher rather than
 * through the pure resolver alone.
 *
 * The property under test throughout is not "the right route was chosen" — it
 * is "exactly one transport was used, and never the other one as well". Every
 * assertion is therefore about which command types were created across the
 * whole sweep, not merely about the happy path of the selected route.
 *
 * The dangerous outcome this file exists to make impossible: one dine-in order
 * producing both a native table round (which may already have put a docket on
 * Table 5) and a Webit submission (which will put a second one there).
 */

const mockPrisma: any = {
  pOSSyncRecord: { findMany: jest.fn(), updateMany: jest.fn() },
  order: { findUnique: jest.fn() },
  menuItem: { findMany: jest.fn() },
  connectorCommand: { findUnique: jest.fn() },
  connectorInstallation: { findFirst: jest.fn() },
};

const mockConnectorCommandService: any = { createCommand: jest.fn() };
const mockOrdersGateway: any = { sendOrderUpdate: jest.fn() };

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sync-1',
    orderId: 'order-1',
    venueId: 'venue-1',
    attemptCount: 0,
    connectorSubmitCommandId: null,
    ...overrides,
  };
}

function mappedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    venueId: 'venue-1',
    notes: null,
    serviceMode: 'dine_in',
    venue: { organizationId: 'org-1' },
    table: { posTableCode: 'T5' },
    items: [
      { menuItemId: 'item-1', menuItemTitle: 'Mixed Grill', quantity: 2, selectedModifiers: [] },
    ],
    ...overrides,
  };
}

/** Every command type created during a test, in order. */
function createdCommandTypes(): string[] {
  return mockConnectorCommandService.createCommand.mock.calls.map(
    (call: any[]) => call[0].commandType as string,
  );
}

async function buildService(configuredRoute?: string): Promise<IdealposOrderDispatcherService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IdealposOrderDispatcherService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ConnectorCommandService, useValue: mockConnectorCommandService },
      { provide: OrdersGateway, useValue: mockOrdersGateway },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def?: unknown) =>
            key === DINE_IN_ROUTE_CONFIG_KEY ? (configuredRoute ?? '') : def,
        },
      },
    ],
  }).compile();
  return module.get(IdealposOrderDispatcherService);
}

describe('dine-in routing seam (dispatch)', () => {
  let service: IdealposOrderDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([]);
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.menuItem.findMany.mockResolvedValue([{ id: 'item-1', posProductCode: 'PLU-4821' }]);
    mockPrisma.order.findUnique.mockResolvedValue(mappedOrder());
    mockPrisma.connectorCommand.findUnique.mockResolvedValue(null);
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue(null);
    mockConnectorCommandService.createCommand.mockResolvedValue({ id: 'cmd-1' });
  });

  afterEach(() => service?.onModuleDestroy());

  // ───────────────────────── WEBIT is the default ─────────────────────────

  it('WEBIT selected (by default) → exactly one Webit command and no native command', async () => {
    service = await buildService(undefined);
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);

    const result = await service.sweepDispatch();

    expect(result.dispatched).toBe(1);
    expect(createdCommandTypes()).toEqual([IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]);
    expect(createdCommandTypes()).not.toContain(IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE);
  });

  it('production default is unchanged: no configuration means Webit, exactly as before', async () => {
    service = await buildService('');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);

    await service.sweepDispatch();

    expect(mockConnectorCommandService.createCommand).toHaveBeenCalledTimes(1);
    expect(mockConnectorCommandService.createCommand.mock.calls[0][0]).toMatchObject({
      commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
      idempotencyKey: 'idealpos-submit-order:order-1',
    });
  });

  // ───────────────────── NATIVE never falls back to Webit ─────────────────────

  it('NATIVE selected but capability unavailable → NO command of either route', async () => {
    // The pre-boundary refusal. Nothing was dispatched, so nothing can be
    // half-done on a table — and critically, no Webit command was created as a
    // consolation prize.
    service = await buildService('NATIVE_IDEALPOS_TABLE');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue(null); // no connector reports it

    const result = await service.sweepDispatch();

    expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(0);
    expect(result.ineligible).toBe(1);
  });

  it('NATIVE unavailable leaves the record retryable, not failed', async () => {
    service = await buildService('NATIVE_IDEALPOS_TABLE');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);

    await service.sweepDispatch();

    const write = mockPrisma.pOSSyncRecord.updateMany.mock.calls.at(-1)![0];
    expect(write.where).toMatchObject({ id: 'sync-1', status: POSSyncStatus.not_synced });
    expect(write.data.status).toBeUndefined(); // still not_synced — recoverable by fixing the cause
    expect(write.data.nextRetryAt).toBeInstanceOf(Date);
    expect(write.data.errorMessage).toContain(IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY);
  });

  it('NATIVE selected WITH capability → exactly one native command and no Webit command', async () => {
    service = await buildService('NATIVE_IDEALPOS_TABLE');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue({
      reportedCapabilities: { [IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY]: true },
    });

    await service.sweepDispatch();

    expect(createdCommandTypes()).toEqual([IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE]);
    expect(createdCommandTypes()).not.toContain(IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE);
  });

  it('the native payload carries the (ExternalOrderId, RoundId) identity the connector keys on', async () => {
    service = await buildService('NATIVE_IDEALPOS_TABLE');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue({
      reportedCapabilities: [IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY],
    });

    await service.sweepDispatch();

    const payload = mockConnectorCommandService.createCommand.mock.calls[0][0].payload;
    // Same externalOrderId the Webit payload uses, so identity is preserved
    // across the cutover rather than translated (and possibly drifted).
    expect(payload).toMatchObject({
      externalOrderId: 'order-1',
      roundId: 'round-1',
      roundKind: 'FirstRound',
      tableCode: 'T5',
      items: [{ nativeCode: 'PLU-4821', quantity: 2 }],
    });
    // IdealPOS is the pricing authority: there is nowhere to put a price.
    expect(JSON.stringify(payload)).not.toMatch(/price|amount|total/i);
  });

  // ───────────── the route is durable, not recomputed ─────────────

  it('an order already committed to NATIVE stays native even after config is flipped to WEBIT', async () => {
    service = await buildService('WEBIT');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ connectorSubmitCommandId: 'cmd-native-1', attemptCount: 1 }),
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      commandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
    });
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue({
      reportedCapabilities: [IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY],
    });

    await service.sweepDispatch();

    expect(createdCommandTypes()).not.toContain(IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE);
    expect(createdCommandTypes()).toEqual([IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE]);
  });

  it('an order already committed to WEBIT stays Webit even after config is flipped to NATIVE', async () => {
    service = await buildService('NATIVE_IDEALPOS_TABLE');
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ connectorSubmitCommandId: 'cmd-webit-1', attemptCount: 1 }),
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
    });

    await service.sweepDispatch();

    expect(createdCommandTypes()).toEqual([IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]);
    // And the native capability was never even consulted — durable state
    // decided before configuration was reached.
    expect(mockPrisma.connectorInstallation.findFirst).not.toHaveBeenCalled();
  });

  // ───────────── misconfiguration cannot dual-dispatch ─────────────

  it('an invalid route configuration dispatches NOTHING, rather than both or a default', async () => {
    service = await buildService('NATIVE_IDEALPOS_TABEL'); // operator typo
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);

    const result = await service.sweepDispatch();

    expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(0);
    const write = mockPrisma.pOSSyncRecord.updateMany.mock.calls.at(-1)![0];
    expect(write.data.errorMessage).toContain(DINE_IN_ROUTE_CONFIG_KEY);
  });

  // ───────────── duplicate delivery cannot create one command per route ─────────────

  it('duplicate delivery of the same record creates at most one command type across sweeps', async () => {
    service = await buildService(undefined);

    // First sweep: no command yet.
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([candidate()]);
    await service.sweepDispatch();

    // Second sweep: the same record, now carrying the command the first sweep
    // created — as a genuine redelivery would.
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ connectorSubmitCommandId: 'cmd-1', attemptCount: 1 }),
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
    });
    await service.sweepDispatch();

    expect(new Set(createdCommandTypes())).toEqual(new Set([IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]));
  });

  it('a second round of the same order stays on the route the first round committed to', async () => {
    // The API models one round per order today, so "the same order dispatched
    // again" IS the second-round case at this layer: the durable command type
    // is what a later round must inherit.
    service = await buildService('WEBIT'); // config now says the OTHER route
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      candidate({ connectorSubmitCommandId: 'cmd-native-1', attemptCount: 2 }),
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      commandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
    });
    mockPrisma.connectorInstallation.findFirst.mockResolvedValue({
      reportedCapabilities: [IDEALPOS_NATIVE_TABLE_ROUND_REQUIRED_CAPABILITY],
    });

    await service.sweepDispatch();

    expect(createdCommandTypes()).toEqual([IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE]);
  });
});

// ───────────── no post-boundary fallback, in reconciliation ─────────────

describe('dine-in routing seam (reconcile)', () => {
  let service: IdealposOrderDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValue([]);
    mockPrisma.pOSSyncRecord.updateMany.mockResolvedValue({ count: 1 });
    mockConnectorCommandService.createCommand.mockResolvedValue({ id: 'cmd-recovery' });
  });

  afterEach(() => service?.onModuleDestroy());

  it('a NATIVE command left "unknown" is NEVER recovered by creating a Webit command', async () => {
    // This is the post-boundary case. The native round may already have put a
    // docket on the table; re-sending the same order through Webit would put a
    // second one there. The server must stop, not fall back.
    service = await buildService(undefined);
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      { id: 'sync-1', connectorSubmitCommandId: 'cmd-native-1', orderId: 'order-1', venueId: 'venue-1', attemptCount: 1 },
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      id: 'cmd-native-1',
      commandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
      status: ConnectorCommandStatus.unknown,
      organizationId: 'org-1',
      payload: {},
      resultPayload: null,
      updatedAt: new Date(Date.now() - 60 * 60_000), // well past the grace period
    });

    const result = await service.sweepReconcile();

    expect(mockConnectorCommandService.createCommand).not.toHaveBeenCalled();
    expect(result.recovered).toBe(0);
    expect(result.failed).toBe(1);

    const write = mockPrisma.pOSSyncRecord.updateMany.mock.calls.at(-1)![0];
    expect(write.data.status).toBe(POSSyncStatus.failed);
    expect(write.data.errorMessage).toContain('will NOT be dispatched via Webit');
  });

  it('a WEBIT command left "unknown" still recovers as a Webit command, unchanged', async () => {
    // The pre-existing DL-093 behaviour must be untouched by the seam.
    service = await buildService(undefined);
    mockPrisma.pOSSyncRecord.findMany.mockResolvedValueOnce([
      { id: 'sync-1', connectorSubmitCommandId: 'cmd-webit-1', orderId: 'order-1', venueId: 'venue-1', attemptCount: 1 },
    ]);
    mockPrisma.connectorCommand.findUnique.mockResolvedValue({
      id: 'cmd-webit-1',
      commandType: IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE,
      status: ConnectorCommandStatus.unknown,
      organizationId: 'org-1',
      payload: {},
      resultPayload: null,
      updatedAt: new Date(Date.now() - 60 * 60_000),
    });

    const result = await service.sweepReconcile();

    expect(result.recovered).toBe(1);
    expect(createdCommandTypes()).toEqual([IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]);
  });
});

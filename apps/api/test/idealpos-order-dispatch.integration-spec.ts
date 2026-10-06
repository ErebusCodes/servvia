// Integration test against a REAL local Postgres — no mocking of Prisma.
// Exercises the IdealPOS connector-delivery pipeline end to end: a durable
// POSSyncRecord -> IdealposOrderDispatcherService.sweepDispatch() ->
// ConnectorCommand -> the real connector protocol (poll/accept/report,
// story 2-10, unchanged) -> IdealposOrderDispatcherService.sweepReconcile()
// -> truthful POSSyncRecord state.
//
// This file never contacts IdealposBridge, native IdealPOS, or a real
// connector build — "succeeded"/"submitted_awaiting_confirmation" here mean
// only that a durable command was created and a caller reported a terminal
// outcome through the existing, already-proven connector protocol. No
// assertion in this file should be read as evidence of native IdealPOS
// consumption or a KOT.
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IdealposOrderDispatcherService } from '../src/pos-sync/idealpos-order-dispatcher.service';
import { IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE } from '../src/pos-sync/idealpos-order-dispatch.constants';
import { ConnectorCommandService } from '../src/connector/connector-command.service';
import { OrdersGateway } from '../src/orders/orders.gateway';
import { deleteVenueGrants, grantVenues } from './venue-grants';

describe('IdealPOS connector delivery (integration, real local Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: IdealposOrderDispatcherService;
  let commandService: ConnectorCommandService;
  let config: ConfigService;

  const TAG = 'idealpos-connector-delivery-integration';

  let orgId: string;
  let venueId: string;
  let accessToken: string;
  let categoryId: string;

  async function createOrgVenueOwner(): Promise<void> {
    const org = await prisma.organization.create({
      data: {
        name: `${TAG} org`,
        slug: `${TAG}-org-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        billingEmail: `${TAG}@verdura.internal`,
      },
    });
    orgId = org.id;
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} venue`,
        slug: `${TAG}-venue-${Date.now()}`,
        address: {},
        operatingHours: {},
        seatingCapacity: 10,
        // Any non-'none' adapter is enough for POSSyncRecord to be created
        // at order-creation time — see OrdersService.persistOrder.
        posAdapterType: 'api',
      },
    });
    venueId = venue.id;
    const password = `${TAG}-password-1234`;
    const owner = await prisma.staff.create({
      data: {
        organizationId: org.id,
        email: `${TAG}-owner-${Date.now()}@verdura.internal`,
        name: 'Owner',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'owner',
      },
    });
    await grantVenues(prisma, owner.id, [venue.id]);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    accessToken = loginRes.body.accessToken as string;

    const category = await prisma.category.create({
      data: {
        organizationId: org.id,
        name: `${TAG} category`,
        description: 'x',
        sortOrder: 0,
        createdById: owner.id,
      },
    });
    categoryId = category.id;

    return void owner;
  }

  async function createMappedTable(posTableCode: string | null): Promise<string> {
    const table = await prisma.table.create({
      data: {
        venueId,
        tableNumber: `${Math.floor(Math.random() * 1_000_000)}`,
        capacity: 2,
        sortOrder: 0,
        posTableCode,
      },
    });
    return table.id;
  }

  async function createMappedMenuItem(posProductCode: string | null): Promise<string> {
    const item = await prisma.menuItem.create({
      data: {
        organizationId: orgId,
        categoryId,
        title: `${TAG} item ${Math.random().toString(36).slice(2)}`,
        description: 'x',
        priceCents: 1000,
        nutritionalDetails: {},
        createdById: (await prisma.staff.findFirstOrThrow({ where: { organizationId: orgId } })).id,
        posProductCode,
      },
    });
    return item.id;
  }

  /**
   * Creates a real durable Order + its atomically-created POSSyncRecord
   * directly via Prisma, bypassing OrdersService — this file tests the
   * dispatcher's own read/dispatch/reconcile behavior against durable rows,
   * not order-creation itself (already covered by orders.integration-spec.ts).
   */
  async function createOrderWithSyncRecord(params: {
    tableId: string | null;
    menuItemId: string;
    quantity?: number;
    selectedModifiers?: unknown;
  }): Promise<{ orderId: string; syncRecordId: string }> {
    const menuItem = await prisma.menuItem.findUniqueOrThrow({ where: { id: params.menuItemId } });
    const order = await prisma.order.create({
      data: {
        venueId,
        tableId: params.tableId,
        status: 'confirmed',
        subtotalCents: menuItem.priceCents,
        totalCents: menuItem.priceCents,
        source: 'staff',
        idempotencyKey: `${TAG}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        items: {
          create: [
            {
              menuItemId: params.menuItemId,
              menuItemTitle: menuItem.title,
              menuItemCategory: 'test',
              unitPriceCents: menuItem.priceCents,
              quantity: params.quantity ?? 1,
              lineTotalCents: menuItem.priceCents * (params.quantity ?? 1),
              selectedModifiers: params.selectedModifiers ?? [],
            },
          ],
        },
      },
    });
    const syncRecord = await prisma.pOSSyncRecord.create({
      data: { orderId: order.id, venueId, adapterType: 'api', status: 'not_synced' },
    });
    return { orderId: order.id, syncRecordId: syncRecord.id };
  }

  async function enrollAndReportCapability(): Promise<string> {
    const enrollRes = await request(app.getHttpServer())
      .post(`/api/venues/${venueId}/connector/enrollments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const bootstrapToken = enrollRes.body.bootstrapToken as string;
    const redeemRes = await request(app.getHttpServer())
      .post('/api/connector/enroll')
      .set('Authorization', `Bearer ${bootstrapToken}`)
      .expect(200);
    const credential = redeemRes.body.credential as string;
    await request(app.getHttpServer())
      .post('/api/connector/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({
        version: '0.0.1-test',
        capabilities: { [IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]: true },
      })
      .expect(200);
    return credential;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    dispatcher = app.get(IdealposOrderDispatcherService);
    commandService = app.get(ConnectorCommandService);
    config = app.get(ConfigService);

    await createOrgVenueOwner();
  });

  afterAll(async () => {
    await prisma.connectorCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.connectorInstallation.deleteMany({ where: { organizationId: orgId } });
    await prisma.connectorEnrollment.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.pOSSyncRecord.deleteMany({ where: { venueId } });
    await prisma.orderItem.deleteMany({ where: { order: { venueId } } });
    await prisma.order.deleteMany({ where: { venueId } });
    await prisma.menuItem.deleteMany({ where: { organizationId: orgId } });
    await prisma.table.deleteMany({ where: { venueId } });
    await prisma.category.deleteMany({ where: { organizationId: orgId } });
    await deleteVenueGrants(prisma, orgId);
    await prisma.staff.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
    await prisma.$disconnect();
  });

  it('dispatches a fully-mapped order: exactly one ConnectorCommand, POSSyncRecord becomes queued_for_connector', async () => {
    const tableId = await createMappedTable('T-integration-1');
    const menuItemId = await createMappedMenuItem('PLU-integration-1');
    const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    const result = await dispatcher.sweepDispatch();
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(record.status).toBe('queued_for_connector');
    expect(record.connectorSubmitCommandId).not.toBeNull();

    const command = await prisma.connectorCommand.findUniqueOrThrow({
      where: { id: record.connectorSubmitCommandId! },
    });
    expect(command.commandType).toBe(IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE);
    expect(command.sourceRecordId).toBe(orderId);
    expect(command.payload).toEqual({
      externalOrderId: orderId,
      table: 'T-integration-1',
      items: [{ productCode: 'PLU-integration-1', quantity: 1 }],
    });

    // No price, no modifiers, no name-matched/guessed field anywhere in the payload sent downstream.
    expect(JSON.stringify(command.payload)).not.toMatch(/price|cents|modifier/i);
  });

  it('concurrent sweepDispatch calls for the same order create exactly one ConnectorCommand — the explicit no-duplicate proof', async () => {
    const tableId = await createMappedTable('T-integration-2');
    const menuItemId = await createMappedMenuItem('PLU-integration-2');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    const [r1, r2, r3] = await Promise.all([
      dispatcher.sweepDispatch(),
      dispatcher.sweepDispatch(),
      dispatcher.sweepDispatch(),
    ]);

    const totalDispatched = r1.dispatched + r2.dispatched + r3.dispatched;
    expect(totalDispatched).toBe(1); // exactly one instance wins the atomic transition

    const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(record.status).toBe('queued_for_connector');

    const commandCount = await prisma.connectorCommand.count({
      where: { sourceAggregateType: 'Order', sourceRecordId: record.orderId },
    });
    expect(commandCount).toBe(1);
  });

  it('a modifier-bearing order never reaches the connector — fails closed with a diagnostic reason', async () => {
    const tableId = await createMappedTable('T-integration-3');
    const menuItemId = await createMappedMenuItem('PLU-integration-3');
    const { syncRecordId } = await createOrderWithSyncRecord({
      tableId,
      menuItemId,
      selectedModifiers: [{ optionId: 'opt-1', optionName: 'Extra Sauce' }],
    });

    await dispatcher.sweepDispatch();

    const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(record.status).toBe('failed');
    expect(record.connectorSubmitCommandId).toBeNull();
    expect(record.errorMessage).toContain('unsupported_modifiers');

    const commandCount = await prisma.connectorCommand.count({
      where: { sourceAggregateType: 'Order', sourceRecordId: record.orderId },
    });
    expect(commandCount).toBe(0);
  });

  it('an order at an unmapped table fails closed and is never dispatched', async () => {
    const tableId = await createMappedTable(null);
    const menuItemId = await createMappedMenuItem('PLU-integration-4');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();

    const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(record.status).toBe('failed');
    expect(record.errorMessage).toContain('unmapped_table');
  });

  it('full round trip: dispatch -> real connector poll/accept/report -> reconcile yields submitted_awaiting_confirmation, never the stronger synced claim', async () => {
    const tableId = await createMappedTable('T-integration-5');
    const menuItemId = await createMappedMenuItem('PLU-integration-5');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    expect(afterDispatch.status).toBe('queued_for_connector');
    const commandId = afterDispatch.connectorSubmitCommandId!;

    const credential = await enrollAndReportCapability();

    const pollRes = await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    expect(pollRes.body.commands.map((c: { id: string }) => c.id)).toContain(commandId);
    const claimed = pollRes.body.commands.find((c: { id: string }) => c.id === commandId);
    expect(claimed.payload).toEqual({
      externalOrderId: afterDispatch.orderId,
      table: 'T-integration-5',
      items: [{ productCode: 'PLU-integration-5', quantity: 1 }],
    });

    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/report`)
      .set('Authorization', `Bearer ${credential}`)
      .send({ outcome: 'succeeded', resultType: 'bridge_accepted', idempotencyKey: 'report-1' })
      .expect(200);

    const reconcileResult = await dispatcher.sweepReconcile();
    expect(reconcileResult.confirmed).toBeGreaterThanOrEqual(1);

    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    // Bridge acceptance only — never the stronger `synced` (authoritative
    // native confirmation) claim this mechanism cannot honestly make.
    expect(final.status).toBe('submitted_awaiting_confirmation');
    expect(final.status).not.toBe('synced');
  });

  it('a definite Bridge rejection reported by the connector becomes a truthful failed POSSyncRecord', async () => {
    const tableId = await createMappedTable('T-integration-6');
    const menuItemId = await createMappedMenuItem('PLU-integration-6');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    const commandId = afterDispatch.connectorSubmitCommandId!;

    const credential = await enrollAndReportCapability();
    await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/report`)
      .set('Authorization', `Bearer ${credential}`)
      .send({
        outcome: 'failed',
        resultType: 'bridge_rejected',
        failureReason: 'unknown table',
        idempotencyKey: 'report-fail-1',
      })
      .expect(200);

    await dispatcher.sweepReconcile();

    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(final.status).toBe('failed');
    expect(final.errorMessage).toContain('unknown table');
  });

  describe('DL-092: transient-failure retry — real Postgres, real connector protocol, no wall-clock waiting', () => {
    // One shared connector installation for every test in this block —
    // realistic (a real venue enrolls its connector once and reuses it for
    // many orders, never once per order) and keeps this block's use of the
    // real /api/connector/enroll endpoint (a deliberately tight production
    // rate limit: 10 requests/900s, connector-command.controller.ts — not
    // a bug, not relaxed for this test) well within budget alongside the
    // sibling tests above that each enroll their own.
    let sharedCredential: string;
    beforeAll(async () => {
      sharedCredential = await enrollAndReportCapability();
    });

    /** Drives one order through poll -> accept -> report(outcome, resultType) via the real HTTP surface. */
    async function reportOutcome(
      credential: string,
      commandId: string,
      body: { outcome: 'succeeded' | 'failed'; resultType: string; failureReason?: string },
    ): Promise<void> {
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({ ...body, idempotencyKey: `report-${commandId}` })
        .expect(200);
    }

    it('a transient Bridge failure returns the record to not_synced with nextRetryAt set — not terminal, not immediately re-eligible', async () => {
      const tableId = await createMappedTable('T-retry-1');
      const menuItemId = await createMappedMenuItem('PLU-retry-1');
      const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const firstCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;

      const credential = sharedCredential;
      await reportOutcome(credential, firstCommandId, {
        outcome: 'failed',
        resultType: 'bridge_unreachable_or_failed',
        failureReason: 'Bridge returned HTTP 503',
      });

      const reconcileResult = await dispatcher.sweepReconcile();
      expect(reconcileResult.retryScheduled).toBe(1);
      expect(reconcileResult.failed).toBe(0);

      const afterReconcile = await prisma.pOSSyncRecord.findUniqueOrThrow({
        where: { id: syncRecordId },
      });
      expect(afterReconcile.status).toBe('not_synced');
      expect(afterReconcile.nextRetryAt).not.toBeNull();
      expect(afterReconcile.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
      expect(afterReconcile.attemptCount).toBe(1);
      expect(afterReconcile.errorMessage).toContain('Transient delivery failure (attempt 1/5)');

      // Not immediately re-eligible: sweepDispatch must not pick it back up
      // while nextRetryAt is still in the future — no busy-loop.
      const tooEarly = await dispatcher.sweepDispatch();
      expect(tooEarly.eligible).toBe(0);
      const stillWaiting = await prisma.pOSSyncRecord.findUniqueOrThrow({
        where: { id: syncRecordId },
      });
      expect(stillWaiting.attemptCount).toBe(1); // unchanged — no premature retry
    });

    it('once nextRetryAt has passed, sweepDispatch creates a NEW attempt-qualified ConnectorCommand with the SAME externalOrderId', async () => {
      const tableId = await createMappedTable('T-retry-2');
      const menuItemId = await createMappedMenuItem('PLU-retry-2');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const firstCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      const credential = sharedCredential;
      await reportOutcome(credential, firstCommandId, {
        outcome: 'failed',
        resultType: 'bridge_unreachable_or_failed',
        failureReason: 'connection refused',
      });
      await dispatcher.sweepReconcile();

      // Deterministic, no real sleep (per DL-092's testability requirement):
      // directly set the persisted backoff deadline into the past.
      await prisma.pOSSyncRecord.update({
        where: { id: syncRecordId },
        data: { nextRetryAt: new Date(Date.now() - 1000) },
      });

      const retryResult = await dispatcher.sweepDispatch();
      expect(retryResult.dispatched).toBe(1);

      const afterRetry = await prisma.pOSSyncRecord.findUniqueOrThrow({
        where: { id: syncRecordId },
      });
      expect(afterRetry.status).toBe('queued_for_connector');
      expect(afterRetry.attemptCount).toBe(2);
      expect(afterRetry.connectorSubmitCommandId).not.toBe(firstCommandId); // a genuinely new command

      const secondCommand = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: afterRetry.connectorSubmitCommandId! },
      });
      expect(secondCommand.idempotencyKey).toBe(`idealpos-submit-order:${orderId}:retry:1`);
      // The one thing that must never change across attempts:
      expect((secondCommand.payload as { externalOrderId: string }).externalOrderId).toBe(orderId);

      const totalCommandsForOrder = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(totalCommandsForOrder).toBe(2); // full history preserved, not overwritten
    });

    it('recovery: transient failure then a later successful report resolves to submitted_awaiting_confirmation — proves the lost-response-then-duplicate-replay scenario is safe', async () => {
      const tableId = await createMappedTable('T-retry-3');
      const menuItemId = await createMappedMenuItem('PLU-retry-3');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const firstCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      const credential = sharedCredential;
      await reportOutcome(credential, firstCommandId, {
        outcome: 'failed',
        resultType: 'bridge_unreachable_or_failed',
        failureReason: 'response lost after Bridge may have already accepted the order',
      });
      await dispatcher.sweepReconcile();

      await prisma.pOSSyncRecord.update({
        where: { id: syncRecordId },
        data: { nextRetryAt: new Date(Date.now() - 1000) },
      });
      await dispatcher.sweepDispatch();
      const secondCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;

      // Bridge's own idempotency store recognizes the retried externalOrderId
      // and returns a duplicate-safe 200 — the connector reports this
      // exactly like any other success.
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${secondCommandId}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${secondCommandId}/report`)
        .set('Authorization', `Bearer ${credential}`)
        .send({
          outcome: 'succeeded',
          resultType: 'bridge_accepted',
          resultPayload: { externalOrderId: orderId, duplicate: true },
          idempotencyKey: `report-${secondCommandId}`,
        })
        .expect(200);

      const reconcileResult = await dispatcher.sweepReconcile();
      expect(reconcileResult.confirmed).toBe(1);

      const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(final.status).toBe('submitted_awaiting_confirmation');
      expect((final.responsePayload as { duplicate: boolean }).duplicate).toBe(true);

      // Never two logical IdealPOS orders — both commands ever created for
      // this order carry the identical externalOrderId.
      const commands = await prisma.connectorCommand.findMany({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(commands).toHaveLength(2);
      for (const c of commands) {
        expect((c.payload as { externalOrderId: string }).externalOrderId).toBe(orderId);
      }
    });

    it('exhaustion: repeated transient failures up to the configured ceiling become terminal failed with retryExhaustedAt set — no further command is ever created', async () => {
      const tableId = await createMappedTable('T-retry-4');
      const menuItemId = await createMappedMenuItem('PLU-retry-4');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });
      const credential = sharedCredential;

      // IDEALPOS_DISPATCH_MAX_ATTEMPTS defaults to 5 — drive exactly 5
      // dispatch-then-transient-failure cycles.
      for (let attempt = 0; attempt < 5; attempt++) {
        const dispatchResult = await dispatcher.sweepDispatch();
        expect(dispatchResult.dispatched).toBe(1);
        const commandId = (
          await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
        ).connectorSubmitCommandId!;
        await reportOutcome(credential, commandId, {
          outcome: 'failed',
          resultType: 'bridge_unreachable_or_failed',
          failureReason: `simulated outage, attempt ${attempt + 1}`,
        });
        await dispatcher.sweepReconcile();
        if (attempt < 4) {
          // Force immediate eligibility for the next loop iteration —
          // this test is proving the ceiling, not the backoff curve
          // (already covered by the unit test's fake-timer assertions).
          await prisma.pOSSyncRecord.update({
            where: { id: syncRecordId },
            data: { nextRetryAt: new Date(Date.now() - 1000) },
          });
        }
      }

      const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(final.status).toBe('failed');
      expect(final.retryExhaustedAt).not.toBeNull();
      expect(final.attemptCount).toBe(5);
      expect(final.errorMessage).toContain('automatic retry exhausted');

      // No sixth command was, or ever will be, created — sweepDispatch's
      // own eligibility gate (attemptCount < maxDispatchAttempts) excludes
      // it permanently now that it is `failed`, not `not_synced`.
      const noFurtherDispatch = await dispatcher.sweepDispatch();
      expect(noFurtherDispatch.eligible).toBe(0);
      const totalCommands = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(totalCommands).toBe(5);
    });

    it('concurrency: two concurrent sweepDispatch calls on a retry-eligible record create exactly one new ConnectorCommand for that attempt', async () => {
      const tableId = await createMappedTable('T-retry-5');
      const menuItemId = await createMappedMenuItem('PLU-retry-5');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const firstCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      const credential = sharedCredential;
      await reportOutcome(credential, firstCommandId, {
        outcome: 'failed',
        resultType: 'bridge_unreachable_or_failed',
        failureReason: 'connection refused',
      });
      await dispatcher.sweepReconcile();
      await prisma.pOSSyncRecord.update({
        where: { id: syncRecordId },
        data: { nextRetryAt: new Date(Date.now() - 1000) },
      });

      const [r1, r2, r3] = await Promise.all([
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
        dispatcher.sweepDispatch(),
      ]);
      const totalDispatchedThisRound = r1.dispatched + r2.dispatched + r3.dispatched;
      expect(totalDispatchedThisRound).toBe(1); // exactly one instance won the CAS

      const commandsForOrder = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(commandsForOrder).toBe(2); // the original attempt + exactly one retry attempt, never more

      const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(final.attemptCount).toBe(2);
    });
  });

  describe('DL-093: stale `unknown` recovery — real Postgres, real connector protocol', () => {
    let sharedCredential: string;
    const graceMs = 10 * 60_000; // service default; matches IDEALPOS_UNKNOWN_RECOVERY_GRACE_MS

    beforeAll(async () => {
      sharedCredential = await enrollAndReportCapability();
    });

    /** Polls and accepts a command (never reports) then forces it to `unknown` via the real sweep. */
    async function driveToUnknown(credential: string, commandId: string): Promise<void> {
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${commandId}/accept`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(200);
      await prisma.connectorCommand.update({
        where: { id: commandId },
        data: { terminalReportDeadline: new Date(Date.now() - 1000) },
      });
      const sweepResult = await commandService.sweep();
      expect(sweepResult.markedUnknown).toBeGreaterThanOrEqual(1);
    }

    /** Backdates the now-unknown command's updatedAt past the recovery grace period. */
    async function makeStale(commandId: string): Promise<void> {
      await prisma.connectorCommand.update({
        where: { id: commandId },
        data: { updatedAt: new Date(Date.now() - graceMs - 1000) },
      });
    }

    it('an unknown command still within the grace period is left alone — no recovery command yet', async () => {
      const tableId = await createMappedTable('T-unknown-1');
      const menuItemId = await createMappedMenuItem('PLU-unknown-1');
      const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const commandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, commandId);
      // Deliberately NOT backdated past the grace window.

      const result = await dispatcher.sweepReconcile();
      expect(result.recovered).toBe(0);
      expect(result.stillPending).toBeGreaterThanOrEqual(1);

      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.status).toBe('queued_for_connector');
      expect(record.connectorSubmitCommandId).toBe(commandId); // unchanged
    });

    it('a stale unknown command is recovered: a NEW transport command, same externalOrderId, source/correlation preserved', async () => {
      const tableId = await createMappedTable('T-unknown-2');
      const menuItemId = await createMappedMenuItem('PLU-unknown-2');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const originalCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, originalCommandId);
      await makeStale(originalCommandId);

      const result = await dispatcher.sweepReconcile();
      expect(result.recovered).toBe(1);

      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.status).toBe('queued_for_connector');
      expect(record.connectorSubmitCommandId).not.toBe(originalCommandId); // a NEW transport id
      expect(record.attemptCount).toBe(2);

      const recoveryCommand = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: record.connectorSubmitCommandId! },
      });
      expect(recoveryCommand.idempotencyKey).toBe(`idealpos-submit-order:${orderId}:retry:1`);
      expect(recoveryCommand.sourceAggregateType).toBe('Order');
      expect(recoveryCommand.sourceRecordId).toBe(orderId);
      expect(recoveryCommand.correlationId).toBe(orderId);
      expect((recoveryCommand.payload as { externalOrderId: string }).externalOrderId).toBe(
        orderId,
      );

      // The ORIGINAL unknown command is untouched — never reopened, never
      // reassigned, permanently queryable for audit.
      const original = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: originalCommandId },
      });
      expect(original.status).toBe('unknown');
      const totalCommandsForOrder = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(totalCommandsForOrder).toBe(2); // both attempts remain, full audit history
    });

    it('a table/product mapping changed AFTER the unknown attempt does not alter the recovery payload — reused byte-for-byte', async () => {
      const tableId = await createMappedTable('T-unknown-3-original');
      const menuItemId = await createMappedMenuItem('PLU-unknown-3-original');
      const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const originalCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      const originalCommand = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: originalCommandId },
      });
      await driveToUnknown(sharedCredential, originalCommandId);
      await makeStale(originalCommandId);

      // Staff correct both mappings AFTER the ambiguous attempt.
      await prisma.table.update({
        where: { id: tableId },
        data: { posTableCode: 'T-unknown-3-CHANGED' },
      });
      await prisma.menuItem.update({
        where: { id: menuItemId },
        data: { posProductCode: 'PLU-unknown-3-CHANGED' },
      });

      await dispatcher.sweepReconcile();

      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      const recoveryCommand = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: record.connectorSubmitCommandId! },
      });
      // Byte-identical to the ORIGINAL stored payload — the changed
      // mappings never leaked in, because this path never re-reads them.
      expect(recoveryCommand.payload).toEqual(originalCommand.payload);
      expect((recoveryCommand.payload as { table: string }).table).toBe('T-unknown-3-original');
      expect(
        (recoveryCommand.payload as { items: Array<{ productCode: string }> }).items[0].productCode,
      ).toBe('PLU-unknown-3-original');
    });

    it('concurrency: two concurrent sweepReconcile calls on the same stale unknown create exactly one recovery command', async () => {
      const tableId = await createMappedTable('T-unknown-4');
      const menuItemId = await createMappedMenuItem('PLU-unknown-4');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const originalCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, originalCommandId);
      await makeStale(originalCommandId);

      const [r1, r2, r3] = await Promise.all([
        dispatcher.sweepReconcile(),
        dispatcher.sweepReconcile(),
        dispatcher.sweepReconcile(),
      ]);
      const totalRecovered = r1.recovered + r2.recovered + r3.recovered;
      expect(totalRecovered).toBe(1);

      const commandsForOrder = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(commandsForOrder).toBe(2); // original + exactly one recovery, never more

      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.attemptCount).toBe(2);
    });

    it('restart safety: a fresh dispatcher instance (no shared in-memory state) still recovers a persisted stale unknown', async () => {
      const tableId = await createMappedTable('T-unknown-5');
      const menuItemId = await createMappedMenuItem('PLU-unknown-5');
      const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const originalCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, originalCommandId);
      await makeStale(originalCommandId);

      // A genuinely separate instance — new `this`, no private fields
      // carried over — proving recovery depends only on persisted DB
      // state, exactly as a process restart would require.
      const restartedDispatcher = new IdealposOrderDispatcherService(
        prisma,
        commandService,
        app.get(OrdersGateway),
        config,
      );
      const result = await restartedDispatcher.sweepReconcile();
      expect(result.recovered).toBe(1);

      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.connectorSubmitCommandId).not.toBe(originalCommandId);
    });

    it('repeated unknown: unknown -> recovery -> unknown again increments attemptCount, bounded by the existing ceiling', async () => {
      const tableId = await createMappedTable('T-unknown-6');
      const menuItemId = await createMappedMenuItem('PLU-unknown-6');
      const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      let commandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, commandId);
      await makeStale(commandId);
      await dispatcher.sweepReconcile();

      let record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.attemptCount).toBe(2);
      commandId = record.connectorSubmitCommandId!;

      await driveToUnknown(sharedCredential, commandId);
      await makeStale(commandId);
      await dispatcher.sweepReconcile();

      record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(record.attemptCount).toBe(3);
      expect(record.status).toBe('queued_for_connector');
    });

    it('exhaustion: at the attempt ceiling, no further recovery command is created; the exhausted state is truthful and operator-visible', async () => {
      const tableId = await createMappedTable('T-unknown-7');
      const menuItemId = await createMappedMenuItem('PLU-unknown-7');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      let commandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;

      // IDEALPOS_DISPATCH_MAX_ATTEMPTS defaults to 5 — drive 5 unknown ->
      // recovery cycles; the 5th recovery attempt itself then also goes
      // unknown and is swept at the ceiling.
      for (let i = 0; i < 5; i++) {
        await driveToUnknown(sharedCredential, commandId);
        await makeStale(commandId);
        await dispatcher.sweepReconcile();
        const record = await prisma.pOSSyncRecord.findUniqueOrThrow({
          where: { id: syncRecordId },
        });
        if (record.status === 'failed') break;
        commandId = record.connectorSubmitCommandId!;
      }

      const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(final.status).toBe('failed');
      expect(final.retryExhaustedAt).not.toBeNull();
      expect(final.errorMessage).toContain('UNPROVEN');
      expect(final.errorMessage).toContain('unknown');
      // Never a fabricated definite native rejection.
      expect(final.errorMessage).not.toMatch(/rejected by IdealPOS/i);

      const noFurtherRecovery = await dispatcher.sweepReconcile();
      expect(noFurtherRecovery.recovered).toBe(0);
      const totalCommands = await prisma.connectorCommand.count({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(totalCommands).toBeLessThanOrEqual(5);
    });

    it('late original success races an in-flight recovery: rejected+audited, recovery still reaches submitted_awaiting_confirmation, no duplicate order', async () => {
      const tableId = await createMappedTable('T-unknown-8');
      const menuItemId = await createMappedMenuItem('PLU-unknown-8');
      const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

      await dispatcher.sweepDispatch();
      const originalCommandId = (
        await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } })
      ).connectorSubmitCommandId!;
      await driveToUnknown(sharedCredential, originalCommandId);
      await makeStale(originalCommandId);

      await dispatcher.sweepReconcile();
      const record = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      const recoveryCommandId = record.connectorSubmitCommandId!;
      expect(recoveryCommandId).not.toBe(originalCommandId);

      // The original connector reconnects and reports success — too late,
      // the command already left `accepted`.
      const lateReportRes = await request(app.getHttpServer())
        .post(`/api/connector/commands/${originalCommandId}/report`)
        .set('Authorization', `Bearer ${sharedCredential}`)
        .send({
          outcome: 'succeeded',
          resultType: 'bridge_accepted',
          resultPayload: { externalOrderId: orderId, duplicate: false },
          idempotencyKey: `late-report-${originalCommandId}`,
        })
        .expect(409);
      expect((lateReportRes.body as { message: string }).message).toContain('unknown');

      const lateAudit = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          action: 'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
          resourceId: originalCommandId,
        },
      });
      expect(lateAudit).toHaveLength(1);
      expect((lateAudit[0].after as { attemptedOutcome: string }).attemptedOutcome).toBe(
        'succeeded',
      );

      const originalAfterLateReport = await prisma.connectorCommand.findUniqueOrThrow({
        where: { id: originalCommandId },
      });
      expect(originalAfterLateReport.status).toBe('unknown'); // never mutated/resurrected

      // The recovery attempt reaches Bridge with the same externalOrderId
      // and gets a duplicate-safe success.
      await request(app.getHttpServer())
        .post('/api/connector/commands/poll')
        .set('Authorization', `Bearer ${sharedCredential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${recoveryCommandId}/accept`)
        .set('Authorization', `Bearer ${sharedCredential}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/connector/commands/${recoveryCommandId}/report`)
        .set('Authorization', `Bearer ${sharedCredential}`)
        .send({
          outcome: 'succeeded',
          resultType: 'bridge_accepted',
          resultPayload: { externalOrderId: orderId, duplicate: true },
          idempotencyKey: `report-${recoveryCommandId}`,
        })
        .expect(200);

      const reconcileResult = await dispatcher.sweepReconcile();
      expect(reconcileResult.confirmed).toBe(1);

      const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
      expect(final.status).toBe('submitted_awaiting_confirmation');
      expect((final.responsePayload as { duplicate: boolean }).duplicate).toBe(true);

      // Both transport attempts remain, both carry the identical
      // externalOrderId — never two logical IdealPOS orders.
      const commands = await prisma.connectorCommand.findMany({
        where: { sourceAggregateType: 'Order', sourceRecordId: orderId },
      });
      expect(commands).toHaveLength(2);
      for (const c of commands) {
        expect((c.payload as { externalOrderId: string }).externalOrderId).toBe(orderId);
      }
    });
  });
});

// Integration test against a REAL local Postgres and a REAL local HTTP
// server standing in for IdealposBridge — closes the one gap
// idealpos-order-dispatch.integration-spec.ts's "full round trip" test
// deliberately leaves open (it hand-crafts the connector's report body
// rather than actually calling anything shaped like Bridge). This file
// proves the full chain for real:
//
//   durable Order -> POSSyncRecord -> IdealposOrderDispatcherService
//   .sweepDispatch() -> ConnectorCommand (idealpos.submit_order.v1) -> the
//   real connector protocol (poll/accept/report, story 2-10, unchanged) ->
//   an HTTP call to a real local mock IdealposBridge server, using exactly
//   the wire shape VerduraIdealposTracer.Core.OrderSubmission.
//   IdealposBridgeClient sends (verified against apps/venue-connector's own
//   IdealposBridgeClientTests) -> a truthful report derived from that
//   response -> IdealposOrderDispatcherService.sweepReconcile() -> truthful
//   POSSyncRecord state.
//
// The connector role itself is played by this test file's own fetch calls
// (the actual .NET connector binary is Windows-only and cannot run in this
// environment — see apps/venue-connector/src/VerduraIdealposTracer.Cli's
// own .csproj doc comment) — but every request this file sends to the mock
// Bridge server, and every report it sends back to the real API, uses the
// exact field names/casing/resultType vocabulary the real C# handler uses,
// so this proves the real wire contract on both sides of the connector,
// even though the connector's own process is not itself under test here.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as argon2 from 'argon2';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { IdealposOrderDispatcherService } from '../src/pos-sync/idealpos-order-dispatcher.service';
import { IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE } from '../src/pos-sync/idealpos-order-dispatch.constants';

describe('IdealPOS order submission: real connector protocol + real mock Bridge HTTP hop (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: IdealposOrderDispatcherService;

  const TAG = 'idealpos-bridge-e2e-integration';

  let orgId: string;
  let venueId: string;
  let accessToken: string;
  let categoryId: string;

  // ── Mock IdealposBridge: a real local HTTP server, not a mock object ──
  let bridgeServer: http.Server;
  let bridgeBaseUrl: string;
  let bridgeRequests: Array<{ authorization: string | undefined; body: unknown }> = [];
  let bridgeRespondWith: (body: unknown) => { status: number; body: unknown } = (body) => {
    const externalOrderId = (body as { externalOrderId: string }).externalOrderId;
    const seen = seenExternalOrderIds.has(externalOrderId);
    seenExternalOrderIds.add(externalOrderId);
    return seen
      ? { status: 200, body: { duplicate: true, externalOrderId } }
      : { status: 201, body: { duplicate: false, externalOrderId } };
  };
  let seenExternalOrderIds: Set<string>;

  // One shared connector installation for every test in this file —
  // realistic (one venue enrolls its connector once, reuses it for many
  // orders) and keeps this file's use of the real /api/connector/enroll
  // endpoint (a deliberately tight production rate limit: 10 requests/900s,
  // connector-command.controller.ts — not relaxed for this test) well
  // within budget alongside sibling integration spec files sharing the
  // same continuous test process.
  let sharedCredential: string;

  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // This file drives IdealposOrderDispatcherService's sweepDispatch()/
    // sweepReconcile() explicitly and deterministically throughout — exactly
    // the pattern that service's own class doc comment describes tests
    // using. Its background timers are neither venue- nor test-file-scoped
    // (sweepReconcile's candidate query is global), so leaving them live
    // here would let this file's own AppModule instance race and reconcile
    // ConnectorCommand rows that OTHER integration spec files' own explicit
    // sweepReconcile() calls are asserting on, when the full integration
    // suite runs multiple spec files' AppModule instances concurrently
    // against the one shared disposable database. Scoped to this file only.
    process.env.NODE_ENV = 'test';
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

    await createOrgVenueOwner();
    sharedCredential = await enrollAndReportCapability();

    bridgeServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        let parsedBody: unknown = null;
        try {
          parsedBody = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          parsedBody = null;
        }
        bridgeRequests.push({ authorization: req.headers.authorization, body: parsedBody });
        const { status, body } = bridgeRespondWith(parsedBody);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => bridgeServer.listen(0, '127.0.0.1', resolve));
    const address = bridgeServer.address() as AddressInfo;
    bridgeBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    bridgeRequests = [];
    seenExternalOrderIds = new Set();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
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
    await prisma.staff.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
    await prisma.$disconnect();
    process.env.NODE_ENV = originalNodeEnv;
  });

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
  }

  async function createMappedTable(posTableCode: string): Promise<string> {
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

  async function createMappedMenuItem(posProductCode: string): Promise<string> {
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

  async function createOrderWithSyncRecord(params: {
    tableId: string;
    menuItemId: string;
    quantity?: number;
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
              selectedModifiers: [],
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
      .send({ version: '0.0.1-test', capabilities: { [IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE]: true } })
      .expect(200);
    return credential;
  }

  /**
   * Plays the connector's role for exactly the steps that matter here:
   * calls the REAL mock Bridge server with the EXACT wire shape
   * IdealposBridgeClient.cs sends, classifies the response with the same
   * three-value vocabulary the C# handler uses, and reports it through the
   * real protocol. Never invents a resultType outside that vocabulary.
   */
  async function simulateConnectorSubmitToBridge(
    credential: string,
    commandId: string,
    payload: {
      externalOrderId: string;
      table: string;
      items: Array<{ productCode: string; quantity: number }>;
    },
  ): Promise<{
    outcome: 'succeeded' | 'failed';
    resultType: string;
    duplicate?: boolean;
    httpStatus: number;
  }> {
    const bridgeRes = await fetch(`${bridgeBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-bridge-api-key' },
      body: JSON.stringify(payload),
    });
    const bridgeBody = (await bridgeRes.json().catch(() => null)) as { duplicate?: boolean } | null;

    const classification =
      bridgeRes.status === 200 || bridgeRes.status === 201
        ? { outcome: 'succeeded' as const, resultType: 'bridge_accepted' }
        : bridgeRes.status === 400
          ? { outcome: 'failed' as const, resultType: 'bridge_rejected' }
          : { outcome: 'failed' as const, resultType: 'bridge_unreachable_or_failed' };

    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/report`)
      .set('Authorization', `Bearer ${credential}`)
      .send({
        outcome: classification.outcome,
        resultType: classification.resultType,
        resultPayload: {
          externalOrderId: payload.externalOrderId,
          duplicate: bridgeBody?.duplicate ?? null,
          httpStatusCode: bridgeRes.status,
        },
        idempotencyKey: `idealpos-submit-order-report:${commandId}`,
      })
      .expect(200);

    return { ...classification, duplicate: bridgeBody?.duplicate, httpStatus: bridgeRes.status };
  }

  it('full round trip through a real mock Bridge HTTP server: exact wire shape, 201 create, truthful reconciliation', async () => {
    const tableId = await createMappedTable('T-bridge-e2e-1');
    const menuItemId = await createMappedMenuItem('PLU-bridge-e2e-1');
    const { orderId, syncRecordId } = await createOrderWithSyncRecord({
      tableId,
      menuItemId,
      quantity: 2,
    });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    expect(afterDispatch.status).toBe('queued_for_connector');
    const commandId = afterDispatch.connectorSubmitCommandId!;

    const credential = sharedCredential;
    const pollRes = await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    const claimed = pollRes.body.commands.find((c: { id: string }) => c.id === commandId);
    expect(claimed.commandType).toBe(IDEALPOS_SUBMIT_ORDER_COMMAND_TYPE);
    const payload = claimed.payload as {
      externalOrderId: string;
      table: string;
      items: Array<{ productCode: string; quantity: number }>;
    };
    expect(payload).toEqual({
      externalOrderId: orderId,
      table: 'T-bridge-e2e-1',
      items: [{ productCode: 'PLU-bridge-e2e-1', quantity: 2 }],
    });

    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);

    const result = await simulateConnectorSubmitToBridge(credential, commandId, payload);
    expect(result.outcome).toBe('succeeded');
    expect(result.httpStatus).toBe(201);
    expect(result.duplicate).toBe(false);

    // Verify the exact request the mock Bridge received — proves the wire
    // shape end to end, not just the in-process payload object.
    expect(bridgeRequests).toHaveLength(1);
    expect(bridgeRequests[0].authorization).toBe('Bearer test-bridge-api-key');
    expect(bridgeRequests[0].body).toEqual({
      externalOrderId: orderId,
      table: 'T-bridge-e2e-1',
      items: [{ productCode: 'PLU-bridge-e2e-1', quantity: 2 }],
    });

    const reconcileResult = await dispatcher.sweepReconcile();
    expect(reconcileResult.confirmed).toBeGreaterThanOrEqual(1);

    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(final.status).toBe('submitted_awaiting_confirmation');
    expect(final.status).not.toBe('synced'); // never the stronger claim this mechanism cannot make
    expect((final.responsePayload as { duplicate: boolean }).duplicate).toBe(false);
  });

  it('duplicate replay: a second submission for the same externalOrderId gets Bridge-side duplicate:true, never a second logical order', async () => {
    const tableId = await createMappedTable('T-bridge-e2e-2');
    const menuItemId = await createMappedMenuItem('PLU-bridge-e2e-2');
    const { orderId, syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    const commandId = afterDispatch.connectorSubmitCommandId!;
    const credential = sharedCredential;

    await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);

    const payload = {
      externalOrderId: orderId,
      table: 'T-bridge-e2e-2',
      items: [{ productCode: 'PLU-bridge-e2e-2', quantity: 1 }],
    };
    const first = await simulateConnectorSubmitToBridge(credential, commandId, payload);
    expect(first.httpStatus).toBe(201);
    expect(first.duplicate).toBe(false);

    // Simulate a retry hitting Bridge again with the identical
    // externalOrderId (e.g. a redelivered/replayed attempt) — Bridge's own
    // idempotency store, not this test, is what proves no second logical
    // order is ever created.
    const replayRes = await fetch(`${bridgeBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-bridge-api-key' },
      body: JSON.stringify(payload),
    });
    expect(replayRes.status).toBe(200);
    const replayBody = (await replayRes.json()) as { duplicate: boolean };
    expect(replayBody.duplicate).toBe(true);
    expect(bridgeRequests).toHaveLength(2);
    expect(bridgeRequests[0].body).toEqual(bridgeRequests[1].body); // byte-identical retry, same externalOrderId

    await dispatcher.sweepReconcile();
    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(final.status).toBe('submitted_awaiting_confirmation');
  });

  it('Bridge validation rejection (400) becomes a truthful, terminal failed POSSyncRecord via the real mock server', async () => {
    const tableId = await createMappedTable('T-bridge-e2e-3');
    const menuItemId = await createMappedMenuItem('PLU-bridge-e2e-3');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    const commandId = afterDispatch.connectorSubmitCommandId!;
    const credential = sharedCredential;

    bridgeRespondWith = () => ({
      status: 400,
      body: { error: 'validation_failed', errors: ['unknown table'] },
    });

    await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);

    const payload = {
      externalOrderId: afterDispatch.orderId,
      table: 'T-bridge-e2e-3',
      items: [{ productCode: 'PLU-bridge-e2e-3', quantity: 1 }],
    };
    const result = await simulateConnectorSubmitToBridge(credential, commandId, payload);
    expect(result.outcome).toBe('failed');
    expect(result.resultType).toBe('bridge_rejected');

    await dispatcher.sweepReconcile();
    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(final.status).toBe('failed');
  });

  it('Bridge response withheld past the connector timeout: no report is sent, POSSyncRecord stays queued_for_connector — never misreported as failed', async () => {
    const tableId = await createMappedTable('T-bridge-e2e-4');
    const menuItemId = await createMappedMenuItem('PLU-bridge-e2e-4');
    const { syncRecordId } = await createOrderWithSyncRecord({ tableId, menuItemId });

    await dispatcher.sweepDispatch();
    const afterDispatch = await prisma.pOSSyncRecord.findUniqueOrThrow({
      where: { id: syncRecordId },
    });
    const commandId = afterDispatch.connectorSubmitCommandId!;
    const credential = sharedCredential;

    await request(app.getHttpServer())
      .post('/api/connector/commands/poll')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/connector/commands/${commandId}/accept`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);

    // Deliberately never call the mock Bridge or /report at all — mirrors
    // IdealposBridgeClient's own timeout path (BridgeSubmissionAmbiguousException),
    // which the C# handler never converts into a report.

    const reconcileResult = await dispatcher.sweepReconcile();
    expect(reconcileResult.stillPending).toBeGreaterThanOrEqual(1);

    const final = await prisma.pOSSyncRecord.findUniqueOrThrow({ where: { id: syncRecordId } });
    expect(final.status).toBe('queued_for_connector'); // genuinely uncertain — never upgraded to failed or synced
  });
});

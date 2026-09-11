import { ConnectorCommandStatus, POSSyncStatus } from '@prisma/client';
import { ConnectorBridgeOrderStatusReader } from './connector-bridge-order-status.reader';
import { IdealposConfirmationService } from './idealpos-confirmation.service';
import {
  IDEALPOS_ORDER_STATUS_COMMAND_TYPE,
  IDEALPOS_ORDER_STATUS_RESULT_TYPE,
  buildOrderStatusIdempotencyKey,
} from './idealpos-order-status.constants';

const ORDER_ID = 'ORD-600003';
const VENUE_ID = 'venue-1';
const ORG_ID = 'org-1';

interface CommandRow {
  id: string;
  organizationId: string;
  venueId: string;
  commandType: string;
  idempotencyKey: string;
  sourceAggregateType: string | null;
  sourceRecordId: string | null;
  status: ConnectorCommandStatus;
  resultType: string | null;
  resultPayload: unknown;
  reportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An in-memory stand-in for the real Story 2-10 command protocol plus the
 * connector that services it. It reproduces the two properties the reader
 * actually depends on — the (organizationId, venueId, idempotencyKey)
 * unique constraint, and the fact that a probe only carries an answer once
 * a connector has reported one — so these tests exercise the genuine
 * Connector-mediated route rather than stubbing the reader itself.
 */
class FakeConnector {
  readonly commands: CommandRow[] = [];
  private seq = 0;
  createCalls = 0;

  readonly service = {
    createCommand: jest.fn(async (params: Record<string, unknown>) => {
      this.createCalls++;
      const existing = this.commands.find(
        (c) =>
          c.organizationId === params.organizationId &&
          c.venueId === params.venueId &&
          c.idempotencyKey === params.idempotencyKey,
      );
      // The real service catches P2002 and returns the existing row. That
      // is precisely what makes concurrent sweeps safe, so the fake must
      // behave the same way rather than throwing.
      if (existing) return { id: existing.id, status: existing.status };

      const now = new Date();
      const row: CommandRow = {
        id: `cmd-${++this.seq}`,
        organizationId: params.organizationId as string,
        venueId: params.venueId as string,
        commandType: params.commandType as string,
        idempotencyKey: params.idempotencyKey as string,
        sourceAggregateType: (params.sourceAggregateType as string) ?? null,
        sourceRecordId: (params.sourceRecordId as string) ?? null,
        status: ConnectorCommandStatus.pending,
        resultType: null,
        resultPayload: null,
        reportedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.commands.push(row);
      return { id: row.id, status: row.status };
    }),
  };

  /** Simulates the connector claiming, executing and reporting one probe. */
  report(
    commandId: string,
    status: ConnectorCommandStatus,
    resultType: string | null,
    resultPayload: unknown = null,
    reportedAt: Date = new Date(),
  ): void {
    const row = this.commands.find((c) => c.id === commandId);
    if (!row) throw new Error(`no such command ${commandId}`);
    row.status = status;
    row.resultType = resultType;
    row.resultPayload = resultPayload;
    row.reportedAt = reportedAt;
    row.updatedAt = reportedAt;
  }

  /** The most recently created probe. */
  get latest(): CommandRow {
    return this.commands[this.commands.length - 1];
  }
}

const bridgeBody = (over: Record<string, unknown> = {}) => ({
  externalOrderId: ORDER_ID,
  status: 'submitted_to_idealpos',
  table: '12',
  posServerPendingSaleCode: null,
  tableMatchesRequest: null,
  tableAssignedNatively: false,
  lastError: null,
  ...over,
});

const assignedBody = (over: Record<string, unknown> = {}) =>
  bridgeBody({
    status: 'assigned_to_table',
    posServerPendingSaleCode: '12',
    tableMatchesRequest: true,
    ...over,
  });

function makePrisma(connector: FakeConnector, orderCreatedAt = new Date()) {
  return {
    connectorCommand: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const rows = connector.commands.filter(
          (c) =>
            c.commandType === args.where.commandType &&
            c.sourceAggregateType === args.where.sourceAggregateType &&
            c.sourceRecordId === args.where.sourceRecordId,
        );
        // orderBy createdAt desc
        return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),
    },
    order: {
      findUnique: jest.fn(async () => ({
        id: ORDER_ID,
        createdAt: orderCreatedAt,
        venueId: VENUE_ID,
        venue: { organizationId: ORG_ID },
      })),
    },
  };
}

const config = (over: Record<string, string> = {}) => ({
  get: (key: string) => over[key],
});

function makeReader(connector: FakeConnector, prisma: unknown, over: Record<string, string> = {}) {
  return new ConnectorBridgeOrderStatusReader(
    prisma as never,
    connector.service as never,
    config(over) as never,
  );
}

describe('ConnectorBridgeOrderStatusReader (Connector-mediated transport)', () => {
  it('enqueues a probe on first read and reports "no answer yet" rather than guessing', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));

    const outcome = await reader.read(ORDER_ID);

    expect(outcome.kind).toBe('unavailable');
    expect(connector.commands).toHaveLength(1);
    expect(connector.latest.commandType).toBe(IDEALPOS_ORDER_STATUS_COMMAND_TYPE);
    expect(connector.latest.idempotencyKey).toBe(buildOrderStatusIdempotencyKey(ORDER_ID, 0));
    // The probe must carry no order data beyond the id it reads.
    expect(connector.service.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { externalOrderId: ORDER_ID } }),
    );
  });

  it('does not enqueue a second probe while one is still in flight', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));

    await reader.read(ORDER_ID);
    const second = await reader.read(ORDER_ID);

    expect(connector.commands).toHaveLength(1);
    expect(second.kind).toBe('unavailable');
    if (second.kind === 'unavailable') expect(second.reason).toContain('in flight');
  });

  it('returns the Bridge body verbatim once the connector reports it', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));

    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { externalOrderId: ORDER_ID, body: assignedBody() },
    );

    const outcome = await reader.read(ORDER_ID);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.body.status).toBe('assigned_to_table');
      expect(outcome.body.posServerPendingSaleCode).toBe('12');
    }
  });

  it('maps a 404 report to notFound — a real answer, never a failure', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_NOT_FOUND,
      { externalOrderId: ORDER_ID },
    );

    expect((await reader.read(ORDER_ID)).kind).toBe('notFound');
  });

  it('maps an unreachable Bridge to unavailable', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.failed,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_UNREACHABLE_OR_FAILED,
    );

    expect((await reader.read(ORDER_ID)).kind).toBe('unavailable');
  });

  it('maps an unreadable Bridge body to malformed', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.failed,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_STATUS_UNREADABLE,
    );

    expect((await reader.read(ORDER_ID)).kind).toBe('malformed');
  });

  it('treats a bridge_order_status report with no body as malformed, never as an empty record', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { externalOrderId: ORDER_ID },
    );

    const outcome = await reader.read(ORDER_ID);
    expect(outcome.kind).toBe('malformed');
  });

  it('refuses to interpret a succeeded probe carrying an unrecognised resultType', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      'bridge_says_definitely_confirmed_trust_me',
      { body: assignedBody() },
    );

    const outcome = await reader.read(ORDER_ID);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('unrecognised resultType');
  });

  it.each([
    ConnectorCommandStatus.expired,
    ConnectorCommandStatus.unknown,
    ConnectorCommandStatus.cancelled,
  ])('a probe that ended %s yields no evidence', async (status) => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));
    await reader.read(ORDER_ID);
    connector.report(connector.latest.id, status, null);

    expect((await reader.read(ORDER_ID)).kind).toBe('unavailable');
  });

  it('re-probes once a terminal result has gone stale, with a fresh attempt-qualified key', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector), {
      IDEALPOS_ORDER_STATUS_RESULT_FRESHNESS_MS: '1',
    });

    await reader.read(ORDER_ID);
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.failed,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_UNREACHABLE_OR_FAILED,
      null,
      new Date(Date.now() - 60_000),
    );

    await reader.read(ORDER_ID);

    expect(connector.commands).toHaveLength(2);
    expect(connector.commands[1].idempotencyKey).toBe(buildOrderStatusIdempotencyKey(ORDER_ID, 1));
  });

  it('two concurrent sweeps create exactly ONE probe (idempotency-key collision)', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector));

    await Promise.all([reader.read(ORDER_ID), reader.read(ORDER_ID)]);

    // Both computed attempt 0 and therefore the same key; the unique
    // constraint collapsed them into one durable probe.
    expect(connector.createCalls).toBe(2);
    expect(connector.commands).toHaveLength(1);
  });

  it('stops probing at the attempt cap instead of growing commands without bound', async () => {
    const connector = new FakeConnector();
    const reader = makeReader(connector, makePrisma(connector), {
      IDEALPOS_ORDER_STATUS_RESULT_FRESHNESS_MS: '0',
      IDEALPOS_ORDER_STATUS_MAX_PROBES: '2',
    });

    for (let i = 0; i < 5; i++) {
      await reader.read(ORDER_ID);
      const latest = connector.latest;
      if (latest.status === ConnectorCommandStatus.pending) {
        connector.report(
          latest.id,
          ConnectorCommandStatus.failed,
          IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_UNREACHABLE_OR_FAILED,
          null,
          new Date(Date.now() - 60_000),
        );
      }
    }

    expect(connector.commands).toHaveLength(2);
    const outcome = await reader.read(ORDER_ID);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('cap reached');
  });

  it('stops probing for an order older than the probe window', async () => {
    const connector = new FakeConnector();
    const prisma = makePrisma(connector, new Date(Date.now() - 48 * 60 * 60 * 1000));
    const reader = makeReader(connector, prisma, {
      IDEALPOS_ORDER_STATUS_PROBE_WINDOW_MS: String(60 * 60 * 1000),
    });

    const outcome = await reader.read(ORDER_ID);
    expect(connector.commands).toHaveLength(0);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('probe window');
  });

  it('never throws — a transport fault degrades to unavailable', async () => {
    const connector = new FakeConnector();
    const prisma = {
      connectorCommand: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
      order: { findUnique: jest.fn() },
    };
    const reader = makeReader(connector, prisma);

    const outcome = await reader.read(ORDER_ID);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('db down');
  });
});

/**
 * End-to-end through the real transport: the confirmation sweep, the real
 * reader, and a simulated connector — no stubbed reader anywhere. This is
 * what proves the wiring, not just the pieces.
 */
describe('sweepConfirm through the Connector-mediated transport', () => {
  const record = { id: 'psr-1', orderId: ORDER_ID, venueId: VENUE_ID, posTableId: null };

  function harness(posTableCode: string | null = '12') {
    const connector = new FakeConnector();
    const syncRows = [{ ...record, status: POSSyncStatus.submitted_awaiting_confirmation }];

    const prisma = {
      ...makePrisma(connector),
      pOSSyncRecord: {
        // Faithful `count` over the same in-memory rows the sweep pages
        // through -- it drives the rotating offset (see sweepConfirm). With a
        // single awaiting row the sweep stays on the skip:0 path, so these
        // end-to-end assertions are unaffected by rotation.
        count: jest.fn(
          async () =>
            syncRows.filter((r) => r.status === POSSyncStatus.submitted_awaiting_confirmation)
              .length,
        ),
        findMany: jest.fn(async () =>
          syncRows
            .filter((r) => r.status === POSSyncStatus.submitted_awaiting_confirmation)
            .map((r) => ({
              id: r.id,
              orderId: r.orderId,
              venueId: r.venueId,
              posTableId: r.posTableId,
            })),
        ),
        // Faithful guarded updateMany: only applies while the row is still
        // awaiting, which is what makes terminal states irreversible.
        updateMany: jest.fn(
          async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const row = syncRows.find(
              (r) => r.id === args.where.id && r.status === args.where.status,
            );
            if (!row) return { count: 0 };
            Object.assign(row, args.data);
            return { count: 1 };
          },
        ),
      },
    };
    // The confirmation service resolves the requested table via order.findUnique.
    prisma.order.findUnique = jest.fn(async (args: { select?: Record<string, unknown> }) => {
      if (args?.select && 'table' in args.select) {
        return posTableCode === null ? { table: null } : { table: { posTableCode } };
      }
      return {
        id: ORDER_ID,
        createdAt: new Date(),
        venueId: VENUE_ID,
        venue: { organizationId: ORG_ID },
      };
    }) as never;

    const reader = makeReader(connector, prisma);
    const svc = new IdealposConfirmationService(prisma as never, reader);
    return { connector, prisma, svc, syncRows };
  }

  it('first sweep enqueues a probe and changes nothing', async () => {
    const { connector, svc, syncRows } = harness();

    const r = await svc.sweepConfirm();

    expect(r.examined).toBe(1);
    expect(r.unchanged).toBe(1);
    expect(r.confirmed).toBe(0);
    expect(connector.commands).toHaveLength(1);
    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
  });

  // FAIL-CLOSED (2026-09-04). The connector-mediated route is a second way to
  // reach the same decision function, so it must fail closed identically:
  // a matching observed table code is correlation, not causation, and an
  // unrelated walk-in on the same table is modelled (from source, not from a
  // live capture) to produce the same report.
  it('a matching observed table code corroborates but never confirms', async () => {
    const { connector, svc, syncRows } = harness();

    await svc.sweepConfirm();
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: assignedBody() },
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(r.unchanged).toBe(1);
    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
  });

  it('no sequence of connector reports can reach synced', async () => {
    const { connector, svc, syncRows } = harness();
    const nonRejecting = [
      'received',
      'validated',
      'submitted_to_idealpos',
      'pending_idealpos_processing',
      'processed',
      'anchored_in_idealpos',
      'assigned_to_table',
      'uncertain',
      'paid',
      'closed',
    ];

    for (const status of nonRejecting) {
      await svc.sweepConfirm();
      const latest = connector.latest;
      if (latest.status === ConnectorCommandStatus.pending) {
        connector.report(
          latest.id,
          ConnectorCommandStatus.succeeded,
          IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
          { body: assignedBody({ status }) },
        );
      }
      await svc.sweepConfirm();
      expect(syncRows[0].status).not.toBe(POSSyncStatus.synced);
    }
  });

  it('repeated sweeps after confirmation are idempotent and cannot regress a terminal state', async () => {
    const { connector, svc, syncRows } = harness();
    await svc.sweepConfirm();
    // A real terminal outcome: an explicit Bridge rejection. (Table
    // corroboration deliberately no longer transitions anything, so it cannot
    // be used to drive a record terminal in this test.)
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: bridgeBody({ status: 'rejected', lastError: 'bad PLU' }) },
    );
    await svc.sweepConfirm();

    // A later, contradicting report arrives; the record is already terminal.
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: assignedBody() },
    );

    const r = await svc.sweepConfirm();

    expect(r.examined).toBe(0); // no longer selected at all
    expect(syncRows[0].status).toBe(POSSyncStatus.failed);
  });

  it('a mismatched observed table never confirms', async () => {
    const { connector, svc, syncRows } = harness();
    await svc.sweepConfirm();
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: assignedBody({ posServerPendingSaleCode: '7' }) },
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
  });

  it('never falls back from posTableCode to tableNumber: an unmapped table cannot confirm', async () => {
    const { connector, svc, syncRows } = harness(null);
    await svc.sweepConfirm();
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: assignedBody() },
    );

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
  });

  it('a connector restart mid-probe (command expired) re-probes rather than fabricating an outcome', async () => {
    const { connector, svc, syncRows } = harness();
    await svc.sweepConfirm();
    // The connector died holding the claim; the server-side sweeper expired it.
    connector.report(connector.latest.id, ConnectorCommandStatus.expired, null, null, new Date(0));

    const r = await svc.sweepConfirm();

    expect(r.confirmed).toBe(0);
    expect(r.failed).toBe(0);
    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
    expect(connector.commands).toHaveLength(2); // a fresh probe was raised
  });

  it('a duplicate report of the same probe yields the same decision (no double transition)', async () => {
    const { connector, svc, syncRows } = harness();
    await svc.sweepConfirm();
    const probeId = connector.latest.id;
    const payload = { body: bridgeBody({ status: 'rejected', lastError: 'bad PLU' }) };
    connector.report(
      probeId,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      payload,
    );

    const first = await svc.sweepConfirm();
    // Connector replays the identical report after a dropped HTTP response.
    connector.report(
      probeId,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      payload,
    );
    const second = await svc.sweepConfirm();

    expect(first.failed).toBe(1);
    expect(second.failed).toBe(0);
    expect(second.examined).toBe(0);
    expect(syncRows[0].status).toBe(POSSyncStatus.failed);
  });

  it('concurrent sweeps apply a terminal transition exactly once', async () => {
    const { connector, svc, syncRows } = harness();
    await svc.sweepConfirm();
    connector.report(
      connector.latest.id,
      ConnectorCommandStatus.succeeded,
      IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_ORDER_STATUS,
      { body: bridgeBody({ status: 'rejected', lastError: 'bad PLU' }) },
    );

    const [a, b] = await Promise.all([svc.sweepConfirm(), svc.sweepConfirm()]);

    expect(a.failed + b.failed).toBe(1);
    expect(a.raced + b.raced).toBe(1);
    expect(syncRows[0].status).toBe(POSSyncStatus.failed);
  });

  it('a Bridge outage across many sweeps never manufactures a confirmation', async () => {
    const { connector, svc, syncRows } = harness();

    for (let i = 0; i < 4; i++) {
      await svc.sweepConfirm();
      const latest = connector.latest;
      if (latest.status === ConnectorCommandStatus.pending) {
        connector.report(
          latest.id,
          ConnectorCommandStatus.failed,
          IDEALPOS_ORDER_STATUS_RESULT_TYPE.BRIDGE_UNREACHABLE_OR_FAILED,
          null,
          new Date(Date.now() - 60_000),
        );
      }
    }

    expect(syncRows[0].status).toBe(POSSyncStatus.submitted_awaiting_confirmation);
  });
});

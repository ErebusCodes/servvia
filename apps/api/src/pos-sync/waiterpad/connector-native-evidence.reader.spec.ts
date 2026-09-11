/**
 * THE READER CAN INVENT IGNORANCE. IT MUST NEVER INVENT ABSENCE.
 *
 * Those are the two claims this file exists to separate. Returning `{}` says
 * "we did not look", which the predicate reads as ignorance: it confirms
 * nothing and releases nothing, and the sweep simply comes back next tick.
 * Returning `storedTokenForDevice: null` says "we looked and the till holds no
 * token for this device" — a fact that, alongside "nothing was processed", is
 * strong enough to RELEASE A ROUND'S LINES and let its food go to the kitchen a
 * second time.
 *
 * So every outage, every failed probe, every shape this build does not
 * recognise, must land in the first bucket. That is asserted here case by case
 * rather than argued in a comment, and the last describe block attacks the
 * parser directly, because it is the single place where a connector's words
 * become evidence.
 */

import { ConnectorCommandStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import {
  ConnectorNativeEvidenceReader,
  parseEvidencePayload,
} from './connector-native-evidence.reader';
import {
  buildNativeEvidenceIdempotencyKey,
  NATIVE_ROUND_EVIDENCE_COMMAND_TYPE,
  NATIVE_ROUND_EVIDENCE_REQUIRED_CAPABILITY,
  NATIVE_ROUND_EVIDENCE_RESULT_TYPE,
} from './native-round-evidence.constants';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConnectorCommandService } from '../../connector/connector-command.service';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

const TOKEN = 'a'.repeat(32);

const RECORD: SendInitiatedRecord = {
  roundId: 'round-1',
  attemptId: 'attempt-1',
  externalOrderId: 'order-1',
  table: 5,
  deviceId: 'VERDURA-PROD-0001',
  token: TOKEN,
  payloadHash: 'h'.repeat(64),
  sendInitiatedAt: new Date(),
  expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
};

type Probe = {
  id: string;
  status: ConnectorCommandStatus;
  resultType: string | null;
  resultPayload: unknown;
  reportedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

interface Harness {
  reader: ConnectorNativeEvidenceReader;
  created: { idempotencyKey: string; payload: Record<string, unknown>; commandType: string }[];
}

function build(probes: Probe[] = [], opts: { venue?: boolean } = {}): Harness {
  const created: Harness['created'] = [];

  const prisma = {
    connectorCommand: { findMany: () => Promise.resolve(probes) },
    nativeTableRound: { findUnique: () => Promise.resolve({ venueId: 'venue-1' }) },
    venue: {
      findUnique: () => Promise.resolve(opts.venue === false ? null : { organizationId: 'org-1' }),
    },
  } as unknown as PrismaService;

  const commands = {
    createCommand: (args: {
      idempotencyKey: string;
      payload: Record<string, unknown>;
      commandType: string;
    }) => {
      created.push(args);
      return Promise.resolve({ id: `cmd-${created.length}` });
    },
  } as unknown as ConnectorCommandService;

  const reader = new ConnectorNativeEvidenceReader(prisma, commands, new ConfigService({}));
  return { reader, created };
}

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    id: 'cmd-1',
    status: ConnectorCommandStatus.succeeded,
    resultType: NATIVE_ROUND_EVIDENCE_RESULT_TYPE.NATIVE_EVIDENCE,
    resultPayload: { storedTokenForDevice: TOKEN },
    reportedAt: new Date(),
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('enqueueing a probe', () => {
  it('asks the connector and reports nothing learned yet', async () => {
    const h = build([]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence).toEqual({});
    expect(h.created).toHaveLength(1);
    expect(h.created[0].commandType).toBe(NATIVE_ROUND_EVIDENCE_COMMAND_TYPE);
  });

  it('keys the probe by ATTEMPT, because the token row is one-deep per device', async () => {
    const h = build([]);

    await h.reader.readEvidence(RECORD);

    expect(h.created[0].idempotencyKey).toBe(
      buildNativeEvidenceIdempotencyKey(RECORD.attemptId, 0),
    );
  });

  it('carries only the table and the device — no order content of any kind', async () => {
    const h = build([]);

    await h.reader.readEvidence(RECORD);

    expect(h.created[0].payload).toEqual({ posTableCode: '5', deviceId: RECORD.deviceId });
  });

  it('carries the baseline map so both terms of the delta share a table context', async () => {
    const h = build([]);

    await h.reader.readEvidence({
      ...RECORD,
      preSendBaseline: { status: 'observed', tableCode: '5', pos: 1, map: '1', lines: [] },
    });

    expect(h.created[0].payload.map).toBe('1');
  });

  it('does not invent a map when the baseline never observed one', async () => {
    const h = build([]);

    await h.reader.readEvidence({
      ...RECORD,
      preSendBaseline: { status: 'noOpenSale', reason: 'free' },
    });

    // Absent, so the connector uses its CONFIGURED map or fails closed. It must
    // never guess: map 0 is the web/takeaway partition.
    expect('map' in h.created[0].payload).toBe(false);
  });

  it('learns nothing and creates nothing when the venue cannot be resolved', async () => {
    const h = build([], { venue: false });

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence).toEqual({});
    expect(h.created).toHaveLength(0);
  });

  it('does not enqueue a second probe while one is in flight', async () => {
    const h = build([probe({ status: ConnectorCommandStatus.claimed })]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence).toEqual({});
    expect(h.created).toHaveLength(0);
  });

  it('stops probing once the attempt is older than the probe window', async () => {
    const h = build([]);

    const evidence = await h.reader.readEvidence({
      ...RECORD,
      sendInitiatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(evidence).toEqual({});
    expect(h.created).toHaveLength(0);
  });
});

describe('interpreting a probe that came back', () => {
  it('reports the token the connector actually read', async () => {
    const h = build([probe({ resultPayload: { storedTokenForDevice: TOKEN } })]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence.storedTokenForDevice).toBe(TOKEN);
  });

  it('reports a genuine absence as null, because the connector looked', async () => {
    const h = build([
      probe({ resultPayload: { storedTokenForDevice: null, processedForTableAfterSend: false } }),
    ]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence.storedTokenForDevice).toBeNull();
    expect(evidence.processedForTableAfterSend).toBe(false);
  });

  it('reports an observed table with its lines', async () => {
    const h = build([
      probe({
        resultPayload: {
          storedTokenForDevice: TOKEN,
          currentTable: {
            status: 'observed',
            tableCode: '5',
            pos: 1,
            map: '1',
            lines: [{ nativeCode: 'PLU1', quantity: 2 }],
          },
        },
      }),
    ]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence.currentTable).toEqual({
      status: 'observed',
      tableCode: '5',
      pos: 1,
      map: '1',
      lines: [{ nativeCode: 'PLU1', quantity: 2 }],
    });
  });

  it('re-probes rather than reusing a stale terminal result', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    const h = build([probe({ reportedAt: old, updatedAt: old })]);

    const evidence = await h.reader.readEvidence(RECORD);

    expect(evidence).toEqual({});
    expect(h.created).toHaveLength(1);
  });
});

describe('a probe that did not succeed teaches nothing', () => {
  it.each([
    ConnectorCommandStatus.failed,
    ConnectorCommandStatus.expired,
    ConnectorCommandStatus.unknown,
    ConnectorCommandStatus.cancelled,
  ])('a %s probe yields ignorance, not an absent token', async (status) => {
    const h = build([probe({ status, resultPayload: { storedTokenForDevice: null } })]);

    const evidence = await h.reader.readEvidence(RECORD);

    // Emphatically NOT `{ storedTokenForDevice: null }`. That, with
    // `processedForTableAfterSend: false`, would release a round's lines.
    expect(evidence).toEqual({});
    expect('storedTokenForDevice' in evidence).toBe(false);
  });

  it.each([
    NATIVE_ROUND_EVIDENCE_RESULT_TYPE.EVIDENCE_READER_UNCONFIGURED,
    NATIVE_ROUND_EVIDENCE_RESULT_TYPE.EVIDENCE_UNAVAILABLE,
    NATIVE_ROUND_EVIDENCE_RESULT_TYPE.CONNECTOR_PAYLOAD_INVALID,
  ])('a succeeded probe reporting %s yields ignorance', async (resultType) => {
    const h = build([probe({ resultType, resultPayload: { storedTokenForDevice: null } })]);

    expect(await h.reader.readEvidence(RECORD)).toEqual({});
  });

  it('refuses a resultType this build does not recognise', async () => {
    // A FUTURE connector must not be able to widen what counts as evidence
    // without this build agreeing to it.
    const h = build([
      probe({
        resultType: 'native_evidence_v2_probably_fine',
        resultPayload: { storedTokenForDevice: TOKEN },
      }),
    ]);

    expect(await h.reader.readEvidence(RECORD)).toEqual({});
  });

  it('degrades to ignorance rather than throwing when the database fails', async () => {
    const prisma = {
      connectorCommand: {
        findMany: () => Promise.reject(new Error('connection pool exhausted')),
      },
    } as unknown as PrismaService;
    const reader = new ConnectorNativeEvidenceReader(
      prisma,
      { createCommand: () => Promise.resolve({ id: 'x' }) } as unknown as ConnectorCommandService,
      new ConfigService({}),
    );

    await expect(reader.readEvidence(RECORD)).resolves.toEqual({});
  });
});

describe('parsing what the connector said', () => {
  it('never takes the round own terms from the connector', () => {
    const parsed = parseEvidencePayload({
      storedTokenForDevice: TOKEN,
      // A hostile or buggy connector offering the values it is checked against.
      preSendTable: { status: 'noOpenSale' },
      expectedItems: [{ nativeCode: 'PLU1', quantity: 1 }],
    });

    expect(parsed.storedTokenForDevice).toBe(TOKEN);
    expect(parsed.preSendTable).toBeUndefined();
    expect(parsed.expectedItems).toBeUndefined();
  });

  it.each([null, undefined, 'a string', 42, [], true])(
    'a payload of %p yields nothing at all',
    (payload) => {
      expect(parseEvidencePayload(payload)).toEqual({});
    },
  );

  it.each([42, {}, [], true])('a stored token of %p is dropped rather than coerced', (value) => {
    expect('storedTokenForDevice' in parseEvidencePayload({ storedTokenForDevice: value })).toBe(
      false,
    );
  });

  it('keeps the literal text "null", which is a value a column can hold', () => {
    // Distinct from JSON null. The till holding the four characters n-u-l-l is
    // a stored value like any other, and it matches no attempt token.
    expect(parseEvidencePayload({ storedTokenForDevice: 'null' }).storedTokenForDevice).toBe(
      'null',
    );
  });

  it('keeps the empty string, which is what a freshly inserted row holds', () => {
    // `IsDuplicateHandheldOrder2` INSERTs Data='' the first time it sees a
    // device. "Known, no checksum stored" is a real state and matches no token.
    expect(parseEvidencePayload({ storedTokenForDevice: '' }).storedTokenForDevice).toBe('');
  });

  it('drops a snapshot whose status is not one of the four', () => {
    expect(
      parseEvidencePayload({ currentTable: { status: 'probably_fine' } }).currentTable,
    ).toBeUndefined();
  });

  it.each([
    [{ status: 'observed', lines: 'not an array' }],
    [{ status: 'observed' }],
    [{ status: 'observed', lines: [{ nativeCode: 'A' }] }],
    [{ status: 'observed', lines: [{ nativeCode: 'A', quantity: 0 }] }],
    [{ status: 'observed', lines: [{ nativeCode: 'A', quantity: -1 }] }],
    [{ status: 'observed', lines: [{ nativeCode: 'A', quantity: 1.5 }] }],
    [{ status: 'observed', lines: [{ nativeCode: '', quantity: 1 }] }],
    [{ status: 'observed', lines: [{ nativeCode: 'A', quantity: 1 }, 'junk'] }],
  ])(
    'an observed table with an unreadable line list becomes UNAVAILABLE, never empty (%p)',
    (currentTable) => {
      const parsed = parseEvidencePayload({ currentTable });

      // The dangerous coercion would be `lines: []`. An empty table makes every
      // line of a real round look new, which is how a round that never landed
      // gets confirmed.
      expect(parsed.currentTable?.status).toBe('unavailable');
      expect(parsed.currentTable?.lines).toBeUndefined();
    },
  );

  it('accepts a genuinely empty observed table, which is a real state', () => {
    const parsed = parseEvidencePayload({
      currentTable: { status: 'observed', tableCode: '5', pos: 1, lines: [] },
    });

    expect(parsed.currentTable?.status).toBe('observed');
    expect(parsed.currentTable?.lines).toEqual([]);
  });

  it('keeps the three non-observed statuses as themselves', () => {
    for (const status of ['noOpenSale', 'ambiguous', 'unavailable'] as const) {
      expect(parseEvidencePayload({ currentTable: { status } }).currentTable?.status).toBe(status);
    }
  });

  it('drops a non-integer pos rather than rounding it', () => {
    const parsed = parseEvidencePayload({
      currentTable: { status: 'observed', pos: 1.5, lines: [] },
    });
    expect(parsed.currentTable?.pos).toBeUndefined();
  });

  it.each(['not a boolean', 1, null])(
    'drops a processedForTableAfterSend of %p rather than coercing it',
    (value) => {
      expect(
        'processedForTableAfterSend' in parseEvidencePayload({ processedForTableAfterSend: value }),
      ).toBe(false);
    },
  );
});

describe('the command contract', () => {
  it('requires a capability no current connector build advertises', () => {
    // Binding this reader in a build whose connector cannot answer is
    // harmless: every probe expires, every probe yields ignorance, and rounds
    // escalate to a human exactly as they do today.
    expect(NATIVE_ROUND_EVIDENCE_REQUIRED_CAPABILITY).toBe(NATIVE_ROUND_EVIDENCE_COMMAND_TYPE);
  });

  it('gives successive probes for one attempt distinct keys', () => {
    expect(buildNativeEvidenceIdempotencyKey('a1', 0)).not.toBe(
      buildNativeEvidenceIdempotencyKey('a1', 1),
    );
  });

  it('gives two attempts distinct keys, so one probe never answers for another', () => {
    expect(buildNativeEvidenceIdempotencyKey('a1', 0)).not.toBe(
      buildNativeEvidenceIdempotencyKey('a2', 0),
    );
  });
});

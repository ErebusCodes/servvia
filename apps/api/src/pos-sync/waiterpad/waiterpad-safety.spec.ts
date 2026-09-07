/**
 * Checksum, readback, gate — and the standing proof that nothing here can talk
 * to a till.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertChecksumProviderUsable,
  checksumFromObservedEvidence,
  UnresolvedChecksumProvider,
  WaiterPadChecksumUnavailableError,
  type WaiterPadChecksumProvider,
} from './waiterpad-checksum';
import {
  CHECKSUM_ALGORITHM_EVIDENCE,
  CHECKSUM_LOG_LINE_EVIDENCE,
  CHECKSUM_NO_GENERATOR_EVIDENCE,
  CHECKSUM_STORAGE_DUALITY_EVIDENCE,
  DEVICE_REGISTRATION_EVIDENCE,
  RECOVERY_CAUSAL_TOKEN_EVIDENCE,
  RELAY_DELETE_REWRITE_EVIDENCE,
  RELAY_PATH_CHAIN_EVIDENCE,
  NAKREGO_EMPTY_BODY_EVIDENCE,
  HANDHELD_LOG_LOCATION_EVIDENCE,
  IPS_AND_IPSWORKER_SAME_IMAGE,
  NAK_ON_HANDHELD_PROCESSING,
  PORT_FAMILY_EVIDENCE,
  RELAY_TRIGGER_EVIDENCE,
  SILENT_DROP_GATES,
  WAITERPAD_PORT,
  type EvidenceNote,
} from './waiterpad-evidence';
import {
  assertNoTransportAvailable,
  assertWaiterPadCertified,
  checkWaiterPadCertification,
  WaiterPadNotCertifiedError,
  WaiterPadTransportUnavailableError,
  WAITERPAD_CERTIFICATION_ENV_KEY,
} from './waiterpad-gate';
import { nativeResolvedPriceFromReadback, readbackPriceLooksUnresolved } from './waiterpad-price';
import {
  parseTableStatusResponse,
  serialiseTableStatusRequest,
  WaiterPadTableStatusError,
} from './waiterpad-table-status';

const AT = new Date('2026-09-07T00:30:00Z');

describe('checksum generation is unresolved, and stays that way', () => {
  it('is recorded as NOT_SHOWN in the evidence ledger', () => {
    expect(CHECKSUM_ALGORITHM_EVIDENCE.grade).toBe('NOT_SHOWN');
  });

  it('the only shipped provider throws', () => {
    const p = new UnresolvedChecksumProvider();
    expect(() =>
      p.generate({
        deviceId: 'D',
        roundIdempotencyKey: 'idem-1',
        serialisedOrderPacket: '<WPPacket/>',
      }),
    ).toThrow(WaiterPadChecksumUnavailableError);
  });

  it('explains that a deterministic Verdura hash is not a WaiterPad checksum', () => {
    const p = new UnresolvedChecksumProvider();
    try {
      p.generate({ deviceId: 'D', roundIdempotencyKey: 'k', serialisedOrderPacket: '' });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/not a WaiterPad checksum/);
    }
  });

  it('is not marked evidence-backed', () => {
    expect(new UnresolvedChecksumProvider().isEvidenceBacked).toBe(false);
  });

  it('the submission guard refuses a provider that is not evidence-backed', () => {
    expect(() => assertChecksumProviderUsable(new UnresolvedChecksumProvider())).toThrow(
      /not evidence-backed/,
    );
  });

  it('the guard would accept a provider once one is evidence-backed', () => {
    const hypothetical: WaiterPadChecksumProvider = {
      providerId: 'from-captured-log',
      isEvidenceBacked: true,
      generate: () => checksumFromObservedEvidence('X'),
    };
    expect(() => assertChecksumProviderUsable(hypothetical)).not.toThrow();
  });

  describe('checksumFromObservedEvidence — the evidence-only door', () => {
    it('accepts a plausible observed value', () => {
      expect(checksumFromObservedEvidence('ABC123')).toBe('ABC123');
    });

    it('rejects empty and non-string values', () => {
      expect(() => checksumFromObservedEvidence('')).toThrow(WaiterPadChecksumUnavailableError);
      expect(() => checksumFromObservedEvidence(null as unknown as string)).toThrow();
    });

    it('rejects XML metacharacters rather than escaping them', () => {
      for (const bad of ['<x', 'a&b', "a'b", 'a"b', 'a>b']) {
        expect(() => checksumFromObservedEvidence(bad)).toThrow(/metacharacters/);
      }
    });

    it('rejects an implausibly long value', () => {
      expect(() => checksumFromObservedEvidence('x'.repeat(200))).toThrow(/implausibly long/);
    });
  });
});

describe('REQUESTTABLESTATUS readback model', () => {
  it('builds a deterministic request', () => {
    const a = serialiseTableStatusRequest({ table: 5, deviceId: 'D' });
    const b = serialiseTableStatusRequest({ table: 5, deviceId: 'D' });
    expect(a).toBe(b);
    expect(a).toContain('<WPType>REQUESTTABLESTATUS</WPType>');
    expect(a).toContain('<Table>5</Table>');
  });

  it('refuses an invalid table or device', () => {
    expect(() => serialiseTableStatusRequest({ table: 0, deviceId: 'D' })).toThrow(
      WaiterPadTableStatusError,
    );
    expect(() => serialiseTableStatusRequest({ table: 5, deviceId: ' ' })).toThrow(
      WaiterPadTableStatusError,
    );
  });

  const response = `<?xml version='1.0' encoding='utf-8' ?>
<WPPacket>
  <Table>5</Table>
  <OrderItem Index="1">
    <StockItem>              23</StockItem>
    <Description>Lemon slice</Description>
    <Quantity>1</Quantity>
    <Price>1.5</Price>
    <SeatNumber>0</SeatNumber>
    <PriceLevel>1</PriceLevel>
  </OrderItem>
  <OrderItem Index="2">
    <StockItem>             511</StockItem>
    <Description>MUHALLEBI</Description>
    <Quantity>1</Quantity>
    <Price>6</Price>
    <SeatNumber>0</SeatNumber>
    <PriceLevel>1</PriceLevel>
  </OrderItem>
</WPPacket>`;

  it('parses the seven proven fields and trims the space-padded ones', () => {
    const parsed = parseTableStatusResponse(response, AT);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.status.table).toBe(5);
    expect(parsed.status.lines).toHaveLength(2);
    expect(parsed.status.lines[0]).toMatchObject({
      index: '1',
      stockItem: '23',
      description: 'Lemon slice',
      quantity: '1',
      seatNumber: '0',
      priceLevel: '1',
    });
    expect(parsed.status.lines[1].stockItem).toBe('511');
  });

  it('models the native resolved price as learned from readback only', () => {
    const parsed = parseTableStatusResponse(response, AT);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.status.lines[0].price).toEqual({
      resolvedFrom: 'readback',
      rawValue: '1.5',
      value: 1.5,
      observedAt: AT,
    });
  });

  it('states explicitly that it carries no round identity', () => {
    const parsed = parseTableStatusResponse(response, AT);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.status.roundIdentityAvailable).toBe(false);
    expect(parsed.status.absentFields).toEqual(['OrderedTime', 'Printed']);
  });

  it('cannot distinguish two identical lines from different rounds', () => {
    const twice = response
      .replace('MUHALLEBI', 'Lemon slice')
      .replace('<StockItem>             511', '<StockItem>              23');
    const parsed = parseTableStatusResponse(twice, AT);
    if (!parsed.ok) throw new Error(parsed.detail);
    const [a, b] = parsed.status.lines;
    // Everything except the POS-assigned ordinal is identical, and the ordinal
    // says nothing about which round produced the line.
    expect(a.stockItem).toBe(b.stockItem);
    expect(a.description).toBe(b.description);
    expect(a.quantity).toBe(b.quantity);
  });

  it('fails closed on a line missing a proven field, rather than skipping it', () => {
    const broken = response.replace('    <Quantity>1</Quantity>\n', '');
    const parsed = parseTableStatusResponse(broken, AT);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('malformed_line');
  });

  it('fails closed on non-XML and on the wrong root', () => {
    expect(parseTableStatusResponse('nope', AT).ok).toBe(false);
    expect(parseTableStatusResponse(`<Other><Table>5</Table></Other>`, AT).ok).toBe(false);
  });

  it('flags a price the POS never resolved', () => {
    const unresolved = nativeResolvedPriceFromReadback('-9999', AT);
    expect(readbackPriceLooksUnresolved(unresolved)).toBe(true);
    expect(readbackPriceLooksUnresolved(nativeResolvedPriceFromReadback('1.5', AT))).toBe(false);
  });

  it('records an unparseable price as null rather than discarding the readback', () => {
    expect(nativeResolvedPriceFromReadback('n/a', AT).value).toBeNull();
  });
});

describe('the gate cannot be opened', () => {
  it('is off when the marker is unset', () => {
    const c = checkWaiterPadCertification({ env: {}, targetHost: 'DESKTOP-70DQTGJ' });
    expect(c.certified).toBe(false);
    expect(c.reason).toContain(WAITERPAD_CERTIFICATION_ENV_KEY);
  });

  it('is off for empty and whitespace values', () => {
    for (const v of ['', '   ']) {
      expect(
        checkWaiterPadCertification({
          env: { [WAITERPAD_CERTIFICATION_ENV_KEY]: v },
          targetHost: 'H',
        }).certified,
      ).toBe(false);
    }
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on'])('rejects the boolean-ish value %s', (v) => {
    const c = checkWaiterPadCertification({
      env: { [WAITERPAD_CERTIFICATION_ENV_KEY]: v },
      targetHost: 'H',
    });
    expect(c.certified).toBe(false);
    expect(c.reason).toMatch(/must name the certified host/);
  });

  it('does not transfer certification between machines', () => {
    const c = checkWaiterPadCertification({
      env: { [WAITERPAD_CERTIFICATION_ENV_KEY]: 'DESKTOP-70DQTGJ' },
      targetHost: 'DESKTOP-SOKKOQ7',
    });
    expect(c.certified).toBe(false);
    expect(c.reason).toMatch(/does not transfer between machines/);
  });

  it('is off when no target host is supplied', () => {
    expect(
      checkWaiterPadCertification({
        env: { [WAITERPAD_CERTIFICATION_ENV_KEY]: 'DESKTOP-70DQTGJ' },
        targetHost: null,
      }).certified,
    ).toBe(false);
  });

  it('matches host case-insensitively when both are supplied', () => {
    expect(
      checkWaiterPadCertification({
        env: { [WAITERPAD_CERTIFICATION_ENV_KEY]: 'desktop-70dqtgj' },
        targetHost: 'DESKTOP-70DQTGJ',
      }).certified,
    ).toBe(true);
  });

  it('assertWaiterPadCertified throws under the real process environment', () => {
    expect(() =>
      assertWaiterPadCertified({ env: process.env, targetHost: 'DESKTOP-70DQTGJ' }),
    ).toThrow(WaiterPadNotCertifiedError);
  });

  it('even a certified host cannot send, because no transport exists', () => {
    expect(() => assertNoTransportAvailable()).toThrow(WaiterPadTransportUnavailableError);
  });
});

describe('nothing in this module tree can transmit', () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  /**
   * Production sources only. The spec files quote the forbidden tokens as test
   * data, which is exactly what makes the check meaningful — so they are
   * excluded from the body scan rather than the check being weakened.
   */
  const productionSources = sources.filter((f) => !f.endsWith('.spec.ts'));

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(productionSources.length).toBeGreaterThan(4);
  });

  it.each(productionSources)('%s imports no network capability', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const importLines = text
      .split('\n')
      .filter((l) => /^\s*(import|export)\s.*\sfrom\s|require\(/.test(l));
    const joined = importLines.join('\n');
    for (const forbidden of [
      "'net'",
      '"net"',
      'node:net',
      "'tls'",
      'node:tls',
      "'dgram'",
      'node:dgram',
      "'http'",
      'node:http',
      "'https'",
      'node:https',
      'axios',
      'node-fetch',
      'undici',
      'ws',
      'socket.io',
    ]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it.each(productionSources)('%s calls no network primitive', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    // Deliberately crude and greppable. A future transport must delete this
    // test on purpose, not slip past it.
    for (const forbidden of [
      'createConnection',
      'createServer',
      '.connect(',
      'new Socket',
      'fetch(',
      'XMLHttpRequest',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('mentions the port only as documentation, never as a connection target', () => {
    expect(WAITERPAD_PORT).toBe(6983);
    const evidence = readFileSync(join(dir, 'waiterpad-evidence.ts'), 'utf8');
    expect(evidence).toContain('6983');
    // The constant is not referenced by any other module in the tree.
    const others = sources.filter((f) => f !== 'waiterpad-evidence.ts' && !f.endsWith('.spec.ts'));
    for (const f of others) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toContain('WAITERPAD_PORT');
    }
  });
});

/**
 * The 2026-09-07 additions to the evidence ledger.
 *
 * These are assertions about DOCUMENTATION, and they are worth having: an
 * evidence note that loses its grade or its addresses stops being auditable,
 * and this route's whole safety argument is "every constant traces to an
 * address in a binary a reader can check".
 */
describe('the evidence ledger records the 2026-09-07 static findings', () => {
  it('every note carries a grade, a body and — where static — addresses', () => {
    const notes: Array<[string, EvidenceNote]> = [
      ['SILENT_DROP_GATES', SILENT_DROP_GATES],
      ['NAK_ON_HANDHELD_PROCESSING', NAK_ON_HANDHELD_PROCESSING],
      ['DEVICE_REGISTRATION_EVIDENCE', DEVICE_REGISTRATION_EVIDENCE],
      ['PORT_FAMILY_EVIDENCE', PORT_FAMILY_EVIDENCE],
      ['RELAY_TRIGGER_EVIDENCE', RELAY_TRIGGER_EVIDENCE],
      ['HANDHELD_LOG_LOCATION_EVIDENCE', HANDHELD_LOG_LOCATION_EVIDENCE],
      ['IPS_AND_IPSWORKER_SAME_IMAGE', IPS_AND_IPSWORKER_SAME_IMAGE],
      ['CHECKSUM_NO_GENERATOR_EVIDENCE', CHECKSUM_NO_GENERATOR_EVIDENCE],
      ['CHECKSUM_LOG_LINE_EVIDENCE', CHECKSUM_LOG_LINE_EVIDENCE],
      ['CHECKSUM_STORAGE_DUALITY_EVIDENCE', CHECKSUM_STORAGE_DUALITY_EVIDENCE],
      ['NAKREGO_EMPTY_BODY_EVIDENCE', NAKREGO_EMPTY_BODY_EVIDENCE],
      ['RELAY_PATH_CHAIN_EVIDENCE', RELAY_PATH_CHAIN_EVIDENCE],
      ['RELAY_DELETE_REWRITE_EVIDENCE', RELAY_DELETE_REWRITE_EVIDENCE],
      ['RECOVERY_CAUSAL_TOKEN_EVIDENCE', RECOVERY_CAUSAL_TOKEN_EVIDENCE],
    ];
    for (const [name, note] of notes) {
      expect(note.note.length).toBeGreaterThan(60);
      expect([
        'PROVEN_RUNTIME',
        'PROVEN_STATIC',
        'STRONGLY_INDICATED',
        'NOT_SHOWN',
        'CONTRADICTED',
      ]).toContain(note.grade);
      if (note.grade === 'PROVEN_STATIC') {
        expect(note.addresses.length).toBeGreaterThan(0);
        for (const a of note.addresses) expect(a).toMatch(/^0x[0-9a-f]{8}$/);
      }
      expect(name.length).toBeGreaterThan(0);
    }
  });

  /**
   * The relay question is the surviving correctness risk. Narrowing it is
   * progress; closing it is not something a static pass can do, and the grade
   * must keep saying so.
   */
  it('keeps the relay trigger at NOT_SHOWN despite the new detail', () => {
    expect(RELAY_TRIGGER_EVIDENCE.grade).toBe('NOT_SHOWN');
    expect(RELAY_TRIGGER_EVIDENCE.note).toContain('NOT');
  });

  it('records that a listener may only be attributed by PID, not by binary', () => {
    expect(IPS_AND_IPSWORKER_SAME_IMAGE.grade).toBe('PROVEN_RUNTIME');
    expect(IPS_AND_IPSWORKER_SAME_IMAGE.note).toContain('[BACK]');
  });

  it('records that the till can answer nothing at all, twice over', () => {
    expect(SILENT_DROP_GATES.note).toContain('NOT HandheldLicensed');
    expect(SILENT_DROP_GATES.note).toContain('NoReceiving');
    expect(SILENT_DROP_GATES.note).toContain('Neither branch writes a response body');
  });

  it('records that registering a device consumes a licensed handheld slot', () => {
    expect(DEVICE_REGISTRATION_EVIDENCE.grade).toBe('PROVEN_STATIC');
    expect(DEVICE_REGISTRATION_EVIDENCE.note).toContain('BAD REGO');
  });

  /**
   * The third pass proved a NEGATIVE about the binary — no generator in it —
   * without moving the algorithm off NOT_SHOWN. Those two must never be
   * conflated, because conflating them is exactly the reasoning that would
   * ship an invented hash. This test pins them apart.
   */
  it('separates "no generator in the binary" from "we know the algorithm"', () => {
    // Strong negative evidence, deliberately NOT graded PROVEN_STATIC: no
    // exhaustive control-flow proof exists that a custom algorithm is absent.
    expect(CHECKSUM_NO_GENERATOR_EVIDENCE.grade).toBe('STRONGLY_INDICATED');
    expect(CHECKSUM_NO_GENERATOR_EVIDENCE.note).toContain('not an');
    expect(CHECKSUM_NO_GENERATOR_EVIDENCE.note).toContain('exhaustive');
    // The thing that must not move.
    expect(CHECKSUM_ALGORITHM_EVIDENCE.grade).toBe('NOT_SHOWN');
  });

  it('records that the MD5 helper is excluded by call graph, not by proximity', () => {
    expect(CHECKSUM_NO_GENERATOR_EVIDENCE.note).toContain('GetMD5Hash');
    expect(CHECKSUM_NO_GENERATOR_EVIDENCE.note).toContain('NONE in the handheld module');
  });

  it('records the Checksum= log line as the Front grep target', () => {
    expect(CHECKSUM_LOG_LINE_EVIDENCE.grade).toBe('PROVEN_STATIC');
    expect(CHECKSUM_LOG_LINE_EVIDENCE.note).toContain('Checksum=');
    expect(CHECKSUM_LOG_LINE_EVIDENCE.note).toContain('DeviceID=');
  });

  /**
   * A switchable duplicate guard is a live correctness hazard for Verdura's
   * own idempotency, so the note must keep saying the switch is unexplained.
   */
  it('records that the receiver duplicate guard can be gated off', () => {
    expect(CHECKSUM_STORAGE_DUALITY_EVIDENCE.note).toContain('0x2a2f1e4');
    expect(CHECKSUM_STORAGE_DUALITY_EVIDENCE.note).toContain('NOT SHOWN');
    expect(CHECKSUM_STORAGE_DUALITY_EVIDENCE.note).toContain('Do not assume the guard is armed');
  });

  /**
   * The relay chain is the session's primary finding. These pin the two facts
   * that make it load-bearing: socket orders DO reach the destructive path,
   * and the two similarly-named procedures are NOT the same routine.
   */
  it('records that a socket ORDER reaches ProcessHandheldOrder via IH-PRINT', () => {
    expect(RELAY_PATH_CHAIN_EVIDENCE.grade).toBe('PROVEN_STATIC');
    expect(RELAY_PATH_CHAIN_EVIDENCE.note).toContain('IH-PRINT');
    expect(RELAY_PATH_CHAIN_EVIDENCE.note).toContain('EXACTLY ONE caller');
  });

  it('keeps WPOrder and ProcessHandheldOrder distinct', () => {
    expect(RELAY_PATH_CHAIN_EVIDENCE.note).toContain('do ' + 'not merge them');
    expect(RELAY_PATH_CHAIN_EVIDENCE.note).toContain('0x0182cad0');
    expect(RELAY_PATH_CHAIN_EVIDENCE.note).toContain('0x01826b90');
  });

  it('records the delete-and-rewrite as reaching NATIVE sale state', () => {
    expect(RELAY_DELETE_REWRITE_EVIDENCE.note).toContain('PendingSaleLines');
    expect(RELAY_DELETE_REWRITE_EVIDENCE.note).toContain('PendingSales');
    expect(RELAY_DELETE_REWRITE_EVIDENCE.note).toContain('NATIVE');
    // The WHERE operand was NOT decoded. Must stay flagged as inference.
    expect(RELAY_DELETE_REWRITE_EVIDENCE.note).toContain('INFERENCE');
  });

  /**
   * The one that must never soften: without a causal token, an exact content
   * match is not proof Verdura caused it.
   */
  it('records that no durable causal token exists for recovery', () => {
    expect(RECOVERY_CAUSAL_TOKEN_EVIDENCE.grade).toBe('NOT_SHOWN');
    expect(RECOVERY_CAUSAL_TOKEN_EVIDENCE.note).toContain('NO DeviceID and NO Checksum');
    expect(RECOVERY_CAUSAL_TOKEN_EVIDENCE.note).toContain('MANUAL_RESOLUTION_REQUIRED');
  });

  it('records that NAKREGO carries no body and therefore no reason code', () => {
    expect(NAKREGO_EMPTY_BODY_EVIDENCE.grade).toBe('PROVEN_STATIC');
    expect(NAKREGO_EMPTY_BODY_EVIDENCE.note).toContain('no parameters');
    expect(NAKREGO_EMPTY_BODY_EVIDENCE.note).toContain('carries NO');
  });
});

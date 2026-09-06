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
import { CHECKSUM_ALGORITHM_EVIDENCE, WAITERPAD_PORT } from './waiterpad-evidence';
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

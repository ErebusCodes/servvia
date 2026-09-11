/**
 * The activation prerequisites: configuration, identity, token, reconciliation.
 *
 * Every test here is about refusing. The feature is off, and the point of this
 * suite is that it cannot be switched on halfway.
 */
import {
  resolveWaiterPadConfig,
  WAITERPAD_DEFAULT_PORT,
  WAITERPAD_ENV_KEYS,
} from './waiterpad-config';
import {
  IDENTITY_POLICY,
  resolveWaiterPadIdentity,
  WaiterPadIdentityError,
} from './waiterpad-device-identity';
import {
  assertValidWaiterPadToken,
  deriveWaiterPadToken,
  newAttemptId,
  RECEIVER_GUARD_PROPERTIES,
  WaiterPadTokenError,
} from './waiterpad-token';
import { reconcileAmbiguousSend, RECONCILIATION_OPEN_QUESTIONS } from './waiterpad-reconciliation';
import type { SendInitiatedRecord } from './waiterpad-table-round-writer';

const complete = (over: Record<string, string> = {}): Record<string, string> => ({
  IDEALPOS_WAITERPAD_NATIVE_ENABLED: 'true',
  IDEALPOS_WAITERPAD_HOST: '192.168.1.199',
  IDEALPOS_WAITERPAD_DEVICE_ID: 'VERDURA-PROD-0001',
  IDEALPOS_WAITERPAD_LOCAL_ADDRESS: '192.168.1.250',
  IDEALPOS_WAITERPAD_CLIENT_VERSION: 'Verdura 0.1.0',
  IDEALPOS_WAITERPAD_DEVICE_MODEL: 'Verdura Back',
  IDEALPOS_WAITERPAD_DEVICE_OS: 'Windows',
  IDEALPOS_WAITERPAD_POS_TERMINAL: '901',
  IDEALPOS_WAITERPAD_CLERK: '108',
  IDEALPOS_WAITERPAD_MAP: '1',
  IDEALPOS_WAITERPAD_LOCATION: '1',
  IDEALPOS_WAITERPAD_PRICE_POLICY: 'nativeResolved',
  IDEALPOS_WAITERPAD_PRICE_LEVEL: '1',
  ...over,
});

describe('configuration fails closed', () => {
  it('is disabled with an empty environment, and says why', () => {
    const res = resolveWaiterPadConfig({});
    expect(res.enabled).toBe(false);
    if (!res.enabled) expect(res.reasons.length).toBeGreaterThan(3);
  });

  it('resolves only when everything is present', () => {
    const res = resolveWaiterPadConfig(complete());
    expect(res.enabled).toBe(true);
    if (res.enabled) {
      expect(res.config.port).toBe(WAITERPAD_DEFAULT_PORT);
      expect(res.config.identity.deviceId).toBe('VERDURA-PROD-0001');
      expect(res.config.allowNonZeroSeat).toBe(false);
    }
  });

  it('requires the enable flag to be exactly "true"', () => {
    for (const v of ['1', 'yes', 'TRUE', 'true ', '']) {
      const res = resolveWaiterPadConfig(complete({ IDEALPOS_WAITERPAD_NATIVE_ENABLED: v }));
      expect(res.enabled).toBe(false);
    }
  });

  it.each([
    WAITERPAD_ENV_KEYS.host,
    WAITERPAD_ENV_KEYS.deviceId,
    WAITERPAD_ENV_KEYS.posTerminal,
    WAITERPAD_ENV_KEYS.clerk,
    WAITERPAD_ENV_KEYS.map,
    WAITERPAD_ENV_KEYS.location,
    WAITERPAD_ENV_KEYS.pricePolicy,
  ])('stays disabled when %s is missing', (key) => {
    const env = complete();
    delete env[key];
    expect(resolveWaiterPadConfig(env).enabled).toBe(false);
  });

  it('rejects an out-of-range price level for the nativeResolved policy', () => {
    for (const lvl of ['0', '7', '-1', 'x']) {
      expect(
        resolveWaiterPadConfig(complete({ IDEALPOS_WAITERPAD_PRICE_LEVEL: lvl })).enabled,
      ).toBe(false);
    }
  });

  it('rejects an unbounded timeout rather than defaulting past it', () => {
    expect(
      resolveWaiterPadConfig(complete({ IDEALPOS_WAITERPAD_READ_TIMEOUT_MS: '600000' })).enabled,
    ).toBe(false);
    expect(
      resolveWaiterPadConfig(complete({ IDEALPOS_WAITERPAD_READ_TIMEOUT_MS: '10' })).enabled,
    ).toBe(false);
  });

  it('a disabled resolution carries no host or port to connect to', () => {
    const res = resolveWaiterPadConfig({ IDEALPOS_WAITERPAD_HOST: '192.168.1.199' });
    expect(res.enabled).toBe(false);
    expect(res).not.toHaveProperty('config');
  });
});

describe('device identity', () => {
  const good = {
    deviceId: 'VERDURA-PROD-0001',
    localAddress: '192.168.1.250',
    pocketPad: 'Verdura 0.1.0',
    deviceModel: 'Verdura Back',
    deviceOs: 'Windows',
  };

  it('accepts a Verdura id', () => {
    expect(resolveWaiterPadIdentity(good).deviceId).toBe('VERDURA-PROD-0001');
  });

  it('REFUSES the venue iPad DeviceID', () => {
    expect(() =>
      resolveWaiterPadIdentity({ ...good, deviceId: IDENTITY_POLICY.venueIpadDeviceId }),
    ).toThrow(/register as itself/);
  });

  it('REFUSES the phantom "undefined" identity', () => {
    expect(() => resolveWaiterPadIdentity({ ...good, deviceId: 'undefined' })).toThrow(
      WaiterPadIdentityError,
    );
  });

  // The receiver interpolates the DeviceID into
  // `SELECT ... WHERE ColumnType='IH-<DeviceID>'` with no escaping, so each of
  // these must be refused. The backslash case is here because an earlier
  // regex-based version of this check lost it to an escaping mistake.
  it.each([
    ["A'B", 'single quote'],
    ['A"B', 'double quote'],
    ['A;B', 'semicolon'],
    [`A${String.fromCharCode(92)}B`, 'backslash'],
  ])('refuses a device id containing a %s', (bad) => {
    expect(() => resolveWaiterPadIdentity({ ...good, deviceId: bad })).toThrow();
  });

  it('refuses hostile characters in the descriptive fields too', () => {
    expect(() => resolveWaiterPadIdentity({ ...good, deviceModel: "a'b" })).toThrow();
    expect(() =>
      resolveWaiterPadIdentity({ ...good, pocketPad: `a${String.fromCharCode(92)}b` }),
    ).toThrow();
  });

  it('requires an explicit id rather than generating one', () => {
    expect(() => resolveWaiterPadIdentity({ ...good, deviceId: '' })).toThrow(/must be configured/);
  });

  it('records that a licence seat is still required', () => {
    expect(IDENTITY_POLICY.requiresOwnLicenceSeat).toBe(true);
  });
});

describe('the duplicate token', () => {
  it('is stable for the same round and attempt, so a restart recomputes it', () => {
    const a = deriveWaiterPadToken({ roundId: 'r', attemptId: 'a' });
    const b = deriveWaiterPadToken({ roundId: 'r', attemptId: 'a' });
    expect(a).toBe(b);
  });

  it('differs for a different attempt on the same round', () => {
    expect(deriveWaiterPadToken({ roundId: 'r', attemptId: 'a1' })).not.toBe(
      deriveWaiterPadToken({ roundId: 'r', attemptId: 'a2' }),
    );
  });

  it('differs for the same attempt id on a different round', () => {
    expect(deriveWaiterPadToken({ roundId: 'r1', attemptId: 'a' })).not.toBe(
      deriveWaiterPadToken({ roundId: 'r2', attemptId: 'a' }),
    );
  });

  it('is SQL-safe by construction', () => {
    const t = deriveWaiterPadToken({ roundId: 'r', attemptId: 'a' });
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(() => assertValidWaiterPadToken(t)).not.toThrow();
  });

  it.each([
    ["r'", 'single quote'],
    ['r;', 'semicolon'],
    [`r${String.fromCharCode(92)}`, 'backslash'],
  ])('refuses a round id containing a %s', (bad) => {
    expect(() => deriveWaiterPadToken({ roundId: bad, attemptId: 'a' })).toThrow(
      WaiterPadTokenError,
    );
  });

  it('mints unique attempt ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newAttemptId()));
    expect(ids.size).toBe(200);
  });

  it('does not claim to be sufficient for exactly-once', () => {
    expect(RECEIVER_GUARD_PROPERTIES.sufficientForExactlyOnce).toBe(false);
    expect(RECEIVER_GUARD_PROPERTIES.depth).toBe(1);
    expect(RECEIVER_GUARD_PROPERTIES.emptyTokenSkipsGuard).toBe(true);
    expect(RECEIVER_GUARD_PROPERTIES.canBeDisabledByReceiverFlag).toBe(true);
  });
});

describe('reconciliation of an ambiguous send', () => {
  const record: SendInitiatedRecord = {
    roundId: 'r1',
    attemptId: 'a1',
    externalOrderId: 'ext-1',
    table: 12,
    deviceId: 'VERDURA-PROD-0001',
    token: 'a'.repeat(32),
    payloadHash: 'b'.repeat(64),
    sendInitiatedAt: new Date('2026-09-09T02:00:00Z'),
  };

  it('confirms only on BOTH halves: our token, and a readback showing the lines', () => {
    const v = reconcileAmbiguousSend(record, {
      // CAUSAL: only our packet could have put our token there.
      storedTokenForDevice: record.token,
      // DURABLE: the lines are actually on the tab.
      nativeLineCountForTable: 3,
      expectedLineCount: 3,
    });
    expect(v.kind).toBe('confirmed');
  });

  /**
   * THE CORRECTION OF 2026-09-11, AND THE REASON FOR IT.
   *
   * `SaveChecksum` - the only writer of the token row - is called from inside
   * `ProcessHandheldOrder` at 0x01827301, which is BEFORE the receiver deletes
   * the table's pending sale at 0x01827664/0x01827709 and before any line is
   * written. So the token proves our packet was PICKED UP and proves nothing
   * about the customer's bill. A crash in that window leaves a till whose
   * token says "seen", whose table has lost its previous order, and whose new
   * lines were never written.
   */
  it('does NOT confirm on our token alone - it is written before the sale exists', () => {
    const v = reconcileAmbiguousSend(record, { storedTokenForDevice: record.token });
    expect(v.kind).toBe('manualResolutionRequired');
    expect(v.basis).toMatch(/receipt and not application/i);
  });

  it('does NOT confirm when the readback shows fewer lines than the round was to add', () => {
    // The exact shape of the crash window: token written, lines not.
    const v = reconcileAmbiguousSend(record, {
      storedTokenForDevice: record.token,
      nativeLineCountForTable: 1,
      expectedLineCount: 3,
    });
    expect(v.kind).toBe('manualResolutionRequired');
  });

  it('does NOT confirm when the token matches but nobody looked at the table', () => {
    // `undefined` is "did not look", never "nothing there".
    const v = reconcileAmbiguousSend(record, {
      storedTokenForDevice: record.token,
      expectedLineCount: 3,
    });
    expect(v.kind).toBe('manualResolutionRequired');
  });

  it('reports notApplied when a different token is stored and nothing was processed', () => {
    const v = reconcileAmbiguousSend(record, {
      storedTokenForDevice: 'c'.repeat(32),
      processedForTableAfterSend: false,
    });
    expect(v.kind).toBe('notApplied');
  });

  it('demands a human when no evidence was gathered', () => {
    expect(reconcileAmbiguousSend(record, {}).kind).toBe('manualResolutionRequired');
  });

  it('does NOT confirm on line-count coincidence alone', () => {
    const v = reconcileAmbiguousSend(record, {
      nativeLineCountForTable: 3,
      expectedLineCount: 3,
    });
    expect(v.kind).toBe('manualResolutionRequired');
    expect(v.basis).toMatch(/not causality/i);
  });

  it('does not confirm on a stored token belonging to another attempt', () => {
    const v = reconcileAmbiguousSend(record, { storedTokenForDevice: 'd'.repeat(32) });
    expect(v.kind).not.toBe('confirmed');
  });

  it('keeps its open questions listed for the next acceptance run', () => {
    expect(RECONCILIATION_OPEN_QUESTIONS.length).toBeGreaterThan(2);
  });
});

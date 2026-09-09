/**
 * Verdura's handheld identity.
 *
 * THE RULE THAT MATTERS. Verdura registers as ITSELF. It never sends the venue
 * iPad's DeviceID and never sends `undefined`. Both would "work" in the narrow
 * sense of getting past the licence gate, and both are forbidden:
 *
 *   * the iPad's id would post orders under a device a human is holding,
 *     corrupt that device's one-deep duplicate row, and produce evidence that
 *     does not describe how Verdura runs in production;
 *   * `undefined` is the phantom registration created by the iPad app before it
 *     knows its own identity (see `PHANTOM_REGISTRATION_EVIDENCE`). Borrowing
 *     it means depending on a vendor bug staying unfixed.
 *
 * Verdura needs its own licensed seat. That is a purchasing fact, not something
 * a DeviceID string can route around, and `WAITERPAD-LICENCE-001` records it.
 *
 * STABILITY. The id must survive restart unchanged, because it is half the key
 * of the receiver's duplicate guard (`ColumnType='IH-<DeviceID>'`). An id that
 * changed on boot would silently reset our replay protection every deploy, so
 * it is configuration and never generated at runtime.
 */

export class WaiterPadIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadIdentityError';
  }
}

/**
 * Structural shape only.
 *
 * The venue iPad uses 32 uppercase hex characters. We accept that shape plus a
 * `VERDURA-` prefixed form, both quote-free, because the receiver interpolates
 * the DeviceID into SQL unescaped when building `ColumnType='IH-<DeviceID>'`.
 *
 * ACCEPTING A SHAPE IS NOT ACCEPTING A REGISTRATION. Nothing here claims the
 * till will grant a seat - on 2026-09-09 it refused one, twice, with NAKREGO.
 */
const DEVICE_ID_RE = /^(?:[0-9A-F]{32}|VERDURA-[0-9A-Z-]{8,48})$/;

/** The venue iPad. Hard-refused so it can never be configured by accident. */
const VENUE_IPAD_DEVICE_ID = '10DF1A7881284E2E95CA107E82EE7D0D';

/** The phantom. Same treatment. */
const FORBIDDEN_IDS: ReadonlySet<string> = new Set([
  VENUE_IPAD_DEVICE_ID,
  'undefined',
  'UNDEFINED',
  'null',
  '',
]);

export interface WaiterPadIdentity {
  readonly deviceId: string;
  /** Reported to the till as `<LocalAddress>`; informational on the wire. */
  readonly localAddress: string;
  /** `<PocketPad>` - the client version string. */
  readonly pocketPad: string;
  readonly deviceModel: string;
  readonly deviceOs: string;
}

export interface WaiterPadIdentityInput {
  readonly deviceId?: string;
  readonly localAddress?: string;
  readonly pocketPad?: string;
  readonly deviceModel?: string;
  readonly deviceOs?: string;
}

/**
 * Validate and normalise. Throws rather than defaulting: a wrong identity is
 * not the kind of thing to paper over with a fallback.
 */
export function resolveWaiterPadIdentity(input: WaiterPadIdentityInput): WaiterPadIdentity {
  const deviceId = (input?.deviceId ?? '').trim();
  if (deviceId === '') {
    throw new WaiterPadIdentityError(
      'deviceId is required and must be configured explicitly; it is half the key ' +
        'of the receiver duplicate guard and must be stable across restarts',
    );
  }
  if (FORBIDDEN_IDS.has(deviceId)) {
    throw new WaiterPadIdentityError(
      deviceId === VENUE_IPAD_DEVICE_ID
        ? 'refusing the venue iPad DeviceID: Verdura must register as itself'
        : `refusing the reserved DeviceID ${JSON.stringify(deviceId)}`,
    );
  }
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new WaiterPadIdentityError(
      'deviceId must be 32 uppercase hex characters or a VERDURA- prefixed id; ' +
        'the receiver interpolates it into SQL unescaped',
    );
  }

  return {
    deviceId,
    localAddress: requireText(input?.localAddress, 'localAddress'),
    pocketPad: requireText(input?.pocketPad, 'pocketPad'),
    deviceModel: requireText(input?.deviceModel, 'deviceModel'),
    deviceOs: requireText(input?.deviceOs, 'deviceOs'),
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WaiterPadIdentityError(`${field} must be a non-empty string`);
  }
  if (hasHostileChar(value)) {
    throw new WaiterPadIdentityError(`${field} contains characters that must never reach the till`);
  }
  return value;
}

/**
 * Characters that must never reach the till.
 *
 * Listed rather than written as a regex character class. The set contains a
 * quote and a backslash, and escaping those inside a literal has already been a
 * source of bugs in this file; an explicit list cannot be mis-escaped.
 */
const HOSTILE_CHARS: readonly string[] = ["'", '"', ';', String.fromCharCode(92)];

function hasHostileChar(value: string): boolean {
  for (const c of HOSTILE_CHARS) {
    if (value.includes(c)) return true;
  }
  return hasControlChar(value);
}

/** Codepoint check rather than a regex: a control-character class in source is
 *  both unreadable and a lint hazard. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export const IDENTITY_POLICY = {
  venueIpadDeviceId: VENUE_IPAD_DEVICE_ID,
  forbidden: [...FORBIDDEN_IDS],
  requiresOwnLicenceSeat: true,
} as const;

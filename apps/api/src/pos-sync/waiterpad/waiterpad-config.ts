/**
 * The activation gate, as configuration.
 *
 * FAIL CLOSED IS THE WHOLE POINT. `resolveWaiterPadConfig` returns a DISABLED
 * result for anything short of a complete, valid, explicitly-enabled
 * configuration, and a disabled result carries no host, no port and no
 * identity - so a caller that ignores `enabled` still has nothing to connect
 * to. There are no defaults for host, DeviceID or price policy: a default is
 * how a test till address ends up posting to a real one.
 *
 * This sits BESIDE `waiterpad-gate.ts`, which is a separate and stricter lock
 * (it also demands a certified host and refuses because no transport is
 * registered). Passing this does not open that one.
 */

import {
  resolveWaiterPadIdentity,
  WaiterPadIdentityError,
  type WaiterPadIdentity,
} from './waiterpad-device-identity';

export class WaiterPadConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadConfigError';
  }
}

/** The one port the handheld listener binds. Proven 2026-09-09. */
export const WAITERPAD_DEFAULT_PORT = 6983;

export interface WaiterPadTimeouts {
  readonly connectMs: number;
  readonly writeMs: number;
  readonly readMs: number;
}

export type WaiterPadPricePolicy =
  /** Send `-9999` and let the till resolve from `StockItems.Price<level>`. */
  | { readonly kind: 'nativeResolved'; readonly priceLevel: number }
  /** Send Verdura's own amount. Requires the menu to be authoritative. */
  | { readonly kind: 'explicit' };

export interface WaiterPadConfig {
  readonly host: string;
  readonly port: number;
  readonly identity: WaiterPadIdentity;
  readonly posTerminal: string;
  readonly clerk: string;
  readonly map: number;
  readonly location: number;
  readonly timeouts: WaiterPadTimeouts;
  readonly pricePolicy: WaiterPadPricePolicy;
  /** Reject a round carrying seat > 0. See `WAITERPAD-SEAT-001`. */
  readonly allowNonZeroSeat: boolean;
}

export type WaiterPadConfigResolution =
  | { readonly enabled: true; readonly config: WaiterPadConfig }
  | { readonly enabled: false; readonly reasons: readonly string[] };

/** Raw environment, injected rather than read, so tests need no globals. */
export interface WaiterPadEnv {
  readonly [key: string]: string | undefined;
}

const ENV = {
  enabled: 'IDEALPOS_WAITERPAD_NATIVE_ENABLED',
  host: 'IDEALPOS_WAITERPAD_HOST',
  port: 'IDEALPOS_WAITERPAD_PORT',
  deviceId: 'IDEALPOS_WAITERPAD_DEVICE_ID',
  localAddress: 'IDEALPOS_WAITERPAD_LOCAL_ADDRESS',
  pocketPad: 'IDEALPOS_WAITERPAD_CLIENT_VERSION',
  deviceModel: 'IDEALPOS_WAITERPAD_DEVICE_MODEL',
  deviceOs: 'IDEALPOS_WAITERPAD_DEVICE_OS',
  posTerminal: 'IDEALPOS_WAITERPAD_POS_TERMINAL',
  clerk: 'IDEALPOS_WAITERPAD_CLERK',
  map: 'IDEALPOS_WAITERPAD_MAP',
  location: 'IDEALPOS_WAITERPAD_LOCATION',
  connectMs: 'IDEALPOS_WAITERPAD_CONNECT_TIMEOUT_MS',
  writeMs: 'IDEALPOS_WAITERPAD_WRITE_TIMEOUT_MS',
  readMs: 'IDEALPOS_WAITERPAD_READ_TIMEOUT_MS',
  pricePolicy: 'IDEALPOS_WAITERPAD_PRICE_POLICY',
  priceLevel: 'IDEALPOS_WAITERPAD_PRICE_LEVEL',
  allowSeat: 'IDEALPOS_WAITERPAD_ALLOW_NON_ZERO_SEAT',
} as const;

export const WAITERPAD_ENV_KEYS = ENV;

const TIMEOUT_BOUNDS = { min: 250, max: 60_000 } as const;

/**
 * Resolve, or explain every reason it stayed shut.
 *
 * Collects ALL problems rather than throwing on the first, because an operator
 * bringing this up wants the whole list, not five deploys in a row.
 */
export function resolveWaiterPadConfig(env: WaiterPadEnv): WaiterPadConfigResolution {
  const reasons: string[] = [];

  if (env[ENV.enabled] !== 'true') {
    reasons.push(`${ENV.enabled} is not exactly "true"`);
  }

  const host = (env[ENV.host] ?? '').trim();
  if (host === '') reasons.push(`${ENV.host} is required`);

  const port = intOr(env[ENV.port], WAITERPAD_DEFAULT_PORT);
  if (port === null || port < 1 || port > 65535) reasons.push(`${ENV.port} is not a valid port`);

  let identity: WaiterPadIdentity | null = null;
  try {
    identity = resolveWaiterPadIdentity({
      deviceId: env[ENV.deviceId],
      localAddress: env[ENV.localAddress],
      pocketPad: env[ENV.pocketPad],
      deviceModel: env[ENV.deviceModel],
      deviceOs: env[ENV.deviceOs],
    });
  } catch (err) {
    reasons.push(
      err instanceof WaiterPadIdentityError ? `identity: ${err.message}` : 'identity is invalid',
    );
  }

  const posTerminal = (env[ENV.posTerminal] ?? '').trim();
  if (posTerminal === '') reasons.push(`${ENV.posTerminal} is required`);
  const clerk = (env[ENV.clerk] ?? '').trim();
  if (clerk === '') reasons.push(`${ENV.clerk} is required`);

  const map = intOr(env[ENV.map], null);
  if (map === null || map < 0) reasons.push(`${ENV.map} is required`);
  const location = intOr(env[ENV.location], null);
  if (location === null || location < 0) reasons.push(`${ENV.location} is required`);

  const connectMs = intOr(env[ENV.connectMs], 5_000);
  const writeMs = intOr(env[ENV.writeMs], 5_000);
  const readMs = intOr(env[ENV.readMs], 10_000);
  for (const [name, v] of [
    [ENV.connectMs, connectMs],
    [ENV.writeMs, writeMs],
    [ENV.readMs, readMs],
  ] as const) {
    if (v === null || v < TIMEOUT_BOUNDS.min || v > TIMEOUT_BOUNDS.max) {
      reasons.push(`${name} must be between ${TIMEOUT_BOUNDS.min} and ${TIMEOUT_BOUNDS.max} ms`);
    }
  }

  let pricePolicy: WaiterPadPricePolicy | null = null;
  const rawPolicy = (env[ENV.pricePolicy] ?? '').trim();
  if (rawPolicy === 'nativeResolved') {
    const level = intOr(env[ENV.priceLevel], null);
    if (level === null || level < 1 || level > 6) {
      reasons.push(`${ENV.priceLevel} must be 1..6 when the policy is nativeResolved`);
    } else {
      pricePolicy = { kind: 'nativeResolved', priceLevel: level };
    }
  } else if (rawPolicy === 'explicit') {
    pricePolicy = { kind: 'explicit' };
  } else {
    reasons.push(`${ENV.pricePolicy} must be "nativeResolved" or "explicit"`);
  }

  const allowNonZeroSeat = env[ENV.allowSeat] === 'true';

  if (reasons.length > 0 || identity === null || pricePolicy === null) {
    return { enabled: false, reasons: reasons.length > 0 ? reasons : ['configuration incomplete'] };
  }

  return {
    enabled: true,
    config: {
      host,
      port: port as number,
      identity,
      posTerminal,
      clerk,
      map: map as number,
      location: location as number,
      timeouts: {
        connectMs: connectMs as number,
        writeMs: writeMs as number,
        readMs: readMs as number,
      },
      pricePolicy,
      allowNonZeroSeat,
    },
  };
}

function intOr(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw.trim(), 10);
}

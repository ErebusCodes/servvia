/**
 * The gate. This route cannot be turned on.
 *
 * WHAT THIS IS NOT. It is not a feature flag with a default of off, waiting for
 * someone to flip it. Three independent things would each have to change before
 * a WaiterPad packet could reach a till, and only the first is a config value:
 *
 *   1. `IDEALPOS_WAITERPAD_CERTIFIED` would have to name the certified host.
 *      It defaults to unset, and an unset, empty or malformed value is off.
 *   2. A checksum provider would have to exist that is evidence-backed. None
 *      does; the only implementation throws. See `waiterpad-checksum.ts`.
 *   3. A transport would have to exist. None does. Nothing in this module tree
 *      imports `net`, `dgram`, `tls`, `http`, `https` or `fetch`, and
 *      `assertNoTransportAvailable` fails unconditionally.
 *
 * WHY NAME A HOST RATHER THAN SET A BOOLEAN. Because the certification is of a
 * MACHINE, not of a venue or of the code. The handheld server runs on Front /
 * Machine 2; Back / Machine 1 is a different box with different entitlements.
 * A boolean would let an operator enable a route against whichever machine the
 * connector happened to resolve, which is precisely the machine-attribution
 * error this integration has already made once in its documentation.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THIS FILE, AND FROM THIS BRANCH:
 *   * no registration in `pos-sync.module.ts`;
 *   * no capability advertisement — no connector build reports a WaiterPad
 *     capability, which is an independent gate outside this repo's control;
 *   * no change to `dine-in-route.ts`. The dine-in seam still resolves WEBIT
 *     by default and knows nothing about this module;
 *   * no new command type, no migration, no deployment artifact.
 *
 * Nothing here is wired to anything. It is a library with no callers.
 */

/** The one configuration key, and it is not enough on its own. */
export const WAITERPAD_CERTIFICATION_ENV_KEY = 'IDEALPOS_WAITERPAD_CERTIFIED';

export class WaiterPadNotCertifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadNotCertifiedError';
  }
}

export class WaiterPadTransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadTransportUnavailableError';
  }
}

export interface CertificationCheck {
  readonly certified: boolean;
  /** The host the value names, when it names one. */
  readonly host: string | null;
  readonly reason: string;
}

/**
 * Read the certification marker.
 *
 * Fail-closed on everything: unset, empty, whitespace, a boolean-ish string,
 * or a value that does not match the host being targeted. `'true'` is
 * explicitly rejected — the marker must name a machine, and accepting a
 * boolean would be the exact ambiguity this design removes.
 */
export function checkWaiterPadCertification(params: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The machine a caller intends to talk to. */
  readonly targetHost?: string | null;
}): CertificationCheck {
  const env = params.env ?? {};
  const raw = env[WAITERPAD_CERTIFICATION_ENV_KEY];

  if (raw === undefined || raw === null || raw.trim() === '') {
    return {
      certified: false,
      host: null,
      reason: `${WAITERPAD_CERTIFICATION_ENV_KEY} is not set; the WaiterPad route is off`,
    };
  }

  const value = raw.trim();

  if (/^(true|false|1|0|yes|no|on|off)$/i.test(value)) {
    return {
      certified: false,
      host: null,
      reason:
        `${WAITERPAD_CERTIFICATION_ENV_KEY} must name the certified host, not a boolean. ` +
        'Certification applies to a machine — the handheld server runs on one till, ' +
        'not on every IdealPOS box at the venue.',
    };
  }

  if (!params.targetHost || params.targetHost.trim() === '') {
    return {
      certified: false,
      host: value,
      reason:
        `${WAITERPAD_CERTIFICATION_ENV_KEY} names '${value}' but no target host was ` +
        'supplied to compare it against',
    };
  }

  if (value.toLowerCase() !== params.targetHost.trim().toLowerCase()) {
    return {
      certified: false,
      host: value,
      reason:
        `${WAITERPAD_CERTIFICATION_ENV_KEY} certifies '${value}', but the target host is ` +
        `'${params.targetHost}'. Certification does not transfer between machines.`,
    };
  }

  return {
    certified: true,
    host: value,
    reason: `host '${value}' is marked certified`,
  };
}

/**
 * Assert certification, or throw.
 *
 * Even a `true` from this is not sufficient to send anything —
 * `assertNoTransportAvailable` still fails, and no checksum can be produced.
 */
export function assertWaiterPadCertified(params: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly targetHost?: string | null;
}): void {
  const check = checkWaiterPadCertification(params);
  if (!check.certified) {
    throw new WaiterPadNotCertifiedError(check.reason);
  }
}

/**
 * The last line of defence, and the honest one.
 *
 * There is no WaiterPad transport in this codebase. This function exists so
 * that any code which believes it is about to send something fails here, with
 * an explanation, rather than discovering the absence at runtime in a
 * restaurant.
 *
 * Implementing a transport requires explicit approval. Deleting this function
 * is part of that work, not a prerequisite for it.
 */
export function assertNoTransportAvailable(): never {
  throw new WaiterPadTransportUnavailableError(
    'No WaiterPad transport exists in this codebase, by design. The packet codec, ' +
      'response parser, readback model and round-state mapping are offline-only. ' +
      'Building a transport requires explicit approval and, before that, an ' +
      'observed listener on Front / Machine 2 and a resolved checksum algorithm.',
  );
}

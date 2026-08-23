import { PaymentObservationState } from '@prisma/client';
import { PAYMENT_OBSERVATION_SCHEMA_VERSION } from '../payment-observation.constants';

const KNOWN_STATES = new Set<string>([
  'not_observed',
  'observation_unsupported',
  'pending',
  'paid',
  'declined',
  'cancelled',
  'reversed',
  'refunded',
  'uncertain',
  'conflict',
] satisfies PaymentObservationState[]);

/**
 * The canonical, versioned wire contract a payment-observation source
 * (this story's own fixture-injection endpoint today; a future real
 * connector-reported observation tomorrow) reports. Every field here is
 * either a Verdura-side correlation field this service already owns, or a
 * value the source explicitly and honestly reports -- nothing is coerced
 * from a plausible default. Mirrors idealpos-order-result.dto.ts's own
 * strict, fail-closed parsing discipline (Story 15-5) exactly, applied to
 * a different domain.
 */
export interface PaymentObservationEventInput {
  schemaVersion: number;
  /** Caller-supplied idempotency key, unique per order -- a duplicate delivery of the same id is a safe no-op; the same id with a different payload fails closed. */
  observationId: string;
  state: PaymentObservationState;
  nativeReference?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  tenderMethod?: string | null;
  /** ISO-8601. Rejected if present but unparseable -- never silently dropped or coerced to "now". */
  nativeTimestamp?: string | null;
  /** Sanitized only -- the caller must never forward a raw stack trace, SQL error, or credential. Truncated to 512 chars. */
  sanitizedReason?: string | null;
}

export type ParsedPaymentObservationEvent =
  | {
      ok: true;
      result: Required<Omit<PaymentObservationEventInput, 'nativeTimestamp'>> & {
        nativeTimestamp: Date | null;
      };
    }
  | { ok: false; malformedReason: string };

/**
 * Strict, fail-closed parser. An out-of-contract payload is `{ ok: false }`
 * -- the caller (PaymentObservationService) must never coerce a malformed
 * report into a default state, and must never call the bridge/connector
 * again on its behalf (there is no such call to make here; this is a
 * pure inbound report).
 */
export function parsePaymentObservationEvent(payload: unknown): ParsedPaymentObservationEvent {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, malformedReason: 'payload is not an object' };
  }
  const p = payload as Record<string, unknown>;

  if (typeof p.schemaVersion !== 'number' || !Number.isInteger(p.schemaVersion)) {
    return { ok: false, malformedReason: 'schemaVersion missing or not an integer' };
  }
  if (p.schemaVersion !== PAYMENT_OBSERVATION_SCHEMA_VERSION) {
    return {
      ok: false,
      malformedReason: `unsupported schemaVersion ${p.schemaVersion} (expected ${PAYMENT_OBSERVATION_SCHEMA_VERSION})`,
    };
  }
  if (typeof p.observationId !== 'string' || p.observationId.length === 0) {
    return { ok: false, malformedReason: 'observationId missing or empty' };
  }
  if (typeof p.state !== 'string' || !KNOWN_STATES.has(p.state)) {
    return { ok: false, malformedReason: `unknown state ${String(p.state)}` };
  }

  const strOrNull = (v: unknown, field: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new Error(`${field} must be a string or null/absent`);
    return v;
  };
  const intOrNull = (v: unknown, field: string): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new Error(`${field} must be an integer, null, or absent`);
    }
    return v;
  };

  try {
    const nativeReference = strOrNull(p.nativeReference, 'nativeReference');
    const amountCents = intOrNull(p.amountCents, 'amountCents');
    const currency = strOrNull(p.currency, 'currency');
    const tenderMethod = strOrNull(p.tenderMethod, 'tenderMethod');
    const sanitizedReason = strOrNull(p.sanitizedReason, 'sanitizedReason');

    if (amountCents !== null && !currency) {
      return { ok: false, malformedReason: 'amountCents present without a currency' };
    }

    let nativeTimestamp: Date | null = null;
    const rawTimestamp = strOrNull(p.nativeTimestamp, 'nativeTimestamp');
    if (rawTimestamp !== null) {
      const parsed = new Date(rawTimestamp);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, malformedReason: 'nativeTimestamp is not a valid ISO-8601 timestamp' };
      }
      nativeTimestamp = parsed;
    }

    return {
      ok: true,
      result: {
        schemaVersion: p.schemaVersion,
        observationId: p.observationId,
        state: p.state as PaymentObservationState,
        nativeReference,
        amountCents,
        currency,
        tenderMethod,
        nativeTimestamp,
        sanitizedReason: sanitizedReason ? sanitizedReason.slice(0, 512) : null,
      },
    };
  } catch (err) {
    return { ok: false, malformedReason: err instanceof Error ? err.message : String(err) };
  }
}

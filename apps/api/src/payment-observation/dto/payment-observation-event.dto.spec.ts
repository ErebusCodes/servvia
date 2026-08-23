import { parsePaymentObservationEvent } from './payment-observation-event.dto';
import { PAYMENT_OBSERVATION_SCHEMA_VERSION } from '../payment-observation.constants';

/**
 * Story 15-6: pure-logic unit tests for the strict payment-observation
 * parser. No database, no connector, no Idealpos -- contract-shape
 * evidence only.
 */
describe('parsePaymentObservationEvent', () => {
  const valid = () => ({
    schemaVersion: PAYMENT_OBSERVATION_SCHEMA_VERSION,
    observationId: 'fixture-1',
    state: 'paid',
    nativeReference: 'IPS-9001',
    amountCents: 7000,
    currency: 'NZD',
    tenderMethod: 'eftpos',
    nativeTimestamp: '2026-08-21T10:00:00.000Z',
  });

  it('accepts a well-formed paid observation', () => {
    const parsed = parsePaymentObservationEvent(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.state).toBe('paid');
      expect(parsed.result.amountCents).toBe(7000);
      expect(parsed.result.nativeTimestamp).toBeInstanceOf(Date);
    }
  });

  it('accepts a minimal unsupported observation with no money fields', () => {
    const parsed = parsePaymentObservationEvent({
      schemaVersion: PAYMENT_OBSERVATION_SCHEMA_VERSION,
      observationId: 'fixture-2',
      state: 'observation_unsupported',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.amountCents).toBeNull();
      expect(parsed.result.nativeTimestamp).toBeNull();
    }
  });

  it('rejects a non-object payload', () => {
    expect(parsePaymentObservationEvent(null).ok).toBe(false);
    expect(parsePaymentObservationEvent('x').ok).toBe(false);
    expect(parsePaymentObservationEvent(42).ok).toBe(false);
    expect(parsePaymentObservationEvent(undefined).ok).toBe(false);
  });

  it('rejects a missing schemaVersion', () => {
    const rest: Record<string, unknown> = valid();
    delete rest.schemaVersion;
    expect(parsePaymentObservationEvent(rest).ok).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const parsed = parsePaymentObservationEvent({ ...valid(), schemaVersion: 99 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.malformedReason).toMatch(/unsupported schemaVersion/);
  });

  it('rejects a missing observationId', () => {
    const rest: Record<string, unknown> = valid();
    delete rest.observationId;
    expect(parsePaymentObservationEvent(rest).ok).toBe(false);
  });

  it('rejects an empty observationId', () => {
    expect(parsePaymentObservationEvent({ ...valid(), observationId: '' }).ok).toBe(false);
  });

  it('rejects an unknown state', () => {
    const parsed = parsePaymentObservationEvent({ ...valid(), state: 'made_up_state' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.malformedReason).toMatch(/unknown state/);
  });

  it('rejects amountCents present without a currency', () => {
    const parsed = parsePaymentObservationEvent({
      ...valid(),
      currency: undefined,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.malformedReason).toMatch(/without a currency/);
  });

  it('rejects a non-integer amountCents', () => {
    const parsed = parsePaymentObservationEvent({ ...valid(), amountCents: 70.5 });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a malformed nativeTimestamp', () => {
    const parsed = parsePaymentObservationEvent({ ...valid(), nativeTimestamp: 'not-a-date' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.malformedReason).toMatch(/nativeTimestamp/);
  });

  it('truncates sanitizedReason to 512 chars', () => {
    const parsed = parsePaymentObservationEvent({ ...valid(), sanitizedReason: 'x'.repeat(1000) });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.result.sanitizedReason?.length).toBe(512);
  });

  it('never treats a missing optional field as a default value -- absence stays absence', () => {
    const parsed = parsePaymentObservationEvent({
      schemaVersion: PAYMENT_OBSERVATION_SCHEMA_VERSION,
      observationId: 'fixture-3',
      state: 'pending',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.nativeReference).toBeNull();
      expect(parsed.result.amountCents).toBeNull();
      expect(parsed.result.tenderMethod).toBeNull();
    }
  });
});

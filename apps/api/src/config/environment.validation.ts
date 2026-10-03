import * as Joi from 'joi';
import { isInsecureDefaultSecret } from '../auth/utils/insecure-default-secret.util';
import { INSECURE_DEFAULT_PIN } from '../auth/utils/insecure-default-pin.util';

/** The shortest PIN accepted in production (pin-length.validator.ts). */
export const PRODUCTION_MIN_PIN_LENGTH = 4;

/**
 * Startup validation of the process environment (ConfigModule `validate`).
 *
 * 1. The Joi schema (required values, types, formats). NODE_ENV is required
 *    and has no default: an unset environment refuses to start instead of
 *    silently running with development behaviour.
 * 2. Production rules: with NODE_ENV=production, development-only settings
 *    and checked-in defaults refuse to start.
 *
 * Error messages name the variable and the rule, never the value, so a
 * secret or PIN is never written to the startup log.
 */
export function validateEnvironment(
  schema: Joi.ObjectSchema,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Joi.ValidationResult<Record<string, unknown>> = schema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });
  const { error } = result;
  if (error) {
    const problems = error.details.map((d) => `${d.path.join('.') || '(root)'}: ${d.type}`);
    throw new Error(`Invalid configuration — refusing to start: ${problems.join('; ')}`);
  }
  const validated = result.value;
  const violations = productionConfigurationViolations(validated);
  if (violations.length > 0) {
    throw new Error(
      `Unsafe production configuration — refusing to start: ${violations.join('; ')}`,
    );
  }
  return validated;
}

/** Production-only rules; empty outside NODE_ENV=production. Values are never included. */
export function productionConfigurationViolations(config: Record<string, unknown>): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const violations: string[] = [];

  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_SERVICE_TOKEN']) {
    if (isInsecureDefaultSecret(asString(config[name]))) {
      violations.push(`${name} is a checked-in default value`);
    }
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    // Distinct signing keys keep a refresh token from verifying as an access token.
    violations.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }

  // Story 2.4: the shared Admin Console PIN is gone; administrators sign in
  // by name. A host that still carries the old secret is refused, so nobody
  // relies on, or keeps, a PIN that no longer opens anything.
  if (asString(config.ADMIN_CONSOLE_PIN)) {
    violations.push(
      'ADMIN_CONSOLE_PIN is no longer used (administrators sign in by name); remove it',
    );
  }

  const kdsPins = asString(config.KDS_VENUE_PINS);
  if (kdsPins) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(kdsPins);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      violations.push('KDS_VENUE_PINS is not a JSON object of venue ID to PIN');
    } else {
      for (const [venueId, pin] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof pin !== 'string') {
          violations.push(`KDS_VENUE_PINS[${venueId}] is not a string`);
        } else {
          violations.push(...pinViolations(`KDS_VENUE_PINS[${venueId}]`, pin));
        }
      }
    }
  }

  if (config.TABLE19_LIVE_TEST_ENABLED === true) {
    violations.push('TABLE19_LIVE_TEST_ENABLED is a development-only validation mode');
  }
  return violations;
}

function pinViolations(surface: string, pin: string): string[] {
  const out: string[] = [];
  if (pin === INSECURE_DEFAULT_PIN) out.push(`${surface} is the checked-in default PIN`);
  if (pin.length < PRODUCTION_MIN_PIN_LENGTH) {
    out.push(`${surface} is shorter than ${PRODUCTION_MIN_PIN_LENGTH} characters`);
  }
  return out;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

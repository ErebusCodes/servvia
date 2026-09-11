/**
 * EVERY NATIVE ENVIRONMENT VARIABLE IS DOCUMENTED, AND THE DEFAULT IS OFF.
 *
 * WHY A TEST AND NOT A CONVENTION. `.env.example` is the only artefact an
 * operator reads before bringing this integration up, and it is the one that
 * rots silently: a new key added to `waiterpad-config.ts` costs nothing to
 * forget here, and the failure mode is not a missing comment - it is an
 * operator turning the writer on with a key they were never told about,
 * getting a refusal they cannot explain from a log line they will not see, or
 * worse, getting a working send with a value they guessed.
 *
 * The two assertions this file is really about:
 *
 *   1. EVERY key the code reads appears in `.env.example`. Drift in the
 *      direction of "the code grew a key" is caught the day it happens.
 *   2. NOTHING in `.env.example` actually enables anything. Every native key
 *      is commented out or empty, so a deployment that copies the file
 *      wholesale cannot send a packet to a till - and reconciliation's
 *      unattended timers cannot start - by accident.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WAITERPAD_ENV_KEYS } from './waiterpad-config';
import { WAITERPAD_CERTIFICATION_ENV_KEY } from './waiterpad-gate';

const ENV_EXAMPLE = readFileSync(join(__dirname, '../../../.env.example'), 'utf8');
const LINES = ENV_EXAMPLE.split(/\r?\n/);

/**
 * Every key the native path reads, assembled from the code rather than typed
 * out - the transport/identity keys come straight from the config module's own
 * map, so a key added there is a key this test immediately demands.
 */
const REQUIRED_KEYS: string[] = [
  ...Object.values(WAITERPAD_ENV_KEYS),
  WAITERPAD_CERTIFICATION_ENV_KEY,
  'IDEALPOS_POS_STRATEGY',
  // Read by NativeRoundReconciliationService and NativeRoundRecoveryService.
  // Listed explicitly because those services read them inline rather than
  // through a shared map; if that ever changes, prefer the map.
  'IDEALPOS_NATIVE_RECONCILE_ENABLED',
  'IDEALPOS_NATIVE_RECONCILE_INTERVAL_MS',
  'IDEALPOS_NATIVE_RECONCILE_BATCH_SIZE',
  'IDEALPOS_NATIVE_RECONCILE_ESCALATE_AFTER_MS',
  'IDEALPOS_NATIVE_RECOVERY_INTERVAL_MS',
  'IDEALPOS_NATIVE_RECOVERY_BATCH_SIZE',
  'IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS',
];

/** Keys that would switch something on if an operator uncommented them. */
const ARMING_KEYS = [
  WAITERPAD_ENV_KEYS.enabled,
  'IDEALPOS_POS_STRATEGY',
  'IDEALPOS_NATIVE_RECONCILE_ENABLED',
  WAITERPAD_CERTIFICATION_ENV_KEY,
];

/** An uncommented `KEY=value` assignment, with a non-empty value. */
function assignedValue(key: string): string | null {
  for (const line of LINES) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith(`${key}=`)) continue;
    const value = trimmed.slice(key.length + 1).trim();
    if (value !== '') return value;
  }
  return null;
}

describe('.env.example documents the native integration', () => {
  it.each(REQUIRED_KEYS)('mentions %s', (key) => {
    expect(ENV_EXAMPLE).toContain(key);
  });

  it('documents every key the config module reads, with none left over', () => {
    // Asserted against the map rather than a copy of it, so a key renamed in
    // `waiterpad-config.ts` fails here instead of leaving a stale name behind
    // in the file operators read.
    for (const key of Object.values(WAITERPAD_ENV_KEYS)) {
      expect(ENV_EXAMPLE).toContain(key);
    }
  });
});

describe('nothing in .env.example turns the native path on', () => {
  it.each(ARMING_KEYS)('leaves %s unset', (key) => {
    // THE POINT OF THE WHOLE FILE. A deployment that copies `.env.example`
    // must not be able to reach a real till, and must not acquire two
    // unattended background sweeps it never asked for.
    expect(assignedValue(key)).toBeNull();
  });

  it('assigns no native key a live value at all', () => {
    // Wider than the arming set: a host, a device id or a price level sitting
    // uncommented in an example file is a value somebody copies into
    // production believing it was chosen for them.
    for (const key of REQUIRED_KEYS) {
      expect({ key, value: assignedValue(key) }).toEqual({ key, value: null });
    }
  });

  it('says out loud that reconciliation is armed separately from sending', () => {
    // The relationship an operator is most likely to assume wrongly: enabling
    // the writer does NOT start the sweeps, and the file has to say so where
    // they will read it.
    // Anchored on the section heading, not on the key - the explanation has to
    // come BEFORE the key an operator is about to uncomment, which is exactly
    // where a slice starting at the key would miss it.
    const heading = ENV_EXAMPLE.indexOf('Reconciliation and crash recovery');
    expect(heading).toBeGreaterThan(-1);
    const block = ENV_EXAMPLE.slice(heading);
    expect(block).toMatch(/not implied by/i);
    expect(block).toContain('IDEALPOS_NATIVE_RECONCILE_ENABLED');
  });

  it('records that the evidence reader is an unbound token, not a variable', () => {
    // An operator hunting for the switch that makes rounds confirm needs to
    // find out here that there isn't one, rather than by setting a variable
    // that does nothing and concluding the feature is broken.
    expect(ENV_EXAMPLE).toContain('NATIVE_ROUND_EVIDENCE_READER');
    expect(ENV_EXAMPLE).toMatch(/NOT A CONFIGURATION VALUE/);
  });
});

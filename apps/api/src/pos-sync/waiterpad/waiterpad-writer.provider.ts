/**
 * Which table-round writer the running application gets, and why.
 *
 * THIS IS WHERE THE FEATURE GATE ACTUALLY LIVES. Everything downstream of the
 * Order Tablet depends on `TABLE_ROUND_WRITER`, an opaque injection token, and
 * has no way to ask which implementation it received. That is deliberate: a
 * consumer that could tell the difference would eventually branch on it, and a
 * branch is where a fallback gets added. There is exactly one decision point,
 * it happens once at startup, and it is this factory.
 *
 * THE THREE STATES, AND THE FACT THAT TWO OF THEM ARE IDENTICAL DOWNSTREAM:
 *
 *   disabled (the default)   -> DisabledTableRoundWriter, zero socket activity
 *   enabled + invalid config -> DisabledTableRoundWriter, zero socket activity
 *   enabled + valid config   -> WaiterPadTableRoundWriter
 *
 * A misconfiguration is NOT a startup crash. That is a considered choice for a
 * restaurant: an API that refuses to boot because a till address is wrong
 * takes down ordering, kitchen display and every screen in the building to
 * protect a feature that is off. Refusing the FEATURE while the rest of the
 * system serves is strictly safer than refusing the BUILDING. The refusal is
 * loud - it logs every reason at error level and keeps them on the writer, so
 * a staff-facing failure names the real cause rather than "unavailable".
 *
 * WHAT CANNOT HAPPEN HERE. There is no path that returns a writer built from a
 * partial config, no default host, no default DeviceID, and no fallback to
 * Webit. `resolveWaiterPadConfig` returns a disabled result carrying no host
 * and no identity, so even a bug that ignored `enabled` would have nothing to
 * connect to.
 */

import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { resolveWaiterPadConfig, WAITERPAD_ENV_KEYS, type WaiterPadEnv } from './waiterpad-config';
import { NativeSendAttemptStore } from './native-send-attempt.store';
import {
  DisabledTableRoundWriter,
  WaiterPadTableRoundWriter,
  type ITableRoundWriter,
} from './waiterpad-table-round-writer';

/** The only handle the application has on a writer. */
export const TABLE_ROUND_WRITER = Symbol('TABLE_ROUND_WRITER');

/**
 * Read the writer's configuration from Nest's ConfigService rather than
 * `process.env` directly, so tests and per-venue overrides work through the
 * same mechanism as the rest of the API.
 */
export function readWaiterPadEnv(config: ConfigService): WaiterPadEnv {
  const env: Record<string, string | undefined> = {};
  for (const key of Object.values(WAITERPAD_ENV_KEYS)) {
    env[key] = config.get<string>(key);
  }
  return env;
}

export function createTableRoundWriter(
  config: ConfigService,
  prisma: PrismaService,
  logger: Logger = new Logger('WaiterPadWriter'),
): ITableRoundWriter {
  const resolution = resolveWaiterPadConfig(readWaiterPadEnv(config));

  if (!resolution.enabled) {
    // Not an error when the feature is simply off - which is the default and
    // the production state today. It IS an error when someone asked for it and
    // got a writer that will refuse every round, so say so at the right level.
    const askedFor = config.get<string>(WAITERPAD_ENV_KEYS.enabled) === 'true';
    const detail = resolution.reasons.join('; ');
    if (askedFor) {
      logger.error(
        `IdealPOS native table-round writer was ENABLED but the configuration is ` +
          `incomplete, so it stays disabled and no packet can be sent: ${detail}`,
      );
    } else {
      logger.log(`IdealPOS native table-round writer is disabled: ${detail}`);
    }
    return new DisabledTableRoundWriter(resolution.reasons);
  }

  const { host, port, identity, pricePolicy, allowNonZeroSeat } = resolution.config;
  logger.warn(
    `IdealPOS native table-round writer is ACTIVE -> ${host}:${port} as DeviceID ` +
      `${identity.deviceId}, price policy ${pricePolicy.kind}` +
      (pricePolicy.kind === 'nativeResolved' ? ` (level ${pricePolicy.priceLevel})` : '') +
      `, non-zero seat ${allowNonZeroSeat ? 'ALLOWED' : 'refused'}. ` +
      'Rounds sent from here reach a real till.',
  );

  const store = new NativeSendAttemptStore(prisma);
  return new WaiterPadTableRoundWriter(resolution.config, {
    recordSendInitiated: (record) => store.recordSendInitiated(record),
    recordOutcome: (record, outcome) => store.recordOutcome(record, outcome),
    // The conclusion, not just the observation. Bound here rather than left
    // optional-and-unbound: the method existed for three commits with no
    // production caller, which meant every attempt row in the database had an
    // empty `decision` column and a support engineer reading one could see
    // what the till said but not what we decided about it.
    recordDecision: (record, decision) => store.recordDecision(record, decision),
  });
}

export const tableRoundWriterProvider: Provider = {
  provide: TABLE_ROUND_WRITER,
  inject: [ConfigService, PrismaService],
  useFactory: (config: ConfigService, prisma: PrismaService): ITableRoundWriter =>
    createTableRoundWriter(config, prisma),
};

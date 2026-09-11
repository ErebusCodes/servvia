/**
 * THE COMBINATION THAT MUST NOT SHIP, ASSERTED AS A TRUTH TABLE.
 *
 * `native writer ACTIVE + nothing that could confirm a round` is not a degraded
 * version of this product. A round sent by such a build does not fail — it
 * waits out its window, becomes `unresolved`, and holds its table's single
 * in-flight slot until a human settles it. For every round. Of every service.
 * And the build looks healthy the whole time, which is why this is a startup
 * refusal rather than a note in a runbook.
 *
 * The escape hatch is tested as carefully as the refusal, because an escape
 * hatch that is easy to trip is the same bug wearing a different hat.
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ACCEPT_NO_CONFIRMATION_VALUE,
  ACTIVATION_INVARIANT_ENV_KEYS as K,
  CONNECTOR_EVIDENCE_READER,
  checkActivationInvariant,
} from './waiterpad-activation-invariant';
import { createTableRoundWriter } from './waiterpad-writer.provider';
import { WAITERPAD_ENV_KEYS } from './waiterpad-config';
import type { PrismaService } from '../../prisma/prisma.service';

/** A writer configuration that is complete in every respect. */
const COMPLETE_WRITER_CONFIG: Record<string, string> = {
  [WAITERPAD_ENV_KEYS.enabled]: 'true',
  [WAITERPAD_ENV_KEYS.host]: '192.168.1.50',
  [WAITERPAD_ENV_KEYS.port]: '6983',
  [WAITERPAD_ENV_KEYS.deviceId]: 'VERDURA-PROD-0001',
  [WAITERPAD_ENV_KEYS.localAddress]: '192.168.1.90',
  [WAITERPAD_ENV_KEYS.pocketPad]: '3.4.5',
  [WAITERPAD_ENV_KEYS.deviceModel]: 'Verdura Tablet',
  [WAITERPAD_ENV_KEYS.deviceOs]: 'Android 14',
  [WAITERPAD_ENV_KEYS.posTerminal]: '2',
  [WAITERPAD_ENV_KEYS.clerk]: '1',
  [WAITERPAD_ENV_KEYS.map]: '1',
  [WAITERPAD_ENV_KEYS.location]: '0',
  [WAITERPAD_ENV_KEYS.pricePolicy]: 'nativeResolved',
  [WAITERPAD_ENV_KEYS.priceLevel]: '1',
};

const CONFIRMATION_AVAILABLE: Record<string, string> = {
  [K.evidenceReader]: CONNECTOR_EVIDENCE_READER,
  [K.reconcileEnabled]: 'true',
};

describe('the invariant itself', () => {
  it('is satisfied when the writer is on and both halves of confirmation are present', () => {
    const r = checkActivationInvariant({ [K.nativeEnabled]: 'true', ...CONFIRMATION_AVAILABLE });

    expect(r.refuseActivation).toBe(false);
    expect(r.canConfirmAutomatically).toBe(true);
    expect(r.readyForLiveActivation).toBe(true);
  });

  it('REFUSES a writer with no evidence reader bound', () => {
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.reconcileEnabled]: 'true',
    });

    expect(r.refuseActivation).toBe(true);
    expect(r.readyForLiveActivation).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no evidence reader is bound/i);
  });

  it('REFUSES a writer whose reconciliation sweep never runs', () => {
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.evidenceReader]: CONNECTOR_EVIDENCE_READER,
    });

    expect(r.refuseActivation).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/sweep never runs/i);
  });

  it('names BOTH missing halves rather than making an operator guess', () => {
    const r = checkActivationInvariant({ [K.nativeEnabled]: 'true' });

    const text = r.reasons.join(' ');
    expect(text).toMatch(/no evidence reader is bound/i);
    expect(text).toMatch(/sweep never runs/i);
  });

  it('treats a misspelled reader as a misconfiguration, never as "no reader"', () => {
    // `IDEALPOS_NATIVE_EVIDENCE_READER=conector` failing silently is a
    // four-hour evening. It is named.
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.reconcileEnabled]: 'true',
      [K.evidenceReader]: 'conector',
    });

    expect(r.refuseActivation).toBe(true);
    expect(r.reasons.join(' ')).toContain("'conector'");
  });

  it('does not refuse anything while the writer is off, whatever else is set', () => {
    for (const env of [
      {},
      { [K.reconcileEnabled]: 'true' },
      { [K.evidenceReader]: 'nonsense' },
      { [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE },
    ]) {
      const r = checkActivationInvariant(env);
      expect(r.refuseActivation).toBe(false);
      expect(r.nativeWriterRequested).toBe(false);
      // And a writer that is off is never "ready for live activation" either.
      expect(r.readyForLiveActivation).toBe(false);
    }
  });
});

describe('the degraded escape hatch', () => {
  it('permits a degraded build when the consequence is acknowledged verbatim', () => {
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
    });

    expect(r.refuseActivation).toBe(false);
    expect(r.degradedAcknowledged).toBe(true);
  });

  it('keeps a degraded build explicitly NOT ready for live activation', () => {
    // Legal and not ready are different questions, and a release check needs
    // both. A single enabled/disabled flag could not tell them apart.
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
    });

    expect(r.readyForLiveActivation).toBe(false);
    expect(r.canConfirmAutomatically).toBe(false);
  });

  it('says plainly what the degraded build will do to every round', () => {
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
    });

    expect(r.reasons.join(' ')).toMatch(/must not take a live service/i);
  });

  it.each(['true', '1', 'yes', 'TRUE', 'every-round-needs-a-human ', 'Every-Round-Needs-A-Human'])(
    'refuses the acknowledgement value %p — it must be the exact sentence',
    (value) => {
      // A boolean would be set by muscle memory and forgotten. A sentence that
      // describes the consequence has to be read.
      const r = checkActivationInvariant({
        [K.nativeEnabled]: 'true',
        [K.acceptNoConfirmation]: value,
      });

      expect(r.refuseActivation).toBe(true);
      expect(r.degradedAcknowledged).toBe(false);
    },
  );

  it('does not let the acknowledgement rescue a misspelled reader', () => {
    const r = checkActivationInvariant({
      [K.nativeEnabled]: 'true',
      [K.reconcileEnabled]: 'true',
      [K.evidenceReader]: 'conector',
      [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
    });

    // It is legal — an operator said they accept no confirmation — but the
    // typo is still reported, because it is almost certainly not what they meant.
    expect(r.degradedAcknowledged).toBe(true);
    expect(r.reasons.join(' ')).toContain("'conector'");
  });
});

describe('the provider actually refuses', () => {
  const prisma = {} as PrismaService;

  /**
   * A logger whose spies are returned ALONGSIDE it rather than read back off
   * it. `expect(logger.error)` detaches a method from its object, which is
   * exactly what `@typescript-eslint/unbound-method` exists to catch, and
   * silencing the rule here would be silencing it for a real reason.
   */
  function silentLogger(): { logger: Logger; error: jest.SpyInstance; warn: jest.SpyInstance } {
    const logger = new Logger('test');
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    return { logger, error, warn };
  }

  it('returns a DISABLED writer for a perfectly configured writer that cannot confirm', async () => {
    // Every writer variable is correct. The build still must not run, and this
    // is the case a config-completeness check alone would wave through.
    const writer = createTableRoundWriter(
      new ConfigService({ ...COMPLETE_WRITER_CONFIG }),
      prisma,
      silentLogger().logger,
    );

    await expect(
      writer.writeRound({
        round: { roundId: 'r', idempotencyKey: 'k', persisted: true } as never,
        attemptId: 'a',
        table: 5,
        guests: 2,
        lines: [{ plu: '23', description: 'x', quantity: 1 }],
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it('returns a LIVE writer once confirmation is available', () => {
    const writer = createTableRoundWriter(
      new ConfigService({ ...COMPLETE_WRITER_CONFIG, ...CONFIRMATION_AVAILABLE }),
      prisma,
      silentLogger().logger,
    );

    expect(writer.constructor.name).toBe('WaiterPadTableRoundWriter');
  });

  it('returns a live writer for an acknowledged degraded build', () => {
    const writer = createTableRoundWriter(
      new ConfigService({
        ...COMPLETE_WRITER_CONFIG,
        [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
      }),
      prisma,
      silentLogger().logger,
    );

    expect(writer.constructor.name).toBe('WaiterPadTableRoundWriter');
  });

  it('logs the refusal at error level, naming the real cause', () => {
    const { logger, error } = silentLogger();
    createTableRoundWriter(new ConfigService({ ...COMPLETE_WRITER_CONFIG }), prisma, logger);

    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/REFUSED by the activation invariant/i),
    );
  });

  it('warns on every start of a degraded build', () => {
    const { logger, warn } = silentLogger();
    createTableRoundWriter(
      new ConfigService({
        ...COMPLETE_WRITER_CONFIG,
        [K.acceptNoConfirmation]: ACCEPT_NO_CONFIRMATION_VALUE,
      }),
      prisma,
      logger,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/running DEGRADED/i));
  });

  it('records on the ACTIVE line whether confirmation is available', () => {
    const { logger, warn } = silentLogger();
    createTableRoundWriter(
      new ConfigService({ ...COMPLETE_WRITER_CONFIG, ...CONFIRMATION_AVAILABLE }),
      prisma,
      logger,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/automatic confirmation AVAILABLE/));
  });

  it('still refuses an incomplete writer config even when confirmation is available', () => {
    // The two gates are independent and both must pass.
    const { logger } = silentLogger();
    const writer = createTableRoundWriter(
      new ConfigService({
        ...COMPLETE_WRITER_CONFIG,
        ...CONFIRMATION_AVAILABLE,
        [WAITERPAD_ENV_KEYS.host]: '',
      }),
      prisma,
      logger,
    );

    expect(writer.constructor.name).toBe('DisabledTableRoundWriter');
  });
});

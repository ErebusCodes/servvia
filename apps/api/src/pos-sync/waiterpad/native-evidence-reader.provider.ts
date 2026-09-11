/**
 * Which evidence reader the running application gets, and why it is usually
 * none.
 *
 * THE DEFAULT IS UNBOUND, AND THAT IS A SUPPORTED STATE. A reconciliation sweep
 * with no reader gathers no evidence, confirms nothing, releases nothing, and
 * still does the half of its job that needs no till access: telling staff,
 * after a bounded wait, that a round nobody can vouch for needs a human. That
 * is production today.
 *
 * WHAT CHANGED IS THE PAIRING, NOT THE DEFAULT. A build may no longer run the
 * native WRITER while holding nothing that could confirm a round - see
 * `waiterpad-activation-invariant.ts`. So the two decisions are made from the
 * same variable and they agree by construction: if the invariant says a reader
 * is bound, this factory binds one.
 *
 * A NAME RATHER THAN A BOOLEAN, for two reasons. There may one day be a second
 * reader, and more importantly a typo must not read as "no reader". The
 * invariant reports the typo at error level; this factory returns null for it,
 * which is the safe half of the same decision - a build that meant to have a
 * reader and does not will refuse to activate the writer rather than run blind.
 */

import { type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConnectorNativeEvidenceReader } from './connector-native-evidence.reader';
import {
  ACTIVATION_INVARIANT_ENV_KEYS,
  CONNECTOR_EVIDENCE_READER,
} from './waiterpad-activation-invariant';
import {
  NATIVE_ROUND_EVIDENCE_READER,
  type NativeRoundEvidenceReader,
} from './native-round-reconciliation.service';

export const nativeEvidenceReaderProvider: Provider = {
  provide: NATIVE_ROUND_EVIDENCE_READER,
  inject: [ConfigService, ConnectorNativeEvidenceReader],
  useFactory: (
    config: ConfigService,
    connectorReader: ConnectorNativeEvidenceReader,
  ): NativeRoundEvidenceReader | null =>
    (config.get<string>(ACTIVATION_INVARIANT_ENV_KEYS.evidenceReader) ?? '').trim() ===
    CONNECTOR_EVIDENCE_READER
      ? connectorReader
      : null,
};

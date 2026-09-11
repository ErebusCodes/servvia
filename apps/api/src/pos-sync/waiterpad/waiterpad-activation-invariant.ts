/**
 * THE ONE COMBINATION THAT MUST NOT SHIP.
 *
 *     native writer ACTIVE  +  no way to confirm a round
 *
 * Each half is individually legitimate. The writer has its own complete
 * configuration gate (`waiterpad-config.ts`), and the reconciler runs happily
 * with no evidence reader bound — that is production today, and it still does
 * the escalation half of its job. What no build may do is put a real packet on
 * a real till while holding nothing that could ever answer "did it land".
 *
 * WHY THAT COMBINATION IS WORSE THAN EITHER FAILURE ALONE. A round that cannot
 * be machine-confirmed does not fail. It goes to `awaiting_native_confirmation`,
 * waits out its window, and becomes `unresolved` — which occupies the table's
 * single in-flight slot until a human settles it. So the configuration does not
 * degrade gracefully; it guarantees manual intervention for EVERY round of
 * every service, and the failure is silent until the restaurant is full. The
 * product is a waiter pressing Send and seeing green. A build that can only
 * ever show amber is not a degraded version of that product, it is a different
 * one, and shipping it by accident is the specific accident this file prevents.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEGRADED IS ALLOWED. SILENTLY DEGRADED IS NOT.
 *
 * Bringing a venue up in stages is a real need: deploy the application with
 * native off, prove the migration, then wire the readers, then activate. The
 * first stages are fine precisely because the writer is off. The stage this
 * refuses is the one where the writer is ON and nothing can confirm.
 *
 * There is an escape hatch for a deliberately degraded staging build, and it is
 * deliberately awkward: an operator must set
 * `IDEALPOS_WAITERPAD_ACCEPT_NO_CONFIRMATION` to the exact sentence
 * `every-round-needs-a-human`. A boolean would be set by muscle memory and
 * forgotten; a sentence that describes the consequence has to be read. It is
 * reported as a WARNING on every start, and `readyForLiveActivation` stays
 * false — so a release check can tell "deliberately degraded" from "ready",
 * which a single enabled/disabled flag could not.
 *
 * PURE. A function of an environment map. No I/O, no Nest, no globals, so the
 * invariant is testable directly and is tested against every combination.
 */

/** The keys this invariant reads. Every one of them already exists; none is new configuration. */
export const ACTIVATION_INVARIANT_ENV_KEYS = {
  /** The native writer's own master switch. */
  nativeEnabled: 'IDEALPOS_WAITERPAD_NATIVE_ENABLED',
  /** The reconciliation sweep's master switch. Without it, nothing ever looks at the till. */
  reconcileEnabled: 'IDEALPOS_NATIVE_RECONCILE_ENABLED',
  /**
   * Which evidence reader to bind. `connector` is the only implementation:
   * it mediates both reads through the Venue Connector, which is the component
   * that holds the till credentials.
   */
  evidenceReader: 'IDEALPOS_NATIVE_EVIDENCE_READER',
  /**
   * Where the "before" of the confirmation delta comes from. `connector` is the
   * only implementation.
   *
   * A THIRD REQUIREMENT, and it is not redundant with the other two. A reader
   * and a sweep together can gather the table as it is NOW; without a baseline
   * there is nothing to subtract it from, so the delta cannot be computed and
   * no round can ever be confirmed. A build with a reader, a sweep and no
   * baseline source is exactly as unable to confirm as one with neither, and
   * looks far more configured.
   */
  baselineSource: 'IDEALPOS_NATIVE_BASELINE_SOURCE',
  /** The deliberate, awkward acknowledgement that this build cannot confirm anything. */
  acceptNoConfirmation: 'IDEALPOS_WAITERPAD_ACCEPT_NO_CONFIRMATION',
} as const;

/** The only accepted evidence reader. A typo is a refusal, never a silent fallback to none. */
export const CONNECTOR_EVIDENCE_READER = 'connector';

/** The only accepted baseline source. Same rule: a typo is a refusal. */
export const CONNECTOR_BASELINE_SOURCE = 'connector';

/**
 * The exact value that acknowledges a degraded build. It is a sentence about
 * the consequence rather than a boolean, so that setting it is an act of
 * reading rather than of habit.
 */
export const ACCEPT_NO_CONFIRMATION_VALUE = 'every-round-needs-a-human';

export interface ActivationInvariantResult {
  /** True when the writer is on. */
  readonly nativeWriterRequested: boolean;
  /** True when a round sent by this build could ever become `confirmed` without a human. */
  readonly canConfirmAutomatically: boolean;
  /**
   * True only for a build that may take real orders on a real till for a real
   * service. A deliberately degraded staging build is `false` here AND legal —
   * the two are different questions and a release check needs both.
   */
  readonly readyForLiveActivation: boolean;
  /** True when the combination is refused outright and the writer must stay disabled. */
  readonly refuseActivation: boolean;
  /** Everything an operator needs, in the order they will want it. */
  readonly reasons: readonly string[];
  /** Present when a degraded build was explicitly acknowledged. */
  readonly degradedAcknowledged: boolean;
}

/**
 * Evaluate the invariant.
 *
 * NOTE WHAT IS NOT CHECKED HERE. Whether the connector can actually reach the
 * till, whether its connection strings are set, whether the login has the right
 * grants — none of that is visible from the API process, and claiming to check
 * it would be the same over-claim the connector's own gates refuse to make from
 * the other side. What IS checkable here is whether this build has a reader
 * BOUND and a sweep RUNNING, which is the difference between "might confirm"
 * and "certainly cannot". A build that passes this can still fail to confirm
 * because the venue end is misconfigured; a build that fails it cannot confirm
 * for any reason at all.
 */
export function checkActivationInvariant(
  env: Readonly<Record<string, string | undefined>>,
): ActivationInvariantResult {
  const K = ACTIVATION_INVARIANT_ENV_KEYS;
  const reasons: string[] = [];

  const nativeWriterRequested = env[K.nativeEnabled] === 'true';
  const reconcileEnabled = env[K.reconcileEnabled] === 'true';
  const readerSelection = (env[K.evidenceReader] ?? '').trim();
  const readerBound = readerSelection === CONNECTOR_EVIDENCE_READER;
  const baselineSelection = (env[K.baselineSource] ?? '').trim();
  const baselineBound = baselineSelection === CONNECTOR_BASELINE_SOURCE;

  if (baselineSelection !== '' && !baselineBound) {
    reasons.push(
      `${K.baselineSource} is '${baselineSelection}', which is not a baseline source this build ` +
        `knows. The only value is '${CONNECTOR_BASELINE_SOURCE}'.`,
    );
  }

  if (readerSelection !== '' && !readerBound) {
    // A typo must not read as "no reader". It reads as a misconfiguration, and
    // it is named, because `IDEALPOS_NATIVE_EVIDENCE_READER=conector` failing
    // silently is a four-hour evening.
    reasons.push(
      `${K.evidenceReader} is '${readerSelection}', which is not a reader this build knows. ` +
        `The only value is '${CONNECTOR_EVIDENCE_READER}'.`,
    );
  }

  // Automatic confirmation needs ALL THREE. A reader with no sweep never runs;
  // a sweep with no reader gathers nothing; and either of them without a
  // baseline has nothing to subtract, so the delta that IS the durable half
  // cannot be computed at all.
  const canConfirmAutomatically = readerBound && reconcileEnabled && baselineBound;

  if (!nativeWriterRequested) {
    // The writer is off. Nothing can reach a till, so the invariant has nothing
    // to protect and the build is legal whatever else is set.
    return {
      nativeWriterRequested: false,
      canConfirmAutomatically,
      readyForLiveActivation: false,
      refuseActivation: false,
      degradedAcknowledged: false,
      reasons: [
        `${K.nativeEnabled} is not "true": the native writer is off and no packet can reach a till.`,
        ...reasons,
      ],
    };
  }

  if (canConfirmAutomatically) {
    return {
      nativeWriterRequested: true,
      canConfirmAutomatically: true,
      readyForLiveActivation: true,
      refuseActivation: false,
      degradedAcknowledged: false,
      reasons: [
        'the native writer is active and this build can confirm a round automatically: ' +
          `${K.evidenceReader}=${CONNECTOR_EVIDENCE_READER}, ` +
          `${K.baselineSource}=${CONNECTOR_BASELINE_SOURCE} and ${K.reconcileEnabled}=true. ` +
          'Whether the venue end can actually reach the till is not visible from here and is ' +
          'not claimed.',
        ...reasons,
      ],
    };
  }

  // The writer is on and nothing can confirm. Say exactly which half is missing
  // — an operator with one wrong variable should not have to guess between two.
  const missing: string[] = [];
  if (!readerBound && readerSelection === '') {
    missing.push(
      `${K.evidenceReader} is not set, so no evidence reader is bound and nothing will ever ` +
        'look at the till',
    );
  }
  if (!reconcileEnabled) {
    missing.push(
      `${K.reconcileEnabled} is not "true", so the reconciliation sweep never runs and no ` +
        'evidence would be acted on even if it were gathered',
    );
  }
  if (!baselineBound && baselineSelection === '') {
    missing.push(
      `${K.baselineSource} is not set, so no pre-send baseline is ever captured and the ` +
        'confirmation delta has nothing to subtract - the table as it is now cannot be ' +
        'separated from the lines that were already on it',
    );
  }

  const acknowledged = env[K.acceptNoConfirmation] === ACCEPT_NO_CONFIRMATION_VALUE;

  if (acknowledged) {
    return {
      nativeWriterRequested: true,
      canConfirmAutomatically: false,
      // Legal, and explicitly NOT ready. That distinction is the point.
      readyForLiveActivation: false,
      refuseActivation: false,
      degradedAcknowledged: true,
      reasons: [
        'DEGRADED BUILD, DELIBERATELY. The native writer is ACTIVE and this build cannot ' +
          'confirm any round automatically, which was acknowledged by setting ' +
          `${K.acceptNoConfirmation}=${ACCEPT_NO_CONFIRMATION_VALUE}. Every round sent will ` +
          'wait out its window, become `unresolved`, and occupy its table until a human ' +
          'settles it. This is a staging configuration. It must not take a live service.',
        ...missing,
        ...reasons,
      ],
    };
  }

  return {
    nativeWriterRequested: true,
    canConfirmAutomatically: false,
    readyForLiveActivation: false,
    refuseActivation: true,
    degradedAcknowledged: false,
    reasons: [
      'REFUSED: the native writer is enabled but this build could never confirm a round. ' +
        'Every round would wait out its window, become `unresolved`, and hold its table until ' +
        'a human settled it — for every round of every service. The writer stays disabled.',
      ...missing,
      ...reasons,
      `If this is a deliberately degraded staging build, set ` +
        `${K.acceptNoConfirmation}=${ACCEPT_NO_CONFIRMATION_VALUE} to say so. It will be ` +
        'reported as a warning on every start and the build will not be marked ready for live ' +
        'activation.',
    ],
  };
}

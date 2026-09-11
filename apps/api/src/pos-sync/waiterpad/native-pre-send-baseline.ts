/**
 * WHERE THE "BEFORE" OF THE DELTA COMES FROM.
 *
 * Confirmation subtracts: the table after the round, minus the table before it,
 * must equal exactly what the round asked for. The attempt row stores that
 * "before" — but something has to produce it, and nothing did. A baseline that
 * is never captured is a round that can never be machine-confirmed, so this
 * port is the difference between a confirmation path that exists and one that
 * runs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT A READ AT SEND TIME.
 *
 * The obvious design is to read the table synchronously just before opening the
 * socket. It is the wrong one here, for two reasons that both end at a waiter
 * standing in a dining room:
 *
 *   LATENCY. The till is reachable only through the Venue Connector, which
 *   POLLS. A read at send time would make every Send wait for a poll interval
 *   plus a query — seconds, on the one interaction that has to feel instant.
 *
 *   COUPLING. A read that failed would have to either block the Send or be
 *   ignored. Blocking means a database hiccup at the venue stops food reaching
 *   the kitchen; ignoring means the failure is silent. Neither is acceptable,
 *   and the choice between them should not exist.
 *
 * So the baseline is the freshest observation ALREADY on file, and a round with
 * no fresh observation is sent anyway and simply cannot be machine-confirmed.
 * That is the correct trade: the send is what the customer is waiting for, and
 * an unconfirmable round escalates to a human rather than failing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * STALENESS IS THE REAL RISK, AND IT FAILS CLOSED.
 *
 * An observation taken minutes ago may no longer describe the table: a waiter
 * could have rung items in at the terminal since. Consider what that does to
 * the delta rather than to the baseline —
 *
 *   the table gained lines we did not send  -> unexplained growth -> conflicting
 *   the table lost lines                    -> prior lines changed -> conflicting
 *
 * Both go to a human. A stale baseline therefore costs confirmations and cannot
 * manufacture one, which is the only direction this is allowed to fail in. The
 * freshness bound below is about how OFTEN that happens, never about whether an
 * error can slip through.
 */

import type { NativeTableSnapshot } from './waiterpad-native-evidence';

/**
 * How old an observation may be and still be offered as a baseline.
 *
 * Two minutes is a judgement about a dining room, not a safety boundary: it is
 * roughly how long a table can go unobserved before someone has plausibly
 * touched it at the terminal. Shorter costs confirmations on quiet tables;
 * longer just means more rounds reach a human. Neither can produce a wrong
 * answer — see the header.
 */
export const DEFAULT_BASELINE_MAX_AGE_MS = 2 * 60_000;

/**
 * How far into the future an observation's timestamp may sit and still be
 * believed.
 *
 * IT CANNOT BE ZERO, and finding that out cost a flaky test. The observation is
 * stamped by whatever read the table — another process, and in production
 * another MACHINE — while the age is measured against this process's clock. Two
 * clocks are never identical, so a perfectly fresh observation routinely
 * arrives a few milliseconds "in the future". Refusing those outright would
 * discard the freshest evidence available and, on a venue whose connector clock
 * runs slightly ahead, would refuse EVERY baseline while looking like a
 * capability that was simply never configured.
 *
 * A minute is generous for NTP-synced machines and still far too small to let a
 * genuinely wrong clock through: an observation an hour in the future is a
 * misconfiguration, not skew, and is still refused.
 */
export const MAX_BASELINE_CLOCK_SKEW_MS = 60_000;

/**
 * The port. One method, and it returns an observation or nothing.
 *
 * DELIBERATELY CANNOT FAIL LOUDLY. It returns `undefined` rather than throwing,
 * because every caller is on the path a waiter is waiting on and none of them
 * has anything useful to do with an exception. "No baseline" is a first-class
 * answer with a defined consequence — the round cannot be machine-confirmed —
 * and it is a much better one than an error propagating into a Send.
 */
export interface PreSendBaselineSource {
  /**
   * The freshest native observation of this table, or `undefined` if there is
   * none fresh enough to subtract against.
   */
  readBaseline(params: {
    readonly venueId: string;
    readonly posTableCode: string;
    readonly now: Date;
  }): Promise<NativeTableSnapshot | undefined>;
}

export const PRE_SEND_BASELINE_SOURCE = Symbol('PRE_SEND_BASELINE_SOURCE');

/**
 * Decide whether an observation is still usable as a baseline.
 *
 * Pure, so the rule is testable without a clock or a database, and separate
 * from any source so every implementation applies the SAME rule rather than
 * each inventing its own tolerance.
 *
 * A snapshot with no `observedAt` is refused. An observation whose age is
 * unknown could be from this second or from last Tuesday, and "unknown age" is
 * exactly the input that should not be trusted to describe a table now.
 */
export function isUsableBaseline(
  snapshot: NativeTableSnapshot | undefined,
  now: Date,
  maxAgeMs: number = DEFAULT_BASELINE_MAX_AGE_MS,
): snapshot is NativeTableSnapshot {
  if (!snapshot) return false;

  // Only a RESOLVED read is a baseline. "The table could not be read" and "two
  // sales matched" describe our ignorance, not the table, and subtracting
  // ignorance from an observation is not a delta.
  if (snapshot.status !== 'observed' && snapshot.status !== 'noOpenSale') return false;

  if (!snapshot.observedAt) return false;
  const observedAt = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAt)) return false;

  const ageMs = now.getTime() - observedAt;

  // A timestamp slightly AHEAD of this clock is ordinary skew between two
  // machines, not evidence of anything, and the freshest observation available
  // is exactly the one most likely to land there. Tolerated up to a bound.
  // Beyond that bound it is a wrong clock rather than a fast one, and an
  // observation from an hour in the future would otherwise be trusted forever.
  if (ageMs < 0) return -ageMs <= MAX_BASELINE_CLOCK_SKEW_MS;

  return ageMs <= maxAgeMs;
}

/**
 * The source every build gets until one is configured: no baseline, ever.
 *
 * Bound rather than left null so the absence is a decision with a name in the
 * dependency graph, and so the consequence is uniform: rounds are sent, and
 * they escalate to a human instead of confirming.
 */
export class NoPreSendBaselineSource implements PreSendBaselineSource {
  readBaseline(): Promise<NativeTableSnapshot | undefined> {
    return Promise.resolve(undefined);
  }
}

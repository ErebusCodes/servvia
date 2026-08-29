/**
 * The dual-read precedence for the order-handoff migration window (Menu
 * Management architecture, Phase D). `MenuItem.posProductCode` (the
 * deprecated column) and `PosProductIdentity` (the new model) can both
 * exist during this window — Phase E is what actually migrates the
 * production 9 verified mappings into `PosProductIdentity` and drops the
 * column. Until then, this is the ONLY place that decides which source
 * wins, so the two never silently disagree in two different code paths.
 *
 * Precedence, exactly in this order:
 * 1. A linked `PosProductIdentity` with `lifecycleStatus: 'active'` — its
 *    `nativeCode` wins outright, even if a (necessarily stale, since
 *    linking doesn't touch the legacy column) `posProductCode` also
 *    happens to be set.
 * 2. A linked `PosProductIdentity` in any OTHER lifecycle status
 *    (`pending_review`, `hidden`, `unavailable`, `source_missing`,
 *    `source_inactive`) — FAILS CLOSED. A non-active linked identity is an
 *    authoritative signal that this specific mapping is not currently
 *    trustworthy; falling back to the legacy column here would silently
 *    resurrect a mapping the system has already flagged as a problem.
 * 3. No `PosProductIdentity` linked at all — fall back to the legacy
 *    `posProductCode` column, if set. This is the real, current state of
 *    every one-of-9-already-verified production mapping during this
 *    migration window, and is expected to remain that way in production
 *    until Phase E runs `link-verified-pos-mappings.ts`.
 * 4. Neither exists — unmapped, fails closed.
 *
 * Never a name/title-based fallback under any branch.
 *
 * Phase E removes branch 3 (and this module's dual-read purpose
 * entirely) once every production MenuItem's POS identity lives in
 * `PosProductIdentity` and `MenuItem.posProductCode` is dropped — at that
 * point this function collapses to "read posIdentity.nativeCode or fail",
 * which should replace this module rather than keep it as a thin wrapper.
 */

export type ResolveNativeProductCodeFailureReason =
  | 'unmapped'
  | 'source_missing'
  | 'source_inactive'
  | 'hidden'
  | 'unavailable'
  | 'pending_review';

export interface ResolveNativeProductCodeInput {
  posProductCode: string | null;
  posIdentity: {
    nativeCode: string;
    lifecycleStatus:
      | 'pending_review'
      | 'active'
      | 'hidden'
      | 'unavailable'
      | 'source_missing'
      | 'source_inactive';
  } | null;
}

export type ResolveNativeProductCodeResult =
  | { ok: true; nativeCode: string }
  | { ok: false; reason: ResolveNativeProductCodeFailureReason };

export function resolveNativeProductCode(
  input: ResolveNativeProductCodeInput,
): ResolveNativeProductCodeResult {
  if (input.posIdentity) {
    if (input.posIdentity.lifecycleStatus === 'active') {
      return { ok: true, nativeCode: input.posIdentity.nativeCode };
    }
    // Any other linked lifecycle status fails closed — never falls
    // through to the legacy column below.
    return { ok: false, reason: input.posIdentity.lifecycleStatus };
  }

  if (input.posProductCode) {
    return { ok: true, nativeCode: input.posProductCode };
  }

  return { ok: false, reason: 'unmapped' };
}

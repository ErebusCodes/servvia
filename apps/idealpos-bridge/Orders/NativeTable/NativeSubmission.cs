using System;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    /// <summary>
    /// The durable submission state Verdura keeps for one native table round,
    /// independent of IdealPOS's own volatile Checksum dedup. This is the
    /// compensating control for the P0 #3 finding that IdealPOS has NO durable
    /// per-submission idempotency token (HandheldHelper's 100-slot / 10-minute
    /// in-memory ring buffer, STATIC-PROVEN volatile).
    /// </summary>
    public enum NativeSubmissionState
    {
        /// <summary>Persisted BEFORE the one bounded native submission. If the
        /// process dies here, recovery finds a SendInitiated with no confirmed
        /// outcome and must treat it as Uncertain — never resend blind.</summary>
        SendInitiated,

        /// <summary>The native side ACKed exactly one submission. Not yet
        /// proven durable (ACK precedes DB write natively), so still requires
        /// reconciliation.</summary>
        Submitted,

        /// <summary>Reconciliation positively confirmed the round's lines are on
        /// the table. Terminal, successful.</summary>
        Reconciled,

        /// <summary>Outcome unknown (timeout / lost response / crash / restart
        /// while in flight). Terminal for the automatic pipeline: requires
        /// operator verification. NEVER auto-resent.</summary>
        Uncertain,

        /// <summary>The native side gave a definite negative — nothing appended.
        /// Terminal.</summary>
        Rejected,

        /// <summary>A durable record already existed for this externalOrderId —
        /// no second submission was made. Terminal.</summary>
        Duplicate,

        /// <summary>The native transport is disabled/unproven; nothing was
        /// sent. Terminal, and explicitly not a failure.</summary>
        TransportDisabled,
    }

    public enum ResendDecision
    {
        DoNotResend,
        Resend,
    }

    /// <summary>The judgement of an interrupted/uncertain round. Decision is
    /// <see cref="ResendDecision.DoNotResend"/> in every case this decider can
    /// produce — automatic resend of an uncertain native round is never
    /// returned. RequiresOperator flags the ones a human must reconcile.</summary>
    public sealed class ResendJudgement
    {
        public ResendDecision Decision { get; }
        public bool RequiresOperator { get; }
        public string Reason { get; }

        public ResendJudgement(ResendDecision decision, bool requiresOperator, string reason)
        {
            Decision = decision;
            RequiresOperator = requiresOperator;
            Reason = reason;
        }
    }

    /// <summary>
    /// Pure decision functions for the native submission lifecycle — no I/O, no
    /// clock, no vendor DLL, so every safety rule below is directly unit-tested
    /// in CI (the same discipline as <c>Reconciliation</c>).
    ///
    /// The required rule set, encoded here:
    ///   * before native submission -> durable SEND_INITIATED;
    ///   * exactly one bounded native submission;
    ///   * successful response -> reconcile immediately;
    ///   * timeout / lost response / crash / restart -> UNCERTAIN;
    ///   * never automatically resend an uncertain round;
    ///   * operator verification required after uncertainty, unless a durable
    ///     native causal token is later proven.
    /// </summary>
    public static class NativeSubmissionDecider
    {
        /// <summary>Durable dedup on Verdura's own externalOrderId. True means a
        /// record already exists and no submission must be made.</summary>
        public static bool IsDuplicate(bool recordAlreadyExists)
        {
            return recordAlreadyExists;
        }

        /// <summary>Maps the single bounded write's outcome to the durable state
        /// to persist. There is no branch that maps to a second submission.</summary>
        public static NativeSubmissionState ClassifyWrite(TableRoundWriteOutcome outcome)
        {
            switch (outcome)
            {
                case TableRoundWriteOutcome.Submitted:
                    return NativeSubmissionState.Submitted;
                case TableRoundWriteOutcome.Rejected:
                    return NativeSubmissionState.Rejected;
                case TableRoundWriteOutcome.Ambiguous:
                    return NativeSubmissionState.Uncertain;
                case TableRoundWriteOutcome.TransportDisabled:
                    return NativeSubmissionState.TransportDisabled;
                default:
                    // An unmapped outcome is treated as unknown, never as
                    // success — fail safe.
                    return NativeSubmissionState.Uncertain;
            }
        }

        /// <summary>A timeout while still in flight collapses to Uncertain; a
        /// state that already resolved is left unchanged.</summary>
        public static NativeSubmissionState OnTimeout(NativeSubmissionState current)
        {
            if (current == NativeSubmissionState.SendInitiated || current == NativeSubmissionState.Submitted)
            {
                return NativeSubmissionState.Uncertain;
            }
            return current;
        }

        /// <summary>The load-bearing safety rule: an uncertain or still-in-flight
        /// round is NEVER automatically resent. Always false — there is no state
        /// for which this returns true, by design.</summary>
        public static bool ShouldAutoResend(NativeSubmissionState state)
        {
            return false;
        }

        /// <summary>
        /// What to do with a round found in a given state after an interruption
        /// (crash, restart, timeout, or a dropped response). The decision is
        /// always DoNotResend; only the operator-verification flag and reason
        /// vary. A durable native causal token, once proven, is what would let
        /// a future version reconcile automatically instead of asking a human —
        /// until then, uncertainty is the human's call.
        /// </summary>
        public static ResendJudgement JudgeAfterInterruption(NativeSubmissionState state)
        {
            switch (state)
            {
                case NativeSubmissionState.SendInitiated:
                    return new ResendJudgement(ResendDecision.DoNotResend, true,
                        "A submission was initiated but never confirmed. It may or may not have reached IdealPOS. " +
                        "Do not resend automatically: verify on the native table before any re-key.");
                case NativeSubmissionState.Submitted:
                    return new ResendJudgement(ResendDecision.DoNotResend, true,
                        "The round was ACKed but not yet reconciled. ACK precedes durable DB write natively, so " +
                        "confirm the lines on the native table before treating it as done; never resend blind.");
                case NativeSubmissionState.Uncertain:
                    return new ResendJudgement(ResendDecision.DoNotResend, true,
                        "Outcome unknown. Operator must verify on the native IdealPOS table/bill; do not auto-resend " +
                        "— a resend could double the round because IdealPOS has no durable dedup token.");
                case NativeSubmissionState.Reconciled:
                    return new ResendJudgement(ResendDecision.DoNotResend, false,
                        "Already reconciled — the round is on the table. Nothing to do.");
                case NativeSubmissionState.Rejected:
                    return new ResendJudgement(ResendDecision.DoNotResend, false,
                        "Definitely not appended. A new attempt is a new logical order under a new externalOrderId — " +
                        "an operator/product decision, not an automatic resend.");
                case NativeSubmissionState.Duplicate:
                    return new ResendJudgement(ResendDecision.DoNotResend, false,
                        "A durable record already existed for this externalOrderId; no submission was made.");
                case NativeSubmissionState.TransportDisabled:
                    return new ResendJudgement(ResendDecision.DoNotResend, false,
                        "Native transport disabled; nothing was ever sent.");
                default:
                    return new ResendJudgement(ResendDecision.DoNotResend, true,
                        "Unknown state — fail safe: no automatic resend, operator verification required.");
            }
        }
    }
}

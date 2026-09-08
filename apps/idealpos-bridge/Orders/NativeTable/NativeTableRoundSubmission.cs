using System;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    public enum NativeSubmissionOutcomeKind
    {
        /// <summary>A durable record already existed for this externalOrderId;
        /// no submission was attempted.</summary>
        Duplicate,

        /// <summary>The native transport is disabled/unproven. Fail closed: no
        /// submission was attempted and there is NO fallback to any other
        /// writer (never WebOrder). Surfaced to the caller as a controlled
        /// error.</summary>
        ControlledRejectionTransportDisabled,

        /// <summary>Exactly one bounded native submission was made and ACKed.
        /// Still requires reconciliation.</summary>
        Submitted,

        /// <summary>The native side gave a definite negative.</summary>
        Rejected,

        /// <summary>Outcome unknown (timeout / lost response).</summary>
        Uncertain,
    }

    public sealed class NativeSubmissionOutcome
    {
        public NativeSubmissionOutcomeKind Kind { get; }
        public NativeSubmissionState State { get; }
        public string Message { get; }
        public string NativeAckChecksum { get; }

        private NativeSubmissionOutcome(NativeSubmissionOutcomeKind kind, NativeSubmissionState state, string message, string nativeAckChecksum)
        {
            Kind = kind;
            State = state;
            Message = message;
            NativeAckChecksum = nativeAckChecksum;
        }

        public static NativeSubmissionOutcome Duplicate() =>
            new NativeSubmissionOutcome(NativeSubmissionOutcomeKind.Duplicate, NativeSubmissionState.Duplicate,
                "A durable record already exists for this externalOrderId; no native submission was attempted.", null);

        public static NativeSubmissionOutcome ControlledRejection(string message) =>
            new NativeSubmissionOutcome(NativeSubmissionOutcomeKind.ControlledRejectionTransportDisabled, NativeSubmissionState.TransportDisabled, message, null);

        public static NativeSubmissionOutcome Submitted(string nativeAckChecksum) =>
            new NativeSubmissionOutcome(NativeSubmissionOutcomeKind.Submitted, NativeSubmissionState.Submitted, null, nativeAckChecksum);

        public static NativeSubmissionOutcome Rejected(string message) =>
            new NativeSubmissionOutcome(NativeSubmissionOutcomeKind.Rejected, NativeSubmissionState.Rejected, message, null);

        public static NativeSubmissionOutcome Uncertain(string message) =>
            new NativeSubmissionOutcome(NativeSubmissionOutcomeKind.Uncertain, NativeSubmissionState.Uncertain, message, null);
    }

    /// <summary>
    /// The Order Tablet write orchestration — vendor-free, so it is exercised
    /// directly in CI. It is the ONLY thing OrderService calls to place an
    /// order, and it can reach only an <see cref="ITableRoundWriter"/>. There
    /// is deliberately no code path from here to WebOrder / Ecommerce /
    /// LocalDataHelper.InsertOrders: the Order Tablet cannot fall back to the
    /// rejected architecture even if the native transport is disabled.
    ///
    /// Contract, in order:
    ///   1. durable externalOrderId dedup FIRST — a duplicate attempts nothing;
    ///   2. fail closed — a disabled transport attempts nothing and returns a
    ///      controlled rejection, never a fallback and never a fake success;
    ///   3. otherwise exactly one bounded submission, classified honestly.
    /// </summary>
    public static class NativeTableRoundSubmission
    {
        /// <summary>The exact controlled-rejection message shown when the
        /// native transport is not yet enabled for this venue.</summary>
        public const string TransportDisabledMessage =
            "Native IdealPOS table submission is not enabled on this venue.";

        public static NativeSubmissionOutcome Execute(bool recordAlreadyExists, ITableRoundWriter writer, TableRound round)
        {
            if (writer == null)
            {
                throw new ArgumentNullException(nameof(writer));
            }
            if (round == null)
            {
                throw new ArgumentNullException(nameof(round));
            }

            // 1. Durable dedup on Verdura's own key. Never submit twice for the
            //    same logical order.
            if (NativeSubmissionDecider.IsDuplicate(recordAlreadyExists))
            {
                return NativeSubmissionOutcome.Duplicate();
            }

            // 2. Fail closed. No submission attempt, no fallback to any other
            //    writer, no silent success.
            if (!writer.IsTransportEnabled)
            {
                return NativeSubmissionOutcome.ControlledRejection(TransportDisabledMessage);
            }

            // 3. Exactly one bounded submission.
            TableRoundWriteResult result = writer.SubmitTableRound(round);
            NativeSubmissionState state = NativeSubmissionDecider.ClassifyWrite(result.Outcome);
            switch (state)
            {
                case NativeSubmissionState.Submitted:
                    return NativeSubmissionOutcome.Submitted(result.NativeAckChecksum);
                case NativeSubmissionState.Rejected:
                    return NativeSubmissionOutcome.Rejected(result.Detail);
                case NativeSubmissionState.TransportDisabled:
                    return NativeSubmissionOutcome.ControlledRejection(TransportDisabledMessage);
                default:
                    return NativeSubmissionOutcome.Uncertain(result.Detail);
            }
        }
    }
}

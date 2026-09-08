using System;
using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    /// <summary>
    /// What one bounded native submission attempt returned. Deliberately small
    /// and transport-agnostic — the durable state machine
    /// (<see cref="NativeSubmissionDecider"/>) turns this into a persisted
    /// state, so this type never decides policy, only reports what happened.
    /// </summary>
    public enum TableRoundWriteOutcome
    {
        /// <summary>The native transport is not enabled/proven, so nothing was
        /// sent. This is the shipping default until live ingress A/B/C is
        /// proven — see docs/integrations. It is NOT a failure and NOT an
        /// uncertain send: no packet ever left the bridge.</summary>
        TransportDisabled,

        /// <summary>Exactly one bounded submission was made and the native side
        /// acknowledged it. Still requires reconciliation before it is treated
        /// as durably executed — an ACK precedes durable DB mutation on the
        /// native path (STATIC-PROVEN), so ACK alone is not proof.</summary>
        Submitted,

        /// <summary>The native side gave a definite negative response. Safe to
        /// report: nothing was appended.</summary>
        Rejected,

        /// <summary>The outcome is unknown — timeout, lost response, or a crash
        /// after the request may already have been received. Never treated as
        /// either success or failure.</summary>
        Ambiguous,
    }

    public sealed class TableRoundWriteResult
    {
        public TableRoundWriteOutcome Outcome { get; }
        public string Detail { get; }

        /// <summary>The native ACK checksum echoed back, when the transport
        /// provides one. null on every non-Submitted outcome.</summary>
        public string NativeAckChecksum { get; }

        private TableRoundWriteResult(TableRoundWriteOutcome outcome, string detail, string nativeAckChecksum)
        {
            Outcome = outcome;
            Detail = detail;
            NativeAckChecksum = nativeAckChecksum;
        }

        public static TableRoundWriteResult TransportDisabled(string detail) =>
            new TableRoundWriteResult(TableRoundWriteOutcome.TransportDisabled, detail, null);

        public static TableRoundWriteResult Submitted(string nativeAckChecksum, string detail = null) =>
            new TableRoundWriteResult(TableRoundWriteOutcome.Submitted, detail, nativeAckChecksum);

        public static TableRoundWriteResult Rejected(string detail) =>
            new TableRoundWriteResult(TableRoundWriteOutcome.Rejected, detail, null);

        public static TableRoundWriteResult Ambiguous(string detail) =>
            new TableRoundWriteResult(TableRoundWriteOutcome.Ambiguous, detail, null);
    }

    /// <summary>
    /// The single native-table write abstraction the Order Tablet path submits
    /// through — the requested SubmitTableRound(tableCode, pos, clerk, guests,
    /// items, seats, idempotencyContext) contract, with each item carrying its
    /// own seat (see <see cref="TableRoundLine.Seat"/>) rather than a parallel
    /// seats array. This replaces the WebOrder/Ecommerce writer on the Order
    /// Tablet path: implementations MUST NOT create a WebOrder, use the
    /// Ecommerce plugin GUID, or produce a WB* sale.
    ///
    /// An implementation is wired to real protocol traffic ONLY once the live
    /// ingress (A: POSServer:11000 IHORDER, B: IPS WPOrder socket, C: IH-DATA
    /// relay) is sufficiently proven. Until then the bridge ships the
    /// <see cref="DisabledTableRoundWriter"/> and does not fake readiness.
    /// </summary>
    public interface ITableRoundWriter
    {
        bool IsTransportEnabled { get; }
        string TransportName { get; }
        TableRoundWriteResult SubmitTableRound(TableRound round);
    }

    /// <summary>
    /// Builds a <see cref="TableRound"/> from primitives — the requested
    /// SubmitTableRound signature shape, kept as a factory so callers do not
    /// hand-roll the object.
    /// </summary>
    public static class TableRoundFactory
    {
        public static TableRound Create(
            string tableCode,
            int pos,
            int clerkId,
            int guests,
            int location,
            IReadOnlyList<TableRoundLine> items,
            TableRoundIdempotencyContext idempotency)
        {
            return new TableRound(tableCode, pos, clerkId, guests, location, items, idempotency);
        }
    }

    /// <summary>
    /// The shipping default. The native transport is disabled because the live
    /// ingress is not yet proven for this installation (Front powered off; no
    /// capture). It performs NO I/O whatsoever: no socket, no vendor DLL call,
    /// and above all no WebOrder. Every submission returns TransportDisabled,
    /// which the durable state machine records without ever marking an order
    /// sent, failed, or uncertain — nothing left the bridge to be uncertain
    /// about.
    /// </summary>
    public sealed class DisabledTableRoundWriter : ITableRoundWriter
    {
        public bool IsTransportEnabled { get { return false; } }

        public string TransportName { get { return "disabled"; } }

        public TableRoundWriteResult SubmitTableRound(TableRound round)
        {
            if (round == null)
            {
                throw new ArgumentNullException(nameof(round));
            }
            return TableRoundWriteResult.TransportDisabled(
                "Native table-write transport is not enabled. The live handheld ingress " +
                "(A: POSServer:11000 IHORDER, B: IPS WPOrder socket, C: IH-DATA relay) is not yet " +
                "proven for this installation, so no round was sent to IdealPOS. This is intentional " +
                "and must not be reported as success. See docs/integrations for the capture required " +
                "to prove the live ingress.");
        }
    }
}

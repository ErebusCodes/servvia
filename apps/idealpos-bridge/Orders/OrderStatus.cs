namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// Exactly the state list requested for the bridge's public contract.
    /// Each value's trigger condition is documented here so it's clear
    /// which are directly observed vs. inferred/heuristic — see
    /// OrderLifecycleWatcher for where each transition actually happens.
    /// </summary>
    public enum OrderStatus
    {
        /// <summary>POST /api/orders accepted the HTTP request; validation
        /// not yet run.</summary>
        Received,

        /// <summary>Table exists, all product codes exist, quantities valid,
        /// not a duplicate externalOrderId.</summary>
        Validated,

        /// <summary>LocalDataHelper.InsertOrders() returned successfully —
        /// a row now exists in dbo.WebPendingOrder.</summary>
        SubmittedToIdealpos,

        /// <summary>Row confirmed present in WebPendingOrder with
        /// Processed=0 — native IPS.exe has not consumed it yet.</summary>
        PendingIdealposProcessing,

        /// <summary>WebPendingOrder.Processed flipped to 1. Does NOT by
        /// itself prove a table was assigned — see AssignedToTable. It does
        /// not even prove the order is reconcilable: treat it as "native
        /// Idealpos consumed the message", nothing more.</summary>
        Processed,

        /// <summary>
        /// The order's own pending sale has been located in
        /// IPSTransaction.dbo.PendingSales by its native code
        /// ("WB" + OrderReference), and its immutable ID captured.
        ///
        /// This is a strictly stronger fact than Processed — the sale
        /// demonstrably exists and the bridge knows which row it is — and a
        /// strictly weaker one than AssignedToTable. The order is NOT on a
        /// table here, and on the installed build it cannot be put on one:
        /// table sales live in a different database entirely
        /// (POSServer.dbo.PendingSales) and no supported native path
        /// converts a WB* sale into one (DL-112 §A3, DL-111 Q7/Q8).
        ///
        /// Non-terminal: the watcher keeps observing, because the anchor is
        /// what a future supported conversion would be followed FROM.
        /// </summary>
        AnchoredInIdealpos,

        /// <summary>
        /// A POSServer.dbo.PendingSales TABLE sale has been resolved for this
        /// order and its Code equals the table Verdura asked for.
        ///
        /// Corrected 2026-09-01 (DL-112 §A4b). This state previously meant
        /// only "some IPSTransaction.dbo.PendingSales row was found", and
        /// TableMatchesRequest was decided by comparing that row's Code to
        /// the requested table — but for a web order that Code is
        /// "WB" + OrderReference, never a table, and table sales are not in
        /// that database at all. The old rule therefore compared an order
        /// identifier against a table identifier, across two disjoint
        /// stores. Reaching this state now requires a genuine cross-store
        /// resolution; see Reconciliation.ConfirmsRequestedTable.
        /// </summary>
        AssignedToTable,

        /// <summary>Row disappeared from WebPendingOrder without ever
        /// reaching Processed=1 — matches the confirmed corrupted-record
        /// cleanup path in LocalDataHelper.GetPendingOrders() (deserialization
        /// failure), not a business-logic rejection signal (none was found
        /// in the local pipeline).</summary>
        Rejected,

        /// <summary>InsertOrders() itself threw a confirmed exception —
        /// nothing was submitted. This is the ONLY trigger for Failed as of
        /// the 2026-08-19 preflight review; a stale-timeout elapsing no
        /// longer transitions here (see Uncertain) because a timeout proves
        /// only that the watcher stopped waiting, never that Idealpos did
        /// not or will not process the order.</summary>
        Failed,

        /// <summary>The watcher's timeout (Idealpos:OrderStaleTimeoutMinutes)
        /// elapsed while this order was still resolving, at ANY of the
        /// three non-terminal in-flight states (SubmittedToIdealpos /
        /// PendingIdealposProcessing / Processed). This is deliberately
        /// distinct from Failed: at every one of those three states native
        /// execution may already have happened, or may still happen later
        /// with no further observation (this bridge only watches for
        /// OrderStaleTimeoutMinutes, not forever) — collapsing that into
        /// "failed" would be a false claim of confirmed non-execution.
        /// Reaching Uncertain instead of Failed at the Processed stage
        /// specifically means WebPendingOrder.Processed=1 WAS confirmed —
        /// native Idealpos definitely consumed the order — but no
        /// PendingSales correlation was found in time; that is strong
        /// reason to check the native Idealpos UI/table directly rather
        /// than treat the order as failed. Found and fixed during the
        /// 2026-08-19 preflight independent review — see OrderLifecycleWatcher.
        /// Terminal: the watcher does not re-observe an Uncertain order.
        /// Resolve by checking Idealpos directly; do not resubmit under a
        /// new externalOrderId without first confirming no duplicate
        /// exists.</summary>
        Uncertain,

        /// <summary>HEURISTIC: the PendingSales row this order was tracked
        /// under disappeared after previously being observed with a Code —
        /// inferred from the schema's own description of PendingSales as
        /// holding *open* orders, not directly proven by decompiled code
        /// (that logic runs inside native IPS.exe). See README "Order
        /// lifecycle" for the honest caveat.</summary>
        Paid,

        /// <summary>Terminal state, fired immediately after Paid in this
        /// implementation (the bridge cannot currently distinguish the two
        /// instants from outside Idealpos) — see README.</summary>
        Closed,
    }

    public static class OrderStatusExtensions
    {
        /// <summary>snake_case wire format, matching the contract in the
        /// original request exactly.</summary>
        public static string ToWireString(this OrderStatus status)
        {
            switch (status)
            {
                case OrderStatus.Received: return "received";
                case OrderStatus.Validated: return "validated";
                case OrderStatus.SubmittedToIdealpos: return "submitted_to_idealpos";
                case OrderStatus.PendingIdealposProcessing: return "pending_idealpos_processing";
                case OrderStatus.Processed: return "processed";
                case OrderStatus.AnchoredInIdealpos: return "anchored_in_idealpos";
                case OrderStatus.AssignedToTable: return "assigned_to_table";
                case OrderStatus.Rejected: return "rejected";
                case OrderStatus.Failed: return "failed";
                case OrderStatus.Uncertain: return "uncertain";
                case OrderStatus.Paid: return "paid";
                case OrderStatus.Closed: return "closed";
                default: return status.ToString();
            }
        }

        public static bool IsTerminal(this OrderStatus status)
        {
            // Keep this in sync with OrderStateStore.FindActive()'s SQL
            // literal terminal-status list — that query filters at the SQL
            // level (for real query performance) rather than calling this
            // method, so the two lists are independently maintained and
            // must be changed together. Found as a latent maintainability
            // risk during the 2026-08-19 preflight review (not itself a bug
            // today, since both already agreed before Uncertain was added).
            return status == OrderStatus.Closed || status == OrderStatus.Rejected
                || status == OrderStatus.Failed || status == OrderStatus.Uncertain;
        }
    }
}

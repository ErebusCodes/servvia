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
        /// itself prove a table was assigned — see AssignedToTable.</summary>
        Processed,

        /// <summary>A dbo.PendingSales row was found referencing this order
        /// (via Reference, or via the unfiltered-recent fallback) with a
        /// non-empty Code. OrderRecord.TableMatchesRequest tells you
        /// whether that Code equals the table Verdura actually asked for —
        /// check it; per Section K.2 this is not guaranteed.</summary>
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

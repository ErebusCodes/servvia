using System;
using System.Collections.Generic;
using VerduraIdealposBridge.Idealpos;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>
    /// Cross-store reconciliation decisions, as pure functions over rows the
    /// caller has already read. No SQL, no vendor DLL, no clock, no I/O — so
    /// every rule below is directly testable and runs in CI (see
    /// apps/idealpos-bridge-ci).
    ///
    /// The model this implements, and why the previous one was wrong
    /// (DL-112 §4, §A4, §A4b):
    ///
    ///   * The bridge used to correlate on dbo.PendingSales.Reference. For a
    ///     Webit-ingested web order that column is NULL — measured on the one
    ///     such order that has ever existed here, ORD-600002 — so correlation
    ///     never happened at all and the order aged out to Uncertain.
    ///
    ///   * It then compared PendingSales.Code against the requested table to
    ///     decide TableMatchesRequest. For a web order that Code is
    ///     "WB" + OrderReference (native builds it that way; ORD-600002 is
    ///     "WBORD-600002"), never a table number. So the one code path that
    ///     could ever have set AssignedToTable was comparing an order
    ///     identifier against a table identifier.
    ///
    ///   * Worse, those are two different databases. Web orders live in
    ///     IPSTransaction.dbo.PendingSales; native TABLE sales live in
    ///     POSServer.dbo.PendingSales, and the ID spaces are disjoint
    ///     (4522 vs 99411). No single-store model can express "this web order
    ///     is now on table 5", because those two facts are recorded in
    ///     different databases.
    ///
    /// So reconciliation is split into two stages that must not be conflated:
    ///
    ///   1. ANCHOR (implemented, deterministic). Identify the order's own
    ///      IPSTransaction pending sale by its native code, and capture the
    ///      immutable ID. This proves the order landed in Idealpos. It proves
    ///      NOTHING about a table, and this class will not let a caller
    ///      pretend otherwise.
    ///
    ///   2. TABLE LINK (resolution implemented, not yet reachable in
    ///      production). Identify the POSServer table-sale row. Requires a
    ///      supported native conversion that does not currently exist for
    ///      WB* sales — DL-112 §A3, DL-111 Q7/Q8. Until that is answered by
    ///      the vendor, SelectTableSale has no rows to be given.
    /// </summary>
    public static class Reconciliation
    {
        /// <summary>The prefix native Idealpos puts in front of a web order's
        /// OrderReference when it materialises the sale (DL-108 §3; observed
        /// as "WBORD-600002" for OrderReference "ORD-600002").</summary>
        public const string NativeWebCodePrefix = "WB";

        /// <summary>
        /// The deterministic anchor key: what dbo.PendingSales.Code will read
        /// for this order once native Idealpos has consumed it.
        ///
        /// Built from the WEB REFERENCE actually submitted, never from
        /// externalOrderId directly. Under the live NoHint strategy the two
        /// are equal, but ReferencePrefix deliberately rewrites
        /// OrderReference and returns the rewritten value — anchoring on
        /// externalOrderId would silently stop matching the moment the
        /// strategy changed.
        /// </summary>
        public static string BuildNativeWebCode(string webReference)
        {
            if (string.IsNullOrWhiteSpace(webReference)) return null;
            return NativeWebCodePrefix + webReference.Trim();
        }

        /// <summary>
        /// Whether this IPSTransaction row is the order's anchor.
        ///
        /// Exact, case-insensitive, whitespace-trimmed comparison. Deliberately
        /// NOT a prefix or LIKE match: "WBORD-600002" and the manually typed
        /// "WBORD" (PendingSales 4523, entered on POS 2 by clerk 108) both
        /// exist in this database, and a prefix match on "WBORD" would claim
        /// an unrelated staff-entered sale as a Verdura order.
        /// </summary>
        public static bool IsAnchorMatch(PendingSaleRow row, string expectedNativeCode)
        {
            if (row == null || expectedNativeCode == null) return false;
            return string.Equals(
                (row.Code ?? string.Empty).Trim(),
                expectedNativeCode.Trim(),
                StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Picks the POSServer table-sale row for a requested table, or null.
        ///
        /// Matched by (Code, Pos), never by ID — and that is not a stylistic
        /// preference, it is forced by how POSServer maintains this store.
        /// Its own TABLEDATA handler services a table update by deleting the
        /// existing row and its lines and inserting a fresh one, and its
        /// SYSDATA handler calls ClearAll() over the whole collection before
        /// reloading it. A POSServer row's ID is therefore regenerated by
        /// ordinary traffic, and any model that captures one and re-resolves
        /// by it later will silently start reading a different row — or none.
        /// (POSServer.Communication: UpdateDataRequest, SystemDataRequest.)
        ///
        /// (Code, Map, Pos) is POSServer's own natural key — both its
        /// NEWLINES and TABLEDATA handlers query on exactly that, pinned to
        /// Pos == 1. Map is not filtered here because the bridge does not
        /// currently carry the requested table's map; the ambiguity refusal
        /// below covers that gap honestly rather than by guessing.
        ///
        /// Returns null rather than a best guess whenever the answer is not
        /// unambiguous — including when two rows match, which would mean the
        /// table identity is genuinely ambiguous and picking either could
        /// attach a Verdura order to the wrong party's bill.
        /// </summary>
        public static PosServerPendingSaleRow SelectTableSale(
            IEnumerable<PosServerPendingSaleRow> candidates, string requestedTable, out string reason)
        {
            reason = null;
            if (string.IsNullOrWhiteSpace(requestedTable))
            {
                reason = "no requested table on the order record";
                return null;
            }
            if (candidates == null)
            {
                reason = "no POSServer candidates supplied (cross-store reconciliation disabled or unreachable)";
                return null;
            }

            string wanted = requestedTable.Trim();
            var matches = new List<PosServerPendingSaleRow>();
            foreach (PosServerPendingSaleRow row in candidates)
            {
                if (row == null) continue;
                // Pos == 1 is POSServer's own invariant for these rows: both
                // its NEWLINES and TABLEDATA handlers write and query them
                // pinned to Pos 1. Anything else is not the row those
                // handlers would maintain for this table.
                if (row.Pos != 1) continue;
                if (string.Equals((row.Code ?? string.Empty).Trim(), wanted, StringComparison.OrdinalIgnoreCase))
                {
                    matches.Add(row);
                }
            }

            if (matches.Count == 0)
            {
                reason = "no POSServer pending sale has Code '" + wanted + "' at Pos 1";
                return null;
            }
            if (matches.Count > 1)
            {
                reason = "ambiguous: " + matches.Count + " POSServer pending sales have Code '" + wanted +
                         "'. Refusing to guess which one is this order's table.";
                return null;
            }
            return matches[0];
        }

        /// <summary>
        /// The single guard this whole class exists to enforce: an
        /// IPSTransaction anchor is not a table assignment.
        ///
        /// Returns true only when a POSServer table sale has actually been
        /// resolved AND its code equals the table Verdura asked for. Passing
        /// the anchor's own "WB..." code here can never return true, which is
        /// exactly the bug that shipped before.
        /// </summary>
        public static bool ConfirmsRequestedTable(PosServerPendingSaleRow tableSale, string requestedTable)
        {
            if (tableSale == null || string.IsNullOrWhiteSpace(requestedTable)) return false;
            string code = (tableSale.Code ?? string.Empty).Trim();
            if (code.Length == 0) return false;
            if (code.StartsWith(NativeWebCodePrefix, StringComparison.OrdinalIgnoreCase))
            {
                // A POSServer row still carrying a WB* code is a web-order
                // row that reached POSServer without being converted to a
                // table (POSServer 99410, Code 'WBORD', Map 0 is exactly
                // this shape). It is not a table sale.
                return false;
            }
            return string.Equals(code, requestedTable.Trim(), StringComparison.OrdinalIgnoreCase);
        }
    }
}

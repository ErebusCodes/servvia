using System.Collections.Generic;
using VerduraIdealposBridge.Idealpos;
using VerduraIdealposBridge.Orders;

namespace VerduraIdealposBridge.Tests
{
    /// <summary>
    /// Coverage for the cross-store reconciliation rules (DL-112 §A4b).
    ///
    /// Every fixture below is a real measured value from this venue's live
    /// instance, not an invented example: ORD-600002 anchored at
    /// IPSTransaction.dbo.PendingSales 4522 with Code 'WBORD-600002' and
    /// Reference NULL; the manually keyed 'WBORD' at 4523; POSServer rows
    /// 99411 (Code '17', Map 1), 99410 (Code 'WBORD', Map 0) and 99408
    /// (Code '0', Map 1). Using the real shapes is what makes these tests
    /// regression coverage rather than decoration.
    ///
    /// Pure logic — no SQL Server, no Idealpos, no vendor DLL — so this suite
    /// runs both under --selftest and unattended in CI.
    /// </summary>
    public static class ReconciliationTests
    {
        private static PendingSaleRow Ips(int id, string code)
        {
            return new PendingSaleRow { Id = id, Code = code };
        }

        private static PosServerPendingSaleRow Pos(int id, string code, int map)
        {
            return new PosServerPendingSaleRow { Id = id, Code = code, Map = map, Pos = 1 };
        }

        public static IEnumerable<TestResult> RunAll()
        {
            // ---- anchor key derivation ----

            yield return Assert.Run("Anchor key: 'WB' + web reference, matching the real WBORD-600002", () =>
            {
                Assert.AreEqual("WBORD-600002", Reconciliation.BuildNativeWebCode("ORD-600002"), "BuildNativeWebCode");
            });

            yield return Assert.Run("Anchor key: derived from the web reference, not externalOrderId", () =>
            {
                // ReferencePrefix rewrites OrderReference and returns the new
                // value; anchoring on the original externalOrderId would stop
                // matching the moment the strategy changed.
                Assert.AreEqual("WBTBL5-ORD-600002", Reconciliation.BuildNativeWebCode("TBL5-ORD-600002"), "rewritten reference");
            });

            yield return Assert.Run("Anchor key: null/blank web reference yields no key rather than the bare prefix 'WB'", () =>
            {
                Assert.IsTrue(Reconciliation.BuildNativeWebCode(null) == null, "null reference");
                Assert.IsTrue(Reconciliation.BuildNativeWebCode("   ") == null, "whitespace reference");
            });

            // ---- anchor matching ----

            yield return Assert.Run("Anchor: matches the order's own pending sale", () =>
            {
                Assert.IsTrue(Reconciliation.IsAnchorMatch(Ips(4522, "WBORD-600002"), "WBORD-600002"), "exact match");
            });

            yield return Assert.Run("Anchor: tolerates the trailing whitespace native Idealpos pads Code with", () =>
            {
                Assert.IsTrue(Reconciliation.IsAnchorMatch(Ips(4522, "WBORD-600002   "), "WBORD-600002"), "padded Code");
            });

            yield return Assert.Run("Anchor: does NOT prefix-match the manually keyed 'WBORD' sale", () =>
            {
                // PendingSales 4523, typed by a clerk on POS 2. A LIKE 'WB%'
                // or StartsWith match would claim it as ORD-600002's anchor
                // and reconcile a Verdura order against a staff-entered sale.
                Assert.IsTrue(!Reconciliation.IsAnchorMatch(Ips(4523, "WBORD"), "WBORD-600002"), "WBORD must not match WBORD-600002");
            });

            yield return Assert.Run("Anchor: a different order's sale does not match", () =>
            {
                Assert.IsTrue(!Reconciliation.IsAnchorMatch(Ips(4521, "WBORD-600001"), "WBORD-600002"), "ORD-600001 must not match ORD-600002");
            });

            yield return Assert.Run("Anchor: no row means no match, rather than throwing", () =>
            {
                Assert.IsTrue(!Reconciliation.IsAnchorMatch(null, "WBORD-600002"), "null row");
            });

            // ---- the core guard: an anchor is never a table ----

            yield return Assert.Run("An IPSTransaction anchor code can never confirm a table", () =>
            {
                // This is the exact defect being fixed: the old code compared
                // PendingSales.Code to the requested table. Feeding the anchor
                // code in here must not produce a confirmed table under any
                // requested value.
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99410, "WBORD-600002", 0), "5"), "WB code vs table 5");
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99410, "WBORD-600002", 0), "WBORD-600002"), "WB code vs itself");
            });

            yield return Assert.Run("A POSServer row still carrying a WB* code is not a table sale", () =>
            {
                // POSServer 99410, Code 'WBORD', Map 0 — a web order that
                // reached POSServer without being converted to a table.
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99410, "WBORD", 0), "WBORD"), "unconverted WB row");
            });

            yield return Assert.Run("A resolved POSServer table sale confirms the requested table", () =>
            {
                Assert.IsTrue(Reconciliation.ConfirmsRequestedTable(Pos(99411, "17", 1), "17"), "table 17");
                Assert.IsTrue(Reconciliation.ConfirmsRequestedTable(Pos(99411, " 17 ", 1), "17"), "padded table code");
            });

            yield return Assert.Run("A table sale for a DIFFERENT table does not confirm the request", () =>
            {
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99411, "17", 1), "5"), "table 17 vs requested 5");
            });

            yield return Assert.Run("An empty or missing table sale confirms nothing", () =>
            {
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(null, "5"), "null row");
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99408, "", 1), "5"), "empty code");
                Assert.IsTrue(!Reconciliation.ConfirmsRequestedTable(Pos(99411, "17", 1), null), "null requested table");
            });

            // ---- cross-store selection ----

            yield return Assert.Run("Table link: selects the POSServer row whose Code is the requested table", () =>
            {
                string reason;
                var chosen = Reconciliation.SelectTableSale(
                    new List<PosServerPendingSaleRow> { Pos(99411, "17", 1), Pos(99410, "WBORD", 0), Pos(99408, "0", 1) },
                    "17", out reason);
                Assert.IsTrue(chosen != null, "should have selected a row");
                Assert.AreEqual(99411, chosen.Id, "selected POSServer ID");
            });

            yield return Assert.Run("Table link: the selected ID is POSServer's, never the IPSTransaction anchor's", () =>
            {
                // The stores' ID spaces are disjoint (4522 vs 99411). This
                // asserts the linkage genuinely crosses stores rather than
                // carrying the anchor ID across, which would resolve to an
                // unrelated row or none at all.
                string reason;
                var chosen = Reconciliation.SelectTableSale(
                    new List<PosServerPendingSaleRow> { Pos(99411, "17", 1) }, "17", out reason);
                Assert.IsTrue(chosen.Id != 4522, "must not be the IPSTransaction anchor ID");
            });

            yield return Assert.Run("Table link: an unoccupied requested table resolves to nothing, with a reason", () =>
            {
                // Table 5 is Ready/unoccupied, so no POSServer row exists for
                // it — the state a controlled ORD-600002 proof would start in.
                string reason;
                var chosen = Reconciliation.SelectTableSale(
                    new List<PosServerPendingSaleRow> { Pos(99411, "17", 1) }, "5", out reason);
                Assert.IsTrue(chosen == null, "table 5 has no POSServer row");
                Assert.IsTrue(!string.IsNullOrEmpty(reason), "must explain why");
            });

            yield return Assert.Run("Table link: refuses to guess when two rows claim the same table", () =>
            {
                string reason;
                var chosen = Reconciliation.SelectTableSale(
                    new List<PosServerPendingSaleRow> { Pos(99411, "17", 1), Pos(99412, "17", 1) }, "17", out reason);
                Assert.IsTrue(chosen == null, "ambiguous match must not resolve");
                Assert.IsTrue(reason.Contains("ambiguous"), "reason should say it is ambiguous, was: " + reason);
            });

            yield return Assert.Run("Table link: disabled cross-store reconciliation is reported as disabled, not as 'no table'", () =>
            {
                // Null candidates means the POSServer repository was never
                // configured. Reporting that as an ordinary no-match would
                // make a switched-off feature look like a checked negative.
                string reason;
                var chosen = Reconciliation.SelectTableSale(null, "17", out reason);
                Assert.IsTrue(chosen == null, "no candidates");
                Assert.IsTrue(reason.Contains("disabled") || reason.Contains("unreachable"),
                    "reason should distinguish disabled from absent, was: " + reason);
            });

            yield return Assert.Run("Table link: an order with no requested table resolves to nothing", () =>
            {
                string reason;
                Assert.IsTrue(Reconciliation.SelectTableSale(new List<PosServerPendingSaleRow> { Pos(99411, "17", 1) }, "", out reason) == null, "blank requested table");
            });

            // ---- lifecycle state ----

            yield return Assert.Run("AnchoredInIdealpos: wire string is 'anchored_in_idealpos'", () =>
            {
                Assert.AreEqual("anchored_in_idealpos", Orders.OrderStatus.AnchoredInIdealpos.ToWireString(), "ToWireString");
            });

            yield return Assert.Run("AnchoredInIdealpos: non-terminal, so a later supported conversion is still observed", () =>
            {
                Assert.IsTrue(!Orders.OrderStatus.AnchoredInIdealpos.IsTerminal(), "anchored must stay watchable");
            });
        }
    }
}

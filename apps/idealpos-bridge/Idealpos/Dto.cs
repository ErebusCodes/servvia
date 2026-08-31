using System;

namespace VerduraIdealposBridge.Idealpos
{
    /// <summary>
    /// Every field here is either a direct column read from a table this
    /// investigation confirmed (TableMapSetups ��� see IPS.Data.SQL.dll's
    /// embedded DDL), or explicitly marked heuristic in comments. Nothing
    /// invented.
    /// </summary>
    public class TableDto
    {
        /// <summary>TableMapSetups.Caption ��� the human-readable number/name
        /// staff see, and the value Verdura's "table" field should use.
        /// Falls back to "{Code}-{Index}" when Caption is blank (confirmed
        /// live 2026-08-26: some venues never populate Caption/Name for any
        /// real table) ��� see IdealposReadRepository.ResolveTableIdentifier.
        /// Whichever form this venue actually uses, it is always what
        /// Verdura's outgoing "table" request field must match.</summary>
        public string Table { get; set; }

        /// <summary>TableMapSetups.Code ��� confirmed, per the investigation's
        /// Section K, to be the same identifier space PendingSales.Code
        /// (the docket/table key) and Doshii's own GetTableAmountAsync(table)
        /// use.</summary>
        public int Code { get; set; }

        /// <summary>TableMapSetups.Type / Index ��� composite key components
        /// alongside Code in the schema; exposed for completeness, not
        /// required by Verdura for normal use.</summary>
        public int Type { get; set; }
        public int Index { get; set; }

        /// <summary>TableMaps.Code this table belongs to (e.g. "Restaurant"
        /// vs "Bar" floor plan) ��� TableMapSetups.Code column reused across
        /// TableMaps as a foreign-key-like relationship per the schema.</summary>
        public int TableMap { get; set; }

        public int Seats { get; set; }

        /// <summary>Raw TableMapSetups.Status value. Exact enum semantics
        /// were never decoded from static analysis (no non-zero sample was
        /// available) ��� exposed as-is rather than guessing what each value
        /// means.</summary>
        public int Status { get; set; }

        public decimal Amount { get; set; }
        public int GuestsSaved { get; set; }

        /// <summary>HEURISTIC, not a confirmed Idealpos concept: Amount &gt; 0
        /// or Status != 0. Idealpos's own precise "is this table open" rule
        /// was never recovered from static analysis (it lives in native
        /// IPS.exe). Treat this as a best-effort hint for Verdura's UI, not
        /// ground truth ��� confirm empirically before relying on it for
        /// business logic.</summary>
        public bool LikelyOccupied { get; set; }
    }

    /// <summary>
    /// Sourced from direct read-only SQL against dbo.StockItems ��� NOT
    /// Idealpos's own LocalDataHelper.GetIpsStockItemsDic() as this project
    /// originally preferred. Switched 2026-08-26 after confirming live
    /// against DUNEDIN that the vendor method returns empty for a real
    /// installation (826 real StockItems, every one with SentOnline=0 and
    /// Availability=0 ��� an online/web-visibility flag this venue has never
    /// used, almost certainly what that method filters on). See
    /// IdealposReadRepository.GetProducts()'s own doc comment for the full
    /// evidence trail.
    /// </summary>
    public class ProductDto
    {
        public string Id { get; set; }
        public string Code { get; set; }
        public string Description { get; set; }

        /// <summary>Always true in this build. dbo.StockItems' Availability
        /// column is confirmed present but is 0 for every real row here (see
        /// class doc comment) with no other Idealpos-confirmed "is this
        /// orderable" signal in this schema ��� deliberately not read rather
        /// than treated as a real availability signal it isn't confirmed to
        /// be.</summary>
        public bool Available { get; set; }

        /// <summary>Always 0. dbo.StockItems has no Price/Price1-shaped
        /// column in this schema (a separate pricing table must back
        /// GetIpsStockItemsDic() internally) ��� confirmed unnecessary for
        /// order-submission correctness: IdealposOrderSubmitter.BuildItems()
        /// leaves StockItem.PricingMode at Inherit specifically so Idealpos
        /// prices each line itself. This field exists only for the
        /// /api/products discovery response.</summary>
        public decimal Price { get; set; }
        public int DepartmentCode { get; set; }
    }

    /// <summary>
    /// A row of POSServer.dbo.PendingSales — the NATIVE TABLE-SALE store,
    /// which is a different database from the IPSTransaction.dbo.PendingSales
    /// that web orders land in (DL-112 §A4b).
    ///
    /// This distinction is the whole reason the type exists rather than
    /// reusing PendingSaleRow. Measured on this venue's live instance:
    /// IPSTransaction.dbo.PendingSales held 45 rows and NOT ONE row for any
    /// table, while occupied Table 17 was POSServer.dbo.PendingSales ID
    /// 99411. The ID spaces are disjoint (4522 vs 99411), so an ID read from
    /// one store is meaningless in the other, and a single row type would
    /// make that mistake easy to write and hard to see.
    /// </summary>
    public class PosServerPendingSaleRow
    {
        /// <summary>POSServer's own identity. NEVER comparable to
        /// IPSTransaction.dbo.PendingSales.ID.</summary>
        public int Id { get; set; }

        /// <summary>For a table sale this is the table code (observed: '17'
        /// for the live table). A row still carrying a 'WB*' code is a web
        /// order that reached POSServer without being converted to a table
        /// (observed: 99410, Code 'WBORD', Map 0).</summary>
        public string Code { get; set; }

        /// <summary>Table map. 0 on the unconverted WB* row, 1 on the real
        /// table rows — part of the match key because Code alone is not
        /// unique across maps.</summary>
        public int Map { get; set; }

        public int Pos { get; set; }
    }
}
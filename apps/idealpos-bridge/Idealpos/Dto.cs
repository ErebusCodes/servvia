using System;

namespace VerduraIdealposBridge.Idealpos
{
    /// <summary>
    /// Every field here is either a direct column read from a table this
    /// investigation confirmed (TableMapSetups ÔÇö see IPS.Data.SQL.dll's
    /// embedded DDL), or explicitly marked heuristic in comments. Nothing
    /// invented.
    /// </summary>
    public class TableDto
    {
        /// <summary>TableMapSetups.Caption ÔÇö the human-readable number/name
        /// staff see, and the value Verdura's "table" field should use.
        /// Falls back to "{Code}-{Index}" when Caption is blank (confirmed
        /// live 2026-08-26: some venues never populate Caption/Name for any
        /// real table) ÔÇö see IdealposReadRepository.ResolveTableIdentifier.
        /// Whichever form this venue actually uses, it is always what
        /// Verdura's outgoing "table" request field must match.</summary>
        public string Table { get; set; }

        /// <summary>TableMapSetups.Code ÔÇö confirmed, per the investigation's
        /// Section K, to be the same identifier space PendingSales.Code
        /// (the docket/table key) and Doshii's own GetTableAmountAsync(table)
        /// use.</summary>
        public int Code { get; set; }

        /// <summary>TableMapSetups.Type / Index ÔÇö composite key components
        /// alongside Code in the schema; exposed for completeness, not
        /// required by Verdura for normal use.</summary>
        public int Type { get; set; }
        public int Index { get; set; }

        /// <summary>TableMaps.Code this table belongs to (e.g. "Restaurant"
        /// vs "Bar" floor plan) ÔÇö TableMapSetups.Code column reused across
        /// TableMaps as a foreign-key-like relationship per the schema.</summary>
        public int TableMap { get; set; }

        public int Seats { get; set; }

        /// <summary>Raw TableMapSetups.Status value. Exact enum semantics
        /// were never decoded from static analysis (no non-zero sample was
        /// available) ÔÇö exposed as-is rather than guessing what each value
        /// means.</summary>
        public int Status { get; set; }

        public decimal Amount { get; set; }
        public int GuestsSaved { get; set; }

        /// <summary>HEURISTIC, not a confirmed Idealpos concept: Amount &gt; 0
        /// or Status != 0. Idealpos's own precise "is this table open" rule
        /// was never recovered from static analysis (it lives in native
        /// IPS.exe). Treat this as a best-effort hint for Verdura's UI, not
        /// ground truth ÔÇö confirm empirically before relying on it for
        /// business logic.</summary>
        public bool LikelyOccupied { get; set; }
    }

    /// <summary>
    /// Sourced from direct read-only SQL against dbo.StockItems ÔÇö NOT
    /// Idealpos's own LocalDataHelper.GetIpsStockItemsDic() as this project
    /// originally preferred. Switched 2026-08-26 after confirming live
    /// against DUNEDIN that the vendor method returns empty for a real
    /// installation (826 real StockItems, every one with SentOnline=0 and
    /// Availability=0 ÔÇö an online/web-visibility flag this venue has never
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
        /// orderable" signal in this schema ÔÇö deliberately not read rather
        /// than treated as a real availability signal it isn't confirmed to
        /// be.</summary>
        public bool Available { get; set; }

        /// <summary>Always 0. dbo.StockItems has no Price/Price1-shaped
        /// column in this schema (a separate pricing table must back
        /// GetIpsStockItemsDic() internally) ÔÇö confirmed unnecessary for
        /// order-submission correctness: IdealposOrderSubmitter.BuildItems()
        /// leaves StockItem.PricingMode at Inherit specifically so Idealpos
        /// prices each line itself. This field exists only for the
        /// /api/products discovery response.</summary>
        public decimal Price { get; set; }
        public int DepartmentCode { get; set; }
    }
}
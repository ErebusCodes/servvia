using System;
using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders
{
    /// <summary>Wire shape of POST /api/orders — matches the contract
    /// exactly: {externalOrderId, table, items:[{productCode,quantity}], notes}.</summary>
    public class OrderRequest
    {
        public string ExternalOrderId { get; set; }
        public string Table { get; set; }
        public List<OrderLineRequest> Items { get; set; }
        public string Notes { get; set; }
    }

    public class OrderLineRequest
    {
        public string ProductCode { get; set; }
        public decimal Quantity { get; set; }
    }

    /// <summary>Persisted in the local SQLite state store — this is the
    /// bridge's own idempotency + lifecycle record, entirely separate from
    /// anything inside Idealpos. ExternalOrderId is the primary key and the
    /// idempotency key: see OrderService.</summary>
    public class OrderRecord
    {
        public string ExternalOrderId { get; set; }
        public string RequestedTable { get; set; }
        public string ItemsJson { get; set; }
        public string Notes { get; set; }
        public DateTime SubmittedAtUtc { get; set; }
        public OrderStatus Status { get; set; }
        public string StrategyUsed { get; set; }
        public string IdealposWebReference { get; set; }
        public string OriginGuid { get; set; }
        public int? WebPendingOrderId { get; set; }

        /// <summary>IPSTransaction.dbo.PendingSales.ID — the immutable
        /// pre-transfer anchor. NOT comparable to PosServerPendingSaleId:
        /// the two stores have disjoint ID spaces (DL-112 §A4b).</summary>
        public int? PendingSalesId { get; set; }

        /// <summary>The anchor row's Code, i.e. "WB" + OrderReference. This
        /// is an ORDER identifier and never a table, which is precisely the
        /// confusion that made the old reconciliation wrong.</summary>
        public string PendingSalesCode { get; set; }

        public DateTime? AnchoredAtUtc { get; set; }

        /// <summary>
        /// POSServer.dbo.PendingSales.ID AS OBSERVED AT THE MOMENT OF
        /// LINKING. Diagnostic only — it is NOT durable and must never be
        /// used to re-resolve the row later: POSServer's TABLEDATA handler
        /// deletes and re-inserts a table's row on every update, and SYSDATA
        /// clears the whole collection, so this value goes stale during
        /// ordinary service.
        /// </summary>
        public int? PosServerPendingSaleId { get; set; }

        /// <summary>The table code. THIS is the durable POSServer handle —
        /// (Code, Map, Pos) is the natural key POSServer's own NEWLINES and
        /// TABLEDATA handlers query on.</summary>
        public string PosServerPendingSaleCode { get; set; }

        /// <summary>True only when a POSServer table sale was resolved AND
        /// its code equals RequestedTable. Never inferred from the anchor.</summary>
        public bool? TableMatchesRequest { get; set; }
        public string LastError { get; set; }
        public DateTime LastObservedAtUtc { get; set; }
        public bool TableOccupiedWarning { get; set; }
    }
}

using System;
using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    /// <summary>
    /// The line kind, mapping to the native PendingSaleLines.Col0
    /// discriminator proven in POSServer.Communication's HandheldOrder
    /// handler: "SI" for a stock item, "H" for a text / instruction line
    /// (POSServer.Communication.decompiled.cs:9188-9205). STATIC-PROVEN.
    /// </summary>
    public enum TableRoundLineType
    {
        StockItem,
        Text,
    }

    /// <summary>
    /// One line of a single ORDER round. Field set is the native transaction
    /// contract read by the append handheld path, per the P0 #1 documentation
    /// (see docs/integrations, protocol §5 and the decompiled HandheldOrder):
    /// StockItem, Quantity, Description, Price/PriceLevel, Seat, line type,
    /// TaxString. Line numbers are NOT carried here — the server assigns them
    /// on append (Line = ++existingCount), which is why the genuine client
    /// emits OrderItem/@Index="" (STATIC-PROVEN). Verdura must not invent one.
    /// </summary>
    public sealed class TableRoundLine
    {
        public string StockItemCode { get; }
        public decimal Quantity { get; }

        /// <summary>Per-seat assignment. null means "no seat" — the server
        /// decides (native SeatNumber default), never coerced to 0 here.</summary>
        public int? Seat { get; }

        /// <summary>Selects StockItems.Price&lt;N&gt; server-side. null leaves
        /// it to the native default rather than fabricating a level.</summary>
        public int? PriceLevel { get; }

        public string Description { get; }
        public TableRoundLineType LineType { get; }

        /// <summary>Native Col5 tax string; null when the server should derive
        /// it. Only meaningful for a stock-item line.</summary>
        public string TaxString { get; }

        public TableRoundLine(
            string stockItemCode,
            decimal quantity,
            int? seat = null,
            int? priceLevel = null,
            string description = null,
            TableRoundLineType lineType = TableRoundLineType.StockItem,
            string taxString = null)
        {
            if (lineType == TableRoundLineType.StockItem && string.IsNullOrWhiteSpace(stockItemCode))
            {
                throw new ArgumentException("A stock-item line requires a stockItemCode.", nameof(stockItemCode));
            }
            if (quantity <= 0m)
            {
                throw new ArgumentException("quantity must be positive.", nameof(quantity));
            }
            StockItemCode = stockItemCode;
            Quantity = quantity;
            Seat = seat;
            PriceLevel = priceLevel;
            Description = description;
            LineType = lineType;
            TaxString = taxString;
        }
    }

    /// <summary>
    /// The durable causal context Verdura keeps for one round. ExternalOrderId
    /// is Verdura's own idempotency key (durable in the bridge SQLite store).
    /// Checksum is the native volatile dedup token (100-slot / 10-minute ring
    /// buffer — HandheldHelper.IsDuplicate, STATIC-PROVEN volatile); it is NOT
    /// a durable native causal token, so it must never be relied on across a
    /// restart or the 10-minute window. DeviceId is the native lock/dedup key.
    /// </summary>
    public sealed class TableRoundIdempotencyContext
    {
        public string ExternalOrderId { get; }
        public string Checksum { get; }
        public string DeviceId { get; }

        public TableRoundIdempotencyContext(string externalOrderId, string checksum = null, string deviceId = null)
        {
            if (string.IsNullOrWhiteSpace(externalOrderId))
            {
                throw new ArgumentException("externalOrderId is required — it is Verdura's durable idempotency key.", nameof(externalOrderId));
            }
            ExternalOrderId = externalOrderId;
            Checksum = checksum;
            DeviceId = deviceId;
        }
    }

    /// <summary>
    /// One APPEND round targeting an existing IdealPOS table / pending sale.
    ///
    /// This type deliberately models a single round only — the new lines to
    /// add — and carries no "replace whole sale" flag. That is the whole
    /// point: the live socket handlers (managed HandheldOrder / native
    /// WPOrder) APPEND (STATIC-PROVEN), so a round is a delta of new lines,
    /// not a full-state resend. Sending full table state into an append path
    /// would double every prior line. The delete-and-rebuild routine
    /// (ProcessHandheldOrder, the IH-DATA relay) is a different contract and
    /// is intentionally not representable here.
    /// </summary>
    public sealed class TableRound
    {
        /// <summary>Native PendingSales.Code — the bare table number/identifier
        /// (protocol §5: &lt;Table&gt; flows to PendingSales.Code).</summary>
        public string TableCode { get; }

        /// <summary>POS/terminal identifier. The handheld path pins Pos == 1
        /// on the PendingSales row (STATIC-PROVEN in HandheldOrder's query).</summary>
        public int Pos { get; }

        public int ClerkId { get; }
        public int Guests { get; }

        /// <summary>Native LocationSold (defaults to 1 server-side when 0).</summary>
        public int Location { get; }

        public IReadOnlyList<TableRoundLine> Lines { get; }
        public TableRoundIdempotencyContext Idempotency { get; }

        public TableRound(
            string tableCode,
            int pos,
            int clerkId,
            int guests,
            int location,
            IReadOnlyList<TableRoundLine> lines,
            TableRoundIdempotencyContext idempotency)
        {
            if (string.IsNullOrWhiteSpace(tableCode))
            {
                throw new ArgumentException("tableCode is required.", nameof(tableCode));
            }
            if (lines == null || lines.Count == 0)
            {
                throw new ArgumentException("A round must carry at least one line — an ORDER with no items is silently discarded by the native path (IP-3933).", nameof(lines));
            }
            if (idempotency == null)
            {
                throw new ArgumentNullException(nameof(idempotency));
            }
            TableCode = tableCode.Trim();
            Pos = pos;
            ClerkId = clerkId;
            Guests = guests;
            Location = location;
            Lines = lines;
            Idempotency = idempotency;
        }
    }

    /// <summary>A round line with the native Line ordinal it would occupy once
    /// appended. Diagnostic/planning only — the server is authoritative for the
    /// real ordinal.</summary>
    public sealed class PlannedLine
    {
        public short Line { get; }
        public TableRoundLine Source { get; }

        public PlannedLine(short line, TableRoundLine source)
        {
            Line = line;
            Source = source;
        }
    }

    /// <summary>
    /// Pure representation of the native append: given how many lines already
    /// exist on the pending sale, the round's lines take ordinals
    /// existingLineCount+1 .. existingLineCount+N and the existing lines are
    /// untouched. Mirrors HandheldOrder (POSServer.Communication.decompiled.cs
    /// :9173-9177): `num6 = collection.Count; ... AddNew(); Line = (short)++num6`.
    /// No delete, no merge, no renumber of prior lines. STATIC-PROVEN.
    /// </summary>
    public static class TableRoundPlan
    {
        public static IReadOnlyList<PlannedLine> PlanAppend(int existingLineCount, TableRound round)
        {
            if (existingLineCount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(existingLineCount));
            }
            if (round == null)
            {
                throw new ArgumentNullException(nameof(round));
            }
            var planned = new List<PlannedLine>(round.Lines.Count);
            int next = existingLineCount;
            foreach (TableRoundLine line in round.Lines)
            {
                next++;
                planned.Add(new PlannedLine((short)next, line));
            }
            return planned;
        }
    }
}

using System;
using System.Collections.Generic;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    /// <summary>
    /// Maps one validated Order Tablet request into a single native append
    /// round. Vendor-free and pure, so the whole UI→TableRound contract is
    /// exercised in CI:
    ///   * the selected table code is carried through UNCHANGED
    ///     (request.Table -&gt; TableRound.TableCode) — never rewritten, never
    ///     a WB* code;
    ///   * each selected menu item becomes exactly one native round line,
    ///     preserving product code, quantity and seat;
    ///   * the request models only THIS round's new lines, so a second
    ///     Send-to-Kitchen maps to a round carrying only its own items — the
    ///     server appends them after the existing lines (STATIC-PROVEN),
    ///     never a full-table resend.
    ///
    /// Pos/clerk/guests/location are submission context supplied by the
    /// caller (OrderService), not by the request. Pos is pinned to 1 —
    /// POSServer's own invariant for these pending-sale rows (STATIC-PROVEN).
    /// </summary>
    public static class NativeTableRoundMapper
    {
        public static TableRound ToTableRound(
            OrderRequest request,
            int pos,
            int clerkId,
            int guests,
            int location)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }
            if (request.Items == null || request.Items.Count == 0)
            {
                throw new ArgumentException("An order round must carry at least one item.", nameof(request));
            }

            var lines = new List<TableRoundLine>(request.Items.Count);
            foreach (OrderLineRequest item in request.Items)
            {
                lines.Add(new TableRoundLine(
                    stockItemCode: item.ProductCode,
                    quantity: item.Quantity,
                    seat: item.Seat));
            }

            return new TableRound(
                request.Table,            // carried through UNCHANGED
                pos,
                clerkId,
                guests,
                location,
                lines,
                new TableRoundIdempotencyContext(request.ExternalOrderId));
        }
    }
}

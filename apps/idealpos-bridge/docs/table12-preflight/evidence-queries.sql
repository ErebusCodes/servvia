-- Table 12 controlled-experiment: read-only evidence queries.
--
-- Run against the Idealpos SQL Server target (IPSTransaction database) via
-- sqlcmd or SSMS. NO credentials are embedded here — connect using
-- whatever authenticated session/tool you already have; do not paste a
-- connection string containing a password into this file or into shell
-- history.
--
-- Every query below is SELECT-only. Nothing here writes to WebPendingOrder,
-- PendingSales, PendingSaleLines or TableMapSetups — VerduraIdealposBridge's
-- own IdealposReadRepository.cs is exclusively read-only for the same
-- reason (the only write path in the whole bridge is
-- LocalDataHelper.InsertOrders(), called from IdealposOrderSubmitter.cs).
--
-- Fill in the @-variables in section 0 once per test run, then execute the
-- sections in order. Do not rely on "SELECT TOP 1 ... ORDER BY ID DESC"
-- alone as proof of correlation if concurrent activity is possible on the
-- target — every query below filters by the external correlation key
-- (WebReference / ExternalOrderId) wherever the schema allows it, and
-- section 6 exists specifically to catch a false "latest row" match.

-- =====================================================================
-- 0. Fill in before running anything else.
-- =====================================================================
DECLARE @ExternalOrderId  NVARCHAR(200) = N'<<REPLACE: the externalOrderId you are about to submit, e.g. VERDURA-TABLE12-PREFLIGHT-2026-08-19T...>>';
DECLARE @WebReference     NVARCHAR(200) = N'<<REPLACE: the idealposWebReference the bridge returns in its response body / GET /api/orders/{id} — NOT necessarily identical to ExternalOrderId; the ReferencePrefix strategy changes it, see table-assignment-review.md>>';
DECLARE @RequestedTable   NVARCHAR(50)  = N'<<REPLACE: the "table" value you sent in the request, e.g. the TableMapSetups.Caption you resolved in section 0a below>>';
DECLARE @SinceUtc         DATETIME2     = SYSUTCDATETIME(); -- set this to the actual submission time once you have it, for section 5's window

-- =====================================================================
-- 0a. BEFORE the request: resolve the real table Caption/Code and confirm
--     it is currently empty/inactive. Run this FIRST, before filling in
--     @RequestedTable above and before submitting anything.
--     Mirrors Idealpos/IdealposReadRepository.cs's GetTables() exactly.
-- =====================================================================
SELECT
    Code, Type, [Index], Caption, Seats, Status, Amount, GuestsSaved,
    CASE WHEN Amount > 0 OR Status <> 0 THEN 1 ELSE 0 END AS LikelyOccupied_Heuristic
FROM dbo.TableMapSetups
WHERE Caption = N'12' OR Code = 12
ORDER BY Code, [Index];
-- Expect: exactly one row (or one per floor-plan Type, if the same Caption
-- appears in multiple areas — pick the one you actually intend to test).
-- Note whether Caption and Code, as strings, actually match ("12" vs 12) —
-- see table-assignment-review.md for why this matters. LikelyOccupied
-- should be 0/false before you submit; if not, this table is not safe to
-- test against right now (stop condition).

-- =====================================================================
-- 0b. BEFORE the request: confirm the intended test item/PLU exists and
--     record its current description/price for the later comparison in
--     section 4. Mirrors GetIpsStockItemsDic() via GET /api/products
--     instead of raw SQL (no confirmed direct StockItem table/columns in
--     this bridge's own investigation) — run the HTTP call, not a query:
--       GET /api/products  (Authorization: Bearer <key>)
--     and record the productCode/description/price you intend to use.
-- =====================================================================

-- =====================================================================
-- 1. AFTER submission: WebPendingOrder creation evidence.
--    Confirms the bridge's InsertOrders() call actually produced a row —
--    the first genuine (non-HTTP-200) evidence in the whole chain.
-- =====================================================================
SELECT ID, Processed, DateRetrieved, DateProcessed, WebReference, Origin
FROM dbo.WebPendingOrder
WHERE WebReference = @WebReference
ORDER BY ID DESC;
-- Expect: exactly ONE row. Record its ID as <WebPendingOrderId>.
-- If zero rows: InsertOrders() may not have committed yet (race with the
-- watcher's own polling) — re-run after a few seconds before concluding
-- failure. If MORE than one row: stop and investigate before proceeding —
-- that would mean either a real duplicate-insert defect or WebReference
-- reuse across two different externalOrderIds; do not submit a second
-- order until this is understood.

-- =====================================================================
-- 2. Native consumption evidence: did IPS.exe (not the bridge) flip
--    Processed?
-- =====================================================================
SELECT ID, Processed, DateRetrieved, DateProcessed, WebReference
FROM dbo.WebPendingOrder
WHERE WebReference = @WebReference;
-- Expect: Processed = 1 within a few seconds to a couple of minutes
-- (depends on native Idealpos's own polling cadence, not this bridge's).
-- DateProcessed should be a real, recent timestamp — that timestamp, set
-- by native Idealpos itself, is your strongest "native process touched
-- this row" evidence, independent of anything the bridge reports.

-- =====================================================================
-- 3. Resulting PendingSales row — correlated by Reference first (the
--    confirmed mechanism this bridge's watcher tries first).
-- =====================================================================
SELECT ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate
FROM dbo.PendingSales
WHERE Reference = @WebReference
ORDER BY ID DESC;
-- Expect: exactly ONE row. Record its ID as <PendingSalesId> and its Code.
-- *** Code is the value to compare against @RequestedTable — this is the
-- central fact tomorrow's experiment exists to establish. ***

-- 3b. Fallback ONLY if 3 returns zero rows — NOT proof of correlation by
--     itself; a human must visually confirm which row (if any) is really
--     this test order before trusting it. This mirrors
--     IdealposReadRepository.GetRecentPendingSales()'s own documented
--     "not confirmed Reference is even populated this way" caveat.
SELECT TOP (5) ID, Code, Status, OrderState, SentOnline, Reference, Date, OrderDate
FROM dbo.PendingSales
WHERE Date >= @SinceUtc
ORDER BY ID DESC;
-- If you must use this fallback, cross-check against section 0b's item/
-- price and section 4 below before treating any row here as "the" match.

-- =====================================================================
-- 4. Item/quantity/price/tax comparison — the actual line items on the
--    resulting sale, to compare against what you submitted.
-- =====================================================================
DECLARE @PendingSalesId INT = <<REPLACE: the ID from section 3>>;
SELECT [Line], Col1, Col2, Person, SeatNumber
FROM dbo.PendingSaleLines
WHERE PendingSaleID = @PendingSalesId
ORDER BY [Line];
-- Note: this bridge's own IdealposReadRepository.GetPendingSaleLines()
-- exists but is not currently wired into the watcher/API response (a
-- documented gap, not a bug) — this raw query is the actual evidence
-- source for item lines tomorrow, not GET /api/orders/{id}, which does
-- not echo items at all. Compare Col1/Col2 (exact meaning not decompiled
-- by this bridge's investigation — record what you observe) against the
-- productCode/quantity you submitted, and cross-check the Idealpos UI's
-- own display of Table 12's order for price/tax (never returned by this
-- bridge — Idealpos calculates and owns pricing).

-- =====================================================================
-- 5. Table Caption/Code cross-check on the resulting sale.
-- =====================================================================
SELECT ps.ID AS PendingSalesId, ps.Code AS PendingSalesCode,
       tms.Caption AS RequestedTableCaption, tms.Code AS RequestedTableCode
FROM dbo.PendingSales ps
LEFT JOIN dbo.TableMapSetups tms ON tms.Caption = @RequestedTable OR CAST(tms.Code AS NVARCHAR(20)) = @RequestedTable
WHERE ps.Reference = @WebReference;
-- Passes only if PendingSalesCode is the SAME value/space as one of
-- RequestedTableCaption/RequestedTableCode — this is exactly the open
-- question table-assignment-review.md documents.

-- =====================================================================
-- 6. Duplicate detection (Phase 6 replay step) — run again after
--    resubmitting the SAME externalOrderId with the SAME idempotency
--    behaviour. Both counts below must stay exactly 1.
-- =====================================================================
SELECT COUNT(*) AS WebPendingOrderRowCount
FROM dbo.WebPendingOrder WHERE WebReference = @WebReference;

SELECT COUNT(*) AS PendingSalesRowCount
FROM dbo.PendingSales WHERE Reference = @WebReference;
-- Either count > 1 is a real, serious finding — stop, do not submit
-- anything further, and escalate before continuing testing.

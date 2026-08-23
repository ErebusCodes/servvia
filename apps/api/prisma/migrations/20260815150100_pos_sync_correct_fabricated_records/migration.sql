-- Story 9-1 AC5: correct historical rows produced by the pre-fix fabrication
-- bug. No real Idealpos adapter has ever existed in this codebase (blocked
-- on decision record DL-064 — see docs/decisions-log.md), so
-- POSSyncRecord.status = 'synced' has no legitimate historical occurrence:
-- every such row was produced exclusively by the removed processor code
-- path that synthesized a plausible-looking `IDEAL-*` transaction ID
-- without ever contacting a real Idealpos system. This statement is
-- idempotent — safe to re-run — because its own WHERE clause excludes rows
-- it has already corrected.
--
-- Keyed off the record's OWN `adapterType` column, not the venue's current
-- `posAdapterType` — a venue's configuration can change after an order was
-- placed, and a historical record must be reclassified according to what
-- was actually configured at the time the (fabricated) attempt was made,
-- not the venue's config today. No join to "Venue" is needed.

UPDATE "POSSyncRecord"
SET
  status = CASE
    WHEN "adapterType" = 'none' THEN 'not_applicable'::"POSSyncStatus"
    ELSE 'unsupported'::"POSSyncStatus"
  END,
  "posOrderId" = NULL,
  "responsePayload" = NULL,
  "syncedAt" = NULL,
  "errorMessage" = 'Corrected 2026-08-15 (Story 9-1): this record''s previous ''synced'' status and posOrderId were fabricated by a bug that synthesized a plausible-looking transaction ID without ever contacting Idealpos. No real Idealpos adapter has ever existed in this codebase; this order was never actually submitted to or confirmed by Idealpos.'
WHERE status = 'synced';

-- Order.posSyncStatus is a denormalized mirror of the record above.
-- Corrected via the matching POSSyncRecord's (pre-update) adapterType where
-- one still exists; falls back to the order's own venue's current
-- posAdapterType only for the edge case of an order whose POSSyncRecord row
-- was separately deleted while its mirrored status remained 'synced' (no
-- historical adapterType is recoverable in that case).
UPDATE "Order" o
SET "posSyncStatus" = CASE
    WHEN COALESCE(
      (SELECT p."adapterType"::text FROM "POSSyncRecord" p WHERE p."orderId" = o.id),
      v."posAdapterType"::text
    ) = 'none'
      THEN 'not_applicable'::"POSSyncStatus"
    ELSE 'unsupported'::"POSSyncStatus"
  END
FROM "Venue" v
WHERE o."venueId" = v.id
  AND o."posSyncStatus" = 'synced';

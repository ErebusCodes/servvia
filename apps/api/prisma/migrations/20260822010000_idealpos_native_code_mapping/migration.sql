-- Adds explicit, persisted native-POS mapping fields. Both are nullable
-- and purely additive: no existing row's semantics change, and unmapped
-- rows stay unmapped (Postgres unique indexes permit unlimited NULLs).
--
-- Verdura's Order Tablet could not previously produce an unambiguous
-- IdealPOS-compatible order payload for either dimension without guessing
-- (see the durable-submission dependency-audit finding: uncommitted
-- Story 15-5 scaffolding was sending a Verdura MenuItem UUID as the
-- bridge's `productCode`, explicitly self-documented in that code as a
-- "KNOWN GAP, not a real mapping"). These columns are the actual mapping
-- data that gap requires; no submission/reconciliation logic is added by
-- this migration.

-- AlterTable
ALTER TABLE "Table" ADD COLUMN "posTableCode" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "posProductCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Table_venueId_posTableCode_key" ON "Table"("venueId", "posTableCode");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_organizationId_posProductCode_key" ON "MenuItem"("organizationId", "posProductCode");

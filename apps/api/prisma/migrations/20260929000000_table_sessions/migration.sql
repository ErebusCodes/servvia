-- Phase D2: first-class TableSession (ADR 0001, docs/migration/README.md).
--
-- PURELY ADDITIVE. One new enum and one new table. No existing table, column,
-- index or row is altered, dropped or rewritten, and no data is migrated: the
-- table starts empty. Historical orders keep Order.tableId / Order.guests as
-- the record of their visit; no sessions are fabricated for them.
--
-- Nothing in the NestJS API reads or writes this table. Servvia Core (Go)
-- owns it. Applying this migration changes no existing behaviour.
--
-- Rollback (development/test databases only; production needs its own
-- approval): the table is new and nothing references it, so
--   DROP TABLE "TableSession"; DROP TYPE "TableSessionStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260929000000_table_sessions';
-- restores the previous schema exactly.

-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "TableSessionStatus" NOT NULL DEFAULT 'open',
    "covers" INTEGER NOT NULL,
    "openedByStaffId" TEXT,
    "openRequestKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_tableId_openRequestKey_key" ON "TableSession"("tableId", "openRequestKey");

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_openedByStaffId_fkey" FOREIGN KEY ("openedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-authored below: invariants schema.prisma cannot express (the same
-- approach as "ConnectorInstallation_one_active_per_venue" in
-- 20260816140000_connector_identity). schema.prisma documents each one on the
-- TableSession model.

-- At most one open session per table. This index IS the enforcement: two
-- concurrent opens of the same table cannot both commit; the loser gets a
-- unique violation (23505) that Servvia Core turns into a 409.
CREATE UNIQUE INDEX "TableSession_one_open_per_table"
  ON "TableSession"("tableId")
  WHERE "status" = 'open';

-- Covers use the bounds Order.guests already has (CreateStaffOrderDto: 1..99).
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_covers_range"
  CHECK ("covers" BETWEEN 1 AND 99);

ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_version_positive"
  CHECK ("version" >= 1);

-- A session is open exactly when it has not ended.
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_closed_at_matches_status"
  CHECK (("status" = 'open') = ("closedAt" IS NULL));

-- Idempotency keys use the Order.idempotencyKey bounds (16..255).
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_open_request_key_length"
  CHECK (char_length("openRequestKey") BETWEEN 16 AND 255);

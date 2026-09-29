-- Phase D3: canonical Servvia order core (ADR 0001, docs/migration/README.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated: every existing order keeps tableSessionId = NULL and
-- every existing line keeps roundId = NULL. No sessions or rounds are
-- fabricated for history.
--
--   * OrderSource gains the canonical surfaces Servvia Core writes
--     (pos_terminal, waiter_tablet, order_tablet, customer_web; kiosk
--     exists). `staff` and `online` stay for legacy rows and callers.
--   * Order.tableSessionId: a table-service order belongs to its visit. A
--     visit may hold several orders (e.g. a staff order and a guest's
--     Order Tablet order); occupancy is the session's (one open session per
--     table), not "one active order". Duplicates are prevented by
--     idempotency keys, not by capping orders per visit.
--   * OrderRound + OrderItem.roundId: submissions of requested items.
--   * OutboxEvent: canonical events written in the same transaction as the
--     change (the Phase D4 kitchen will consume order.round_submitted).
--   * Order.posSyncStatus DEFAULT becomes 'not_applicable'. The NestJS path
--     always sets the column explicitly, so its behaviour is unchanged; the
--     default now describes the only writer relying on it, Servvia Core,
--     whose orders have no external POS. Existing rows are untouched.
--
-- Locks: adding the CHECK constraint and the composite foreign key on
-- "Order" scans the table under an ACCESS EXCLUSIVE lock (every existing row
-- passes: tableSessionId is NULL).
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop the new constraints, indexes, columns and tables, and
-- restore the posSyncStatus default to 'not_synced'. Enum values cannot be
-- removed from a PostgreSQL type without recreating it; the four new
-- OrderSource values are harmless if unused.


ALTER TYPE "OrderSource" ADD VALUE 'pos_terminal';
ALTER TYPE "OrderSource" ADD VALUE 'waiter_tablet';
ALTER TYPE "OrderSource" ADD VALUE 'order_tablet';
ALTER TYPE "OrderSource" ADD VALUE 'customer_web';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tableSessionId" TEXT,
ALTER COLUMN "posSyncStatus" SET DEFAULT 'not_applicable';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "roundId" TEXT;

-- CreateTable
CREATE TABLE "OrderRound" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "submittedByStaffId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderRound_orderId_sequence_key" ON "OrderRound"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRound_orderId_requestKey_key" ON "OrderRound"("orderId", "requestKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tableSessionId_idx" ON "Order"("tableSessionId");

-- CreateIndex
CREATE INDEX "OrderItem_roundId_idx" ON "OrderItem"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_id_tableId_key" ON "TableSession"("id", "tableId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_tableId_fkey" FOREIGN KEY ("tableSessionId", "tableId") REFERENCES "TableSession"("id", "tableId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "OrderRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

-- Only table service belongs to a table session.
ALTER TABLE "Order" ADD CONSTRAINT "Order_table_session_is_dine_in"
  CHECK ("tableSessionId" IS NULL OR "serviceMode" = 'dine_in');

ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_sequence_positive"
  CHECK ("sequence" >= 1);

-- The Order.idempotencyKey bounds (16..255).
ALTER TABLE "OrderRound" ADD CONSTRAINT "OrderRound_request_key_length"
  CHECK (char_length("requestKey") BETWEEN 16 AND 255);

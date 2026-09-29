-- Phase D5: canonical checks (ADR 0001, docs/migration/d5-checks.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated. No checks are fabricated for history: checks are created
-- only by Servvia Core, from Servvia Core orders.
--
--   * Check: a financial obligation, open or voided. No paid/settled state
--     (Payment and Settlement are Phase D6), no external-POS or payment
--     provider field. Any number of checks per table session.
--   * CheckLine: the accepted financial snapshot of one order line. An order
--     line is on at most one standing (not voided) check: partial unique
--     index below.
--   * OrderItem gains a unique (id, orderId), the target of the check line's
--     composite foreign key: a line's order is its order line's order.
--
-- Deletes: an order, order line or table session that a check bills cannot
-- be deleted (RESTRICT): financial history is kept.
--
-- Locks: the unique index on "OrderItem" (id, orderId) is built under a SHARE
-- lock, so inserts into OrderItem wait while it builds (every existing row
-- passes: id is already unique). Everything else is new tables.
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop "CheckLine", "Check", the enum and the OrderItem index.

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('open', 'voided');

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableSessionId" TEXT,
    "status" "CheckStatus" NOT NULL DEFAULT 'open',
    "currency" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "voidedByStaffId" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckLine" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "CheckLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Check_venueId_status_idx" ON "Check"("venueId", "status");

-- CreateIndex
CREATE INDEX "Check_tableSessionId_idx" ON "Check"("tableSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Check_venueId_idempotencyKey_key" ON "Check"("venueId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CheckLine_orderItemId_idx" ON "CheckLine"("orderItemId");

-- CreateIndex
CREATE INDEX "CheckLine_orderId_idx" ON "CheckLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckLine_checkId_position_key" ON "CheckLine"("checkId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_id_orderId_key" ON "OrderItem"("id", "orderId");

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_voidedByStaffId_fkey" FOREIGN KEY ("voidedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_orderItemId_orderId_fkey" FOREIGN KEY ("orderItemId", "orderId") REFERENCES "OrderItem"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

-- An order line is billed at most once by the checks that stand. A voided
-- check's lines are released (voidedAt set in the void's transaction).
CREATE UNIQUE INDEX "CheckLine_orderItemId_standing_key" ON "CheckLine" ("orderItemId")
  WHERE "voidedAt" IS NULL;

ALTER TABLE "Check" ADD CONSTRAINT "Check_version_positive"
  CHECK ("version" >= 1);

-- The Order.idempotencyKey bounds (16..255).
ALTER TABLE "Check" ADD CONSTRAINT "Check_idempotency_key_length"
  CHECK (char_length("idempotencyKey") BETWEEN 16 AND 255);

ALTER TABLE "Check" ADD CONSTRAINT "Check_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- GST-inclusive pricing (D1): the total owed is the gross, and the tax is
-- contained in it. Revisit together with any additive-tax profile.
ALTER TABLE "Check" ADD CONSTRAINT "Check_total_is_gross"
  CHECK ("totalCents" = "subtotalCents");

-- Void fields are set exactly when the check is voided.
ALTER TABLE "Check" ADD CONSTRAINT "Check_void_fields"
  CHECK (("status" = 'voided') = ("voidedAt" IS NOT NULL)
     AND ("status" = 'voided') = ("voidReason" IS NOT NULL));

ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_quantity_positive"
  CHECK ("quantity" >= 1);

ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_position_positive"
  CHECK ("position" >= 1);

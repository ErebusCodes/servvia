-- Phase D7: canonical shifts and cash accountability (ADR 0001,
-- docs/migration/d7-shifts-cash.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated: no shifts or cash movements are fabricated for history,
-- and existing card payments stay valid without a shift.
--
--   * Shift: one staff member's accountable cash period at a venue. At most
--     one open shift per (venue, staff): partial unique index below. No
--     venue-wide limit; no terminal or drawer identity (a later additive
--     column).
--   * CashMovement: a durable change to a shift's cash; cash_sale only, one
--     per cash payment.
--   * TenderType gains 'cash'. A cash payment is succeeded at once (CHECK
--     below, written without naming the new value, which PostgreSQL does not
--     allow in the transaction that adds it).
--
-- Deletes: shifts and movements RESTRICT everything they reference;
-- financial history is never deleted with a staff member, payment or shift.
--
-- Locks: new tables; a CHECK constraint on "CheckPayment" scans it under an
-- ACCESS EXCLUSIVE lock (every existing row is card and passes).
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop "CashMovement", "Shift", their enums and the CheckPayment
-- constraint. 'cash' cannot be removed from TenderType without recreating
-- the type; it is harmless if unused.

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('cash_sale');

-- AlterEnum
ALTER TYPE "TenderType" ADD VALUE 'cash';

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "currency" TEXT NOT NULL,
    "openingFloatCents" INTEGER NOT NULL,
    "openRequestKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByStaffId" TEXT,
    "countedCashCents" INTEGER,
    "expectedCashCents" INTEGER,
    "varianceCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentId" TEXT NOT NULL,
    "actorStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_venueId_status_idx" ON "Shift"("venueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_venueId_openRequestKey_key" ON "Shift"("venueId", "openRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_key" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedByStaffId_fkey" FOREIGN KEY ("closedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CheckPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

-- At most one open shift per staff member per venue.
CREATE UNIQUE INDEX "Shift_one_open_per_staff" ON "Shift" ("venueId", "staffId")
  WHERE "status" = 'open';

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_opening_float_non_negative"
  CHECK ("openingFloatCents" >= 0);

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_open_request_key_length"
  CHECK (char_length("openRequestKey") BETWEEN 16 AND 255);

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- The close facts exist exactly when the shift is closed, and the variance
-- is the count less the expected cash.
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_close_facts"
  CHECK (
    (("status" = 'closed') = ("closedAt" IS NOT NULL)) AND
    (("status" = 'closed') = ("closedByStaffId" IS NOT NULL)) AND
    (("status" = 'closed') = ("countedCashCents" IS NOT NULL)) AND
    (("status" = 'closed') = ("expectedCashCents" IS NOT NULL)) AND
    (("status" = 'closed') = ("varianceCents" IS NOT NULL)) AND
    ("countedCashCents" IS NULL OR "countedCashCents" >= 0) AND
    ("varianceCents" IS NULL OR "varianceCents" = "countedCashCents" - "expectedCashCents")
  );

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_amount_positive"
  CHECK ("amountCents" > 0);

-- Only a card payment waits for a result: any other tender (cash) is
-- accepted by staff and is succeeded from its creation.
ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_non_card_is_succeeded"
  CHECK ("tenderType" = 'card' OR "status" = 'succeeded');

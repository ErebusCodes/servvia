-- Phase D6: canonical payment and settlement (ADR 0001,
-- docs/migration/d6-payments-settlement.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated. The legacy reservation "Payment" table and its
-- PaymentMethod/PaymentStatus enums are untouched.
--
--   * CheckPayment: a provider-neutral tender against a check. Many per check.
--   * CheckPaymentTransition: every payment status change with its actor.
--   * CheckSettlement: the durable fact that a check's obligation was
--     satisfied; exactly one per check.
--   * CheckStatus gains 'settled'. TenderType is 'card' only (cash needs
--     shift/cash-drawer ownership, a later phase).
--
-- Deletes: payments, transitions and settlements RESTRICT the rows they
-- reference; financial history is never deleted with them.
--
-- Locks: new tables only, and an enum value added to "CheckStatus".
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop the three tables and the two new enums. An enum value
-- cannot be removed from a PostgreSQL type without recreating it; 'settled'
-- is harmless if unused.

-- CreateEnum
CREATE TYPE "CheckPaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'uncertain');

-- CreateEnum
CREATE TYPE "TenderType" AS ENUM ('card');

-- AlterEnum
ALTER TYPE "CheckStatus" ADD VALUE 'settled';

-- CreateTable
CREATE TABLE "CheckPayment" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "tenderType" "TenderType" NOT NULL,
    "status" "CheckPaymentStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "requestedByStaffId" TEXT,
    "resultReference" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckPaymentTransition" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromStatus" "CheckPaymentStatus",
    "toStatus" "CheckPaymentStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "resultReference" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckPaymentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckSettlement" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "settlingPaymentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckPayment_checkId_status_idx" ON "CheckPayment"("checkId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckPayment_venueId_idempotencyKey_key" ON "CheckPayment"("venueId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CheckPaymentTransition_paymentId_sequence_key" ON "CheckPaymentTransition"("paymentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CheckSettlement_checkId_key" ON "CheckSettlement"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckSettlement_settlingPaymentId_key" ON "CheckSettlement"("settlingPaymentId");

-- AddForeignKey
ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckPaymentTransition" ADD CONSTRAINT "CheckPaymentTransition_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CheckPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_settlingPaymentId_fkey" FOREIGN KEY ("settlingPaymentId") REFERENCES "CheckPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_amount_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_idempotency_key_length"
  CHECK (char_length("idempotencyKey") BETWEEN 16 AND 255);

ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- resolvedAt is set exactly when the payment is final.
ALTER TABLE "CheckPayment" ADD CONSTRAINT "CheckPayment_resolved_when_final"
  CHECK (("status" IN ('succeeded', 'failed')) = ("resolvedAt" IS NOT NULL));

ALTER TABLE "CheckPaymentTransition" ADD CONSTRAINT "CheckPaymentTransition_sequence_positive"
  CHECK ("sequence" >= 1);

-- Only the creation has no previous status.
ALTER TABLE "CheckPaymentTransition" ADD CONSTRAINT "CheckPaymentTransition_first_is_creation"
  CHECK (("sequence" = 1) = ("fromStatus" IS NULL));

ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_amount_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

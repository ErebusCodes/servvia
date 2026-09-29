-- Phase D9: refunds, reversals and settlement revocation (ADR 0001,
-- docs/migration/d9-refunds-reversals.md).
--
-- ADDITIVE, with one relaxation compensated by a CHECK. No table, column or
-- row is dropped or renamed; no D6/D7 constraint is dropped.
--
--   * PaymentAdjustment (+ transitions): refunds (staff) and reversals
--     (payment adapter) against one payment; capacity-checked, never deleted.
--   * CheckSettlement stays the one current-settlement row per check (its
--     UNIQUE(checkId) is kept) and gains status/cycle/revokedAt/version;
--     CheckSettlementTransition records every settled/revoked event.
--     Existing settlements get their own `settled` event, copied from the
--     row itself (the same fact, not a fabricated one).
--   * CashMovement gains kind cash_refund and adjustmentId. paymentId
--     becomes nullable (a cash refund's movement records the refund, not a
--     payment); the CHECK below keeps every cash_sale tied to its payment and
--     every movement tied to exactly one of the two.
--
-- Locks: new tables; columns with constant defaults (metadata only); the
-- CashMovement CHECK scans that table (every existing row is a cash_sale
-- with a payment and passes).
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop the new tables, columns, constraints and enums, and set
-- CashMovement.paymentId NOT NULL again (only possible while no cash_refund
-- movement exists). Enum values cannot be removed without recreating types.

-- CreateEnum
CREATE TYPE "CheckSettlementStatus" AS ENUM ('settled', 'revoked');

-- CreateEnum
CREATE TYPE "PaymentAdjustmentKind" AS ENUM ('refund', 'reversal');

-- AlterEnum
ALTER TYPE "CashMovementKind" ADD VALUE 'cash_refund';

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "adjustmentId" TEXT,
ALTER COLUMN "paymentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CheckSettlement" ADD COLUMN     "cycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CheckSettlementStatus" NOT NULL DEFAULT 'settled',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CheckSettlementTransition" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "toStatus" "CheckSettlementStatus" NOT NULL,
    "cycle" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentId" TEXT,
    "adjustmentId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckSettlementTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAdjustment" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" "PaymentAdjustmentKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "CheckPaymentStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "reason" TEXT,
    "requestedByStaffId" TEXT,
    "originDeviceId" TEXT,
    "resultReference" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAdjustmentTransition" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "fromStatus" "CheckPaymentStatus",
    "toStatus" "CheckPaymentStatus" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "resultReference" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAdjustmentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckSettlementTransition_settlementId_sequence_key" ON "CheckSettlementTransition"("settlementId", "sequence");

-- CreateIndex
CREATE INDEX "PaymentAdjustment_paymentId_status_idx" ON "PaymentAdjustment"("paymentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAdjustment_venueId_idempotencyKey_key" ON "PaymentAdjustment"("venueId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAdjustmentTransition_adjustmentId_sequence_key" ON "PaymentAdjustmentTransition"("adjustmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_adjustmentId_key" ON "CashMovement"("adjustmentId");

-- AddForeignKey
ALTER TABLE "CheckSettlementTransition" ADD CONSTRAINT "CheckSettlementTransition_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CheckSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSettlementTransition" ADD CONSTRAINT "CheckSettlementTransition_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CheckPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckSettlementTransition" ADD CONSTRAINT "CheckSettlementTransition_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PaymentAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CheckPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_originDeviceId_fkey" FOREIGN KEY ("originDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdjustmentTransition" ADD CONSTRAINT "PaymentAdjustmentTransition_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PaymentAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PaymentAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect. (The new enum value 'cash_refund' is not named: it
-- cannot be used in the transaction that adds it.)

-- Existing settlements: their settled event, from their own row.
INSERT INTO "CheckSettlementTransition"
  (id, "settlementId", sequence, "toStatus", cycle, "amountCents", "paymentId", "actorId", "actorKind", at)
SELECT gen_random_uuid()::text, id, 1, 'settled', 1, "amountCents", "settlingPaymentId", "actorId", "actorKind", "settledAt"
FROM "CheckSettlement";

ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_cycle_positive"
  CHECK ("cycle" >= 1 AND "version" >= 1);

ALTER TABLE "CheckSettlement" ADD CONSTRAINT "CheckSettlement_revoked_fields"
  CHECK (("status" = 'revoked') = ("revokedAt" IS NOT NULL));

-- A settled event names the payment that completed the obligation; a revoked
-- event names the adjustment that reopened it.
ALTER TABLE "CheckSettlementTransition" ADD CONSTRAINT "CheckSettlementTransition_cause"
  CHECK (("toStatus" = 'settled' AND "paymentId" IS NOT NULL AND "adjustmentId" IS NULL) OR
         ("toStatus" = 'revoked' AND "adjustmentId" IS NOT NULL AND "paymentId" IS NULL));

ALTER TABLE "CheckSettlementTransition" ADD CONSTRAINT "CheckSettlementTransition_positive"
  CHECK ("sequence" >= 1 AND "cycle" >= 1 AND "amountCents" > 0);

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_amount_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_idempotency_key_length"
  CHECK (char_length("idempotencyKey") BETWEEN 16 AND 255);

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_resolved_when_final"
  CHECK (("status" IN ('succeeded', 'failed')) = ("resolvedAt" IS NOT NULL));

-- A refund is requested by staff, with a reason; a reversal is reported by a
-- device. Never both, never neither.
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_origin"
  CHECK (("kind" = 'refund' AND "requestedByStaffId" IS NOT NULL AND "reason" IS NOT NULL AND "originDeviceId" IS NULL) OR
         ("kind" = 'reversal' AND "originDeviceId" IS NOT NULL AND "requestedByStaffId" IS NULL));

ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_reason_length"
  CHECK ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500);

ALTER TABLE "PaymentAdjustmentTransition" ADD CONSTRAINT "PaymentAdjustmentTransition_first_is_creation"
  CHECK ("sequence" >= 1 AND (("sequence" = 1) = ("fromStatus" IS NULL)));

-- A movement records exactly one thing: a cash sale its payment, a cash
-- refund its adjustment.
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_source"
  CHECK ((("paymentId" IS NULL) <> ("adjustmentId" IS NULL)) AND
         (("kind" = 'cash_sale') = ("paymentId" IS NOT NULL)));

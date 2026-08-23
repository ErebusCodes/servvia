-- CreateEnum
-- Integration-branch reconciliation note: this enum was originally created
-- by the excluded idealpos-order-reconciliation migration on the dirty
-- main lineage this migration was authored against. It is created here
-- instead, since PaymentObservationEvent.evidenceTier (below) is the only
-- surviving consumer of it on this integration branch.
CREATE TYPE "IdealposEvidenceTier" AS ENUM ('fixture_contract', 'real_windows_table12', 'real_production');

-- CreateEnum
CREATE TYPE "PaymentObservationState" AS ENUM ('not_observed', 'observation_unsupported', 'pending', 'paid', 'declined', 'cancelled', 'reversed', 'refunded', 'uncertain', 'conflict');

-- CreateEnum
CREATE TYPE "PaymentObservationSourceKind" AS ENUM ('fixture', 'connector');

-- CreateTable
CREATE TABLE "PaymentObservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "state" "PaymentObservationState" NOT NULL DEFAULT 'not_observed',
    "provisionalPayableCents" INTEGER,
    "nativeReference" TEXT,
    "nativeAmountCents" INTEGER,
    "nativeCurrency" TEXT,
    "tenderMethod" TEXT,
    "nativeTimestamp" TIMESTAMP(3),
    "unverifiedAmountCents" INTEGER,
    "unverifiedAmountSource" TEXT,
    "discrepancyCents" INTEGER,
    "discrepancyState" TEXT NOT NULL DEFAULT 'pending_authoritative_total',
    "lastAppliedObservationId" TEXT,
    "lastObservedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByStaffId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentObservationEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "sourceKind" "PaymentObservationSourceKind" NOT NULL,
    "adapterType" "POSAdapterType",
    "state" "PaymentObservationState" NOT NULL,
    "nativeReference" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "tenderMethod" TEXT,
    "nativeTimestamp" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceTier" "IdealposEvidenceTier" NOT NULL DEFAULT 'fixture_contract',
    "payloadFingerprint" TEXT,
    "handlerVersion" INTEGER,
    "sanitizedReason" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "conflictReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentObservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObservation_orderId_key" ON "PaymentObservation"("orderId");

-- CreateIndex
CREATE INDEX "PaymentObservation_venueId_state_createdAt_idx" ON "PaymentObservation"("venueId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObservation_nativeReference_key" ON "PaymentObservation"("nativeReference");

-- CreateIndex
CREATE INDEX "PaymentObservationEvent_venueId_createdAt_idx" ON "PaymentObservationEvent"("venueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObservationEvent_orderId_observationId_key" ON "PaymentObservationEvent"("orderId", "observationId");

-- AddForeignKey
ALTER TABLE "PaymentObservation" ADD CONSTRAINT "PaymentObservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObservation" ADD CONSTRAINT "PaymentObservation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObservation" ADD CONSTRAINT "PaymentObservation_reviewedByStaffId_fkey" FOREIGN KEY ("reviewedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObservationEvent" ADD CONSTRAINT "PaymentObservationEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObservationEvent" ADD CONSTRAINT "PaymentObservationEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

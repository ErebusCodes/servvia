-- Native IdealPOS delta rounds for the Order Tablet, plus a real covers column.
--
-- PURELY ADDITIVE AND BACKWARD COMPATIBLE. Two new tables, two new nullable
-- columns, one new enum. No existing column is altered, dropped or rewritten,
-- and no data migration is required: every historical OrderItem keeps
-- nativeRoundId NULL ("never assigned to a native round") and every historical
-- Order keeps guests NULL ("covers unknown"), both of which are true.
--
-- Order.guests replaces reading the count back out of the free-text notes
-- field, where a failed match silently became a hardcoded 2. That was
-- survivable as a display hint and is not survivable as <Guests> in a native
-- Order2 packet, which the till takes as fact.
--
-- The FK from OrderItem is ON DELETE SET NULL rather than CASCADE on purpose.
-- Deleting a round must never delete the customer's order lines; it may only
-- forget which round carried them.

-- CreateEnum
CREATE TYPE "NativeRoundState" AS ENUM ('drafting', 'submitting', 'awaiting_native_confirmation', 'confirmed', 'rejected', 'failed', 'unresolved', 'abandoned');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guests" INTEGER;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "nativeRoundId" TEXT;

-- CreateTable
CREATE TABLE "NativeTableRound" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" "NativeRoundState" NOT NULL DEFAULT 'drafting',
    "posTableCode" TEXT NOT NULL,
    "guests" INTEGER NOT NULL,
    "payloadFrozenAt" TIMESTAMP(3),
    "nativeSaleId" TEXT,
    "nativeSaleTier" TEXT,
    "nativeObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeTableRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NativeSendAttempt" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "posTableCode" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sendInitiatedAt" TIMESTAMP(3) NOT NULL,
    "outcomeKind" TEXT,
    "bytesLeftHost" BOOLEAN,
    "decision" TEXT,
    "responseNote" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeSendAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NativeTableRound_idempotencyKey_key" ON "NativeTableRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NativeTableRound_venueId_state_idx" ON "NativeTableRound"("venueId", "state");

-- CreateIndex
CREATE INDEX "NativeTableRound_posTableCode_state_idx" ON "NativeTableRound"("posTableCode", "state");

-- CreateIndex
CREATE UNIQUE INDEX "NativeTableRound_orderId_sequence_key" ON "NativeTableRound"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "NativeSendAttempt_attemptId_key" ON "NativeSendAttempt"("attemptId");

-- CreateIndex
CREATE INDEX "NativeSendAttempt_roundId_sendInitiatedAt_idx" ON "NativeSendAttempt"("roundId", "sendInitiatedAt");

-- CreateIndex
CREATE INDEX "NativeSendAttempt_deviceId_sendInitiatedAt_idx" ON "NativeSendAttempt"("deviceId", "sendInitiatedAt");

-- CreateIndex
CREATE INDEX "NativeSendAttempt_token_idx" ON "NativeSendAttempt"("token");

-- CreateIndex
CREATE INDEX "OrderItem_nativeRoundId_idx" ON "OrderItem"("nativeRoundId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_nativeRoundId_fkey" FOREIGN KEY ("nativeRoundId") REFERENCES "NativeTableRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeTableRound" ADD CONSTRAINT "NativeTableRound_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeSendAttempt" ADD CONSTRAINT "NativeSendAttempt_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "NativeTableRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;


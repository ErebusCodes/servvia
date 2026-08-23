-- CreateEnum
CREATE TYPE "KdsDeliveryStatus" AS ENUM ('queued', 'pushed', 'cancelled', 'exhausted');

-- CreateTable
CREATE TABLE "KdsDeliveryRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "status" "KdsDeliveryStatus" NOT NULL DEFAULT 'queued',
    "dispatchClaimId" TEXT,
    "dispatchClaimedAt" TIMESTAMP(3),
    "dispatchClaimExpiresAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "pushAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastDispatchError" TEXT,
    "dispatchExhaustedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KdsDeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KdsDeliveryRecord_orderId_key" ON "KdsDeliveryRecord"("orderId");

-- CreateIndex
CREATE INDEX "KdsDeliveryRecord_status_dispatchExhaustedAt_createdAt_idx" ON "KdsDeliveryRecord"("status", "dispatchExhaustedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "KdsDeliveryRecord" ADD CONSTRAINT "KdsDeliveryRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KdsDeliveryRecord" ADD CONSTRAINT "KdsDeliveryRecord_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "POSSyncRecord" ADD COLUMN     "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "dispatchClaimId" TEXT,
ADD COLUMN     "dispatchClaimedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchExhaustedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "lastDispatchError" TEXT;

-- CreateIndex
CREATE INDEX "POSSyncRecord_status_dispatchExhaustedAt_createdAt_idx" ON "POSSyncRecord"("status", "dispatchExhaustedAt", "createdAt");


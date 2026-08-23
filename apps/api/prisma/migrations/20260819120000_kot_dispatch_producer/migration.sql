-- AlterEnum
ALTER TYPE "PrintJobStatus" ADD VALUE 'connector_dispatched';

-- AlterTable
ALTER TABLE "PrinterJob" ADD COLUMN     "connectorCommandId" TEXT,
ADD COLUMN     "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "dispatchClaimId" TEXT,
ADD COLUMN     "dispatchClaimedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchExhaustedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "lastDispatchError" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PrinterJob_connectorCommandId_key" ON "PrinterJob"("connectorCommandId");

-- CreateIndex
CREATE INDEX "PrinterJob_status_dispatchExhaustedAt_queuedAt_idx" ON "PrinterJob"("status", "dispatchExhaustedAt", "queuedAt");

-- AddForeignKey
ALTER TABLE "PrinterJob" ADD CONSTRAINT "PrinterJob_connectorCommandId_fkey" FOREIGN KEY ("connectorCommandId") REFERENCES "ConnectorCommand"("id") ON DELETE SET NULL ON UPDATE CASCADE;


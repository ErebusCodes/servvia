-- Purely additive: two new POSSyncStatus enum values, one new nullable
-- unique column on POSSyncRecord, one new index. No existing row's status
-- can already hold either new value, so no backfill is needed.

-- AlterEnum
ALTER TYPE "POSSyncStatus" ADD VALUE 'queued_for_connector';
ALTER TYPE "POSSyncStatus" ADD VALUE 'submitted_awaiting_confirmation';

-- AlterTable
ALTER TABLE "POSSyncRecord" ADD COLUMN "connectorSubmitCommandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "POSSyncRecord_connectorSubmitCommandId_key" ON "POSSyncRecord"("connectorSubmitCommandId");

-- CreateIndex
CREATE INDEX "POSSyncRecord_status_attemptCount_createdAt_idx" ON "POSSyncRecord"("status", "attemptCount", "createdAt");

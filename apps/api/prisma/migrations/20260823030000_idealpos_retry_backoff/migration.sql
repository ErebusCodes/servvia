-- DL-092: purely additive. Two new nullable columns on POSSyncRecord — no
-- existing row needs a backfill (both default to NULL, which already means
-- "immediately eligible" / "not exhausted" for every pre-existing row) —
-- and one new index supporting the retry-eligibility query.

-- AlterTable
ALTER TABLE "POSSyncRecord" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "POSSyncRecord" ADD COLUMN "retryExhaustedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "POSSyncRecord_status_nextRetryAt_idx" ON "POSSyncRecord"("status", "nextRetryAt");

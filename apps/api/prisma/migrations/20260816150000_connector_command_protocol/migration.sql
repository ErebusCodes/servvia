-- CreateEnum
CREATE TYPE "ConnectorCommandStatus" AS ENUM ('pending', 'claimed', 'accepted', 'succeeded', 'failed', 'expired', 'unknown', 'cancelled');

-- CreateTable
CREATE TABLE "ConnectorCommand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceAggregateType" TEXT,
    "sourceRecordId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "causationId" TEXT,
    "requiredCapability" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ConnectorCommandStatus" NOT NULL DEFAULT 'pending',
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedByInstallationId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "claimAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxClaimAttempts" INTEGER NOT NULL DEFAULT 5,
    "acceptedAt" TIMESTAMP(3),
    "terminalReportDeadline" TIMESTAMP(3),
    "resultType" TEXT,
    "resultPayload" JSONB,
    "failureReason" TEXT,
    "reportedAt" TIMESTAMP(3),
    "reportIdempotencyKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByStaffId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorCommand_venueId_status_createdAt_idx" ON "ConnectorCommand"("venueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorCommand_status_expiresAt_idx" ON "ConnectorCommand"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCommand_organizationId_venueId_idempotencyKey_key" ON "ConnectorCommand"("organizationId", "venueId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ConnectorCommand" ADD CONSTRAINT "ConnectorCommand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCommand" ADD CONSTRAINT "ConnectorCommand_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCommand" ADD CONSTRAINT "ConnectorCommand_claimedByInstallationId_fkey" FOREIGN KEY ("claimedByInstallationId") REFERENCES "ConnectorInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCommand" ADD CONSTRAINT "ConnectorCommand_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCommand" ADD CONSTRAINT "ConnectorCommand_cancelledByStaffId_fkey" FOREIGN KEY ("cancelledByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Story 2-10 (hand-authored, not expressible in schema.prisma): database-
-- enforced state-machine invariants, so a bug in the service layer cannot
-- silently write an internally-inconsistent row. Mirrors story 2-9's
-- precedent of hand-authoring a CHECK for exactly this reason
-- (ConnectorInstallation_revoked_has_revokedAt).

-- A claim's three bookkeeping fields are set atomically together, or not at
-- all — never partially.
ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_claim_fields_consistent"
  CHECK ((("claimedByInstallationId" IS NULL) = ("claimedAt" IS NULL))
     AND (("claimedAt" IS NULL) = ("leaseExpiresAt" IS NULL)));

-- A command cannot be `accepted` without a recorded claim owner — acceptance
-- is meaningless without knowing which installation accepted responsibility.
ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_accepted_has_claim_owner"
  CHECK ("status" != 'accepted' OR "claimedByInstallationId" IS NOT NULL);

-- A terminal success/failure report can only follow a real, recorded
-- acceptance — a command cannot jump straight from `pending`/`claimed` to a
-- truthful terminal outcome, which would imply an unaccepted command was
-- somehow executed.
ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_terminal_report_requires_acceptance"
  CHECK ("status" NOT IN ('succeeded', 'failed') OR "acceptedAt" IS NOT NULL);

-- A cancelled command must record when it was cancelled.
ALTER TABLE "ConnectorCommand"
  ADD CONSTRAINT "ConnectorCommand_cancelled_has_cancelledAt"
  CHECK ("status" != 'cancelled' OR "cancelledAt" IS NOT NULL);


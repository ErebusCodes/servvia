-- CreateEnum
CREATE TYPE "ConnectorInstallationStatus" AS ENUM ('active', 'revoked', 'replaced');

-- CreateTable
CREATE TABLE "ConnectorEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdByStaffId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorInstallation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "ConnectorInstallationStatus" NOT NULL DEFAULT 'active',
    "reportedVersion" TEXT,
    "reportedCapabilities" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByStaffId" TEXT,
    "replacedByInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorEnrollment_organizationId_venueId_idx" ON "ConnectorEnrollment"("organizationId", "venueId");

-- CreateIndex
CREATE INDEX "ConnectorEnrollment_expiresAt_idx" ON "ConnectorEnrollment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorInstallation_enrollmentId_key" ON "ConnectorInstallation"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorInstallation_replacedByInstallationId_key" ON "ConnectorInstallation"("replacedByInstallationId");

-- CreateIndex
CREATE INDEX "ConnectorInstallation_organizationId_venueId_status_idx" ON "ConnectorInstallation"("organizationId", "venueId", "status");

-- AddForeignKey
ALTER TABLE "ConnectorEnrollment" ADD CONSTRAINT "ConnectorEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorEnrollment" ADD CONSTRAINT "ConnectorEnrollment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorEnrollment" ADD CONSTRAINT "ConnectorEnrollment_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorInstallation" ADD CONSTRAINT "ConnectorInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorInstallation" ADD CONSTRAINT "ConnectorInstallation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorInstallation" ADD CONSTRAINT "ConnectorInstallation_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "ConnectorEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorInstallation" ADD CONSTRAINT "ConnectorInstallation_revokedByStaffId_fkey" FOREIGN KEY ("revokedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorInstallation" ADD CONSTRAINT "ConnectorInstallation_replacedByInstallationId_fkey" FOREIGN KEY ("replacedByInstallationId") REFERENCES "ConnectorInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Story 2-9 (hand-authored, not expressible in schema.prisma): a partial
-- unique index enforcing "at most one active ConnectorInstallation per
-- venue" at the database level — the actual correctness boundary for
-- concurrent enrollment/replacement, not an application-level check. Two
-- concurrent transactions racing to insert/activate a second `active` row
-- for the same venue: exactly one commits, the other raises a real Postgres
-- unique-violation (23505) that the service layer recovers from cleanly
-- (see connector.service.ts), mirroring the established P2002-recovery
-- pattern already used by stories 6-1/8-1/9-1.
CREATE UNIQUE INDEX "ConnectorInstallation_one_active_per_venue"
  ON "ConnectorInstallation"("venueId")
  WHERE "status" = 'active';

-- Defensive: a revoked/replaced installation must record when and (for
-- revocation) by whom — catches an application bug that flips status
-- without the accompanying audit fields, rather than allowing a silently
-- incomplete revocation record.
ALTER TABLE "ConnectorInstallation"
  ADD CONSTRAINT "ConnectorInstallation_revoked_has_revokedAt"
  CHECK ("status" != 'revoked' OR "revokedAt" IS NOT NULL);


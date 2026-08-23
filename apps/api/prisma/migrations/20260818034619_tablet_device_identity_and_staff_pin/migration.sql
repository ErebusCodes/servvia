-- CreateEnum
CREATE TYPE "TabletDeviceStatus" AS ENUM ('active', 'revoked');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinSetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TabletEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TabletEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TabletDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "TabletDeviceStatus" NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TabletDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TabletEnrollment_organizationId_venueId_idx" ON "TabletEnrollment"("organizationId", "venueId");

-- CreateIndex
CREATE INDEX "TabletEnrollment_expiresAt_idx" ON "TabletEnrollment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TabletDevice_enrollmentId_key" ON "TabletDevice"("enrollmentId");

-- CreateIndex
CREATE INDEX "TabletDevice_organizationId_venueId_status_idx" ON "TabletDevice"("organizationId", "venueId", "status");

-- AddForeignKey
ALTER TABLE "TabletEnrollment" ADD CONSTRAINT "TabletEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletEnrollment" ADD CONSTRAINT "TabletEnrollment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletEnrollment" ADD CONSTRAINT "TabletEnrollment_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletDevice" ADD CONSTRAINT "TabletDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletDevice" ADD CONSTRAINT "TabletDevice_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletDevice" ADD CONSTRAINT "TabletDevice_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TabletEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TabletDevice" ADD CONSTRAINT "TabletDevice_revokedByStaffId_fkey" FOREIGN KEY ("revokedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

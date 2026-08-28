-- CreateEnum
CREATE TYPE "MenuChannel" AS ENUM ('order_tablet', 'customer_website', 'window_display');

-- CreateEnum
CREATE TYPE "PosSourceSystem" AS ENUM ('idealpos');

-- CreateEnum
CREATE TYPE "PosSourceLifecycleStatus" AS ENUM ('pending_review', 'active', 'hidden', 'unavailable', 'source_missing', 'source_inactive');

-- CreateEnum
CREATE TYPE "PosCandidateConfidenceTier" AS ENUM ('high_confidence_active', 'likely_active', 'ambiguous', 'takeaway_duplicate', 'operational_non_menu', 'inactive');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "visibleChannels" "MenuChannel"[] DEFAULT ARRAY[]::"MenuChannel"[];

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibleChannels" "MenuChannel"[] DEFAULT ARRAY[]::"MenuChannel"[];

-- CreateTable
CREATE TABLE "PosProductIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" "PosSourceSystem" NOT NULL DEFAULT 'idealpos',
    "nativeCode" TEXT NOT NULL,
    "nativeDescription" TEXT NOT NULL,
    "lifecycleStatus" "PosSourceLifecycleStatus" NOT NULL DEFAULT 'pending_review',
    "confidenceTier" "PosCandidateConfidenceTier",
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "priceCentsFromPos" INTEGER,
    "priceLastSyncedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "descriptionDriftDetectedAt" TIMESTAMP(3),
    "menuItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosProductIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosProductIdentity_menuItemId_key" ON "PosProductIdentity"("menuItemId");

-- CreateIndex
CREATE INDEX "PosProductIdentity_organizationId_lifecycleStatus_confidenc_idx" ON "PosProductIdentity"("organizationId", "lifecycleStatus", "confidenceTier");

-- CreateIndex
CREATE UNIQUE INDEX "PosProductIdentity_organizationId_sourceSystem_nativeCode_key" ON "PosProductIdentity"("organizationId", "sourceSystem", "nativeCode");

-- AddForeignKey
ALTER TABLE "PosProductIdentity" ADD CONSTRAINT "PosProductIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosProductIdentity" ADD CONSTRAINT "PosProductIdentity_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

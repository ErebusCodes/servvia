-- CreateEnum
CREATE TYPE "MediaAssetPurpose" AS ENUM ('menu_item', 'category', 'promotion', 'venue_gallery', 'branding', 'video', 'document');

-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('gcs', 'local');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('pending_upload', 'uploaded', 'validating', 'approved', 'rejected', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "MediaAssetVisibility" AS ENUM ('private', 'public');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "purpose" "MediaAssetPurpose" NOT NULL,
    "mediaType" "MediaAssetType" NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'gcs',
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "altText" TEXT,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'pending_upload',
    "visibility" "MediaAssetVisibility" NOT NULL DEFAULT 'private',
    "cacheVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_venueId_checksum_idx" ON "MediaAsset"("venueId", "checksum");

-- CreateIndex
CREATE INDEX "MediaAsset_venueId_purpose_status_idx" ON "MediaAsset"("venueId", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_bucket_objectKey_key" ON "MediaAsset"("bucket", "objectKey");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

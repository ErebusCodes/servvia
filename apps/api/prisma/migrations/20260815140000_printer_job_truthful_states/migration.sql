-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrintJobStatus" ADD VALUE 'accepted';
ALTER TYPE "PrintJobStatus" ADD VALUE 'dispatching';
ALTER TYPE "PrintJobStatus" ADD VALUE 'delivered';
ALTER TYPE "PrintJobStatus" ADD VALUE 'manual';
ALTER TYPE "PrintJobStatus" ADD VALUE 'uncertain';

-- AlterEnum
ALTER TYPE "PrinterConnectionType" ADD VALUE 'simulated';

-- AlterTable
ALTER TABLE "PrinterJob" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "reprintOfId" TEXT,
ADD COLUMN     "reprintRequestedById" TEXT;

-- AddForeignKey
ALTER TABLE "PrinterJob" ADD CONSTRAINT "PrinterJob_reprintOfId_fkey" FOREIGN KEY ("reprintOfId") REFERENCES "PrinterJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterJob" ADD CONSTRAINT "PrinterJob_reprintRequestedById_fkey" FOREIGN KEY ("reprintRequestedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


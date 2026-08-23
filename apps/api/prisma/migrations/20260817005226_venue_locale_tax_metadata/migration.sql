-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-NZ',
ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxJurisdiction" TEXT NOT NULL DEFAULT 'NZ_GST';

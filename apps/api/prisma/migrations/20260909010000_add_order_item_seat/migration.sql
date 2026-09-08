-- Add optional per-seat assignment to order lines for the Order Tablet
-- dine-in flow. Backward compatible: the column is nullable with no default,
-- so every existing row stays NULL ("no seat"), and no data migration or table
-- rewrite of existing values is required.
-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "seat" INTEGER;

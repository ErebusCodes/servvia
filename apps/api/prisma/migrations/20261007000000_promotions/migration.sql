-- Phase D11: canonical promotions (ADR 0001, docs/migration/d11-promotions.md).
--
-- ADDITIVE, with one CHECK replaced by its generalisation. No table, column or
-- row is dropped, renamed or rewritten, and no data is migrated: no promotion
-- is fabricated, and every existing order, line and check keeps discount 0.
--
--   * Promotion: a configured percentage offer at one venue (never
--     organization-wide by omission). Typed targets, optional UTC window,
--     version CAS, idempotent create, never deleted.
--   * AppliedPromotion: the frozen financial effect of one promotion on one
--     round (at most one per round). Composite keys: the promotion is of the
--     order's venue, the round is of the order.
--   * Order/OrderItem/Check/CheckLine.discountCents (default 0) and
--     OrderItem.appliedPromotionId. totalCents = subtotalCents - discountCents.
--   * "Check_total_is_gross" (D5: totalCents = subtotalCents) is replaced by
--     "Check_total_is_discounted_gross" (totalCents = subtotalCents -
--     discountCents). With discountCents = 0 on every existing row the two are
--     the same rule for them.
--
-- Locks: new tables; columns with constant defaults (metadata only). The new
-- UNIQUE index Order(id, venueId) is built under a SHARE lock on "Order"
-- (writes wait for the build; id is the primary key, so it cannot fail). The
-- CHECKs on "Order", "OrderItem", "Check" and "CheckLine" scan those tables
-- under ACCESS EXCLUSIVE; every existing row has discountCents 0 and passes.
--
-- Rollback (development/test databases only; production needs its own
-- approval): restore "Check_total_is_gross", then drop the new constraints,
-- columns, tables and the three enums.

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('percentage');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('inactive', 'active');

-- CreateEnum
CREATE TYPE "PromotionTarget" AS ENUM ('all_items', 'categories', 'menu_items');

-- AlterTable
ALTER TABLE "Check" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CheckLine" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "appliedPromotionId" TEXT,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "target" "PromotionTarget" NOT NULL,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "menuItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PromotionStatus" NOT NULL DEFAULT 'inactive',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createRequestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdByStaffId" TEXT NOT NULL,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedPromotion" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "promotionVersion" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "target" "PromotionTarget" NOT NULL,
    "currency" TEXT NOT NULL,
    "eligibleSubtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_venueId_status_idx" ON "Promotion"("venueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_venueId_createRequestKey_key" ON "Promotion"("venueId", "createRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_id_venueId_key" ON "Promotion"("id", "venueId");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedPromotion_roundId_key" ON "AppliedPromotion"("roundId");

-- CreateIndex
CREATE INDEX "AppliedPromotion_orderId_idx" ON "AppliedPromotion"("orderId");

-- CreateIndex
CREATE INDEX "AppliedPromotion_promotionId_idx" ON "AppliedPromotion"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedPromotion_id_orderId_key" ON "AppliedPromotion"("id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_venueId_key" ON "Order"("id", "venueId");

-- CreateIndex
CREATE INDEX "OrderItem_appliedPromotionId_idx" ON "OrderItem"("appliedPromotionId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_appliedPromotionId_orderId_fkey" FOREIGN KEY ("appliedPromotionId", "orderId") REFERENCES "AppliedPromotion"("id", "orderId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_orderId_venueId_fkey" FOREIGN KEY ("orderId", "venueId") REFERENCES "Order"("id", "venueId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_roundId_orderId_fkey" FOREIGN KEY ("roundId", "orderId") REFERENCES "OrderRound"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_promotionId_venueId_fkey" FOREIGN KEY ("promotionId", "venueId") REFERENCES "Promotion"("id", "venueId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

-- Promotion configuration.
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_name_length"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_basis_points_range"
  CHECK ("basisPoints" BETWEEN 1 AND 10000);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_create_request_key_length"
  CHECK (char_length("createRequestKey") BETWEEN 16 AND 255);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_request_fingerprint_format"
  CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$');

-- A window, when bounded on both sides, is not empty: [startsAt, endsAt).
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_window_order"
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt");

-- The target lists are never NULL, and exactly the one the target names is
-- non-empty; an all_items promotion lists nothing. At most 200 ids each.
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_target_lists"
  CHECK ("categoryIds" IS NOT NULL AND "menuItemIds" IS NOT NULL
     AND ("target" = 'categories') = (cardinality("categoryIds") > 0)
     AND ("target" = 'menu_items') = (cardinality("menuItemIds") > 0)
     AND cardinality("categoryIds") <= 200 AND cardinality("menuItemIds") <= 200);

-- The applied snapshot: a real discount of an eligible subtotal.
ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_amounts"
  CHECK ("eligibleSubtotalCents" > 0 AND "discountCents" BETWEEN 0 AND "eligibleSubtotalCents");

ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_basis_points_range"
  CHECK ("basisPoints" BETWEEN 1 AND 10000);

ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_version_positive"
  CHECK ("promotionVersion" >= 1);

ALTER TABLE "AppliedPromotion" ADD CONSTRAINT "AppliedPromotion_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- A line's discount never exceeds the line, and only a line of an applied
-- promotion has one. (Nest rows keep 0; a Nest line may have a negative
-- total from a negative modifier, which 0 still satisfies.)
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_discount_bounds"
  CHECK ("discountCents" = 0 OR ("discountCents" > 0 AND "discountCents" <= "lineTotalCents" AND "appliedPromotionId" IS NOT NULL));

ALTER TABLE "Order" ADD CONSTRAINT "Order_discount_bounds"
  CHECK ("discountCents" = 0 OR ("discountCents" > 0 AND "discountCents" <= "subtotalCents"));

ALTER TABLE "CheckLine" ADD CONSTRAINT "CheckLine_discount_bounds"
  CHECK ("discountCents" = 0 OR ("discountCents" > 0 AND "discountCents" <= "lineTotalCents"));

ALTER TABLE "Check" ADD CONSTRAINT "Check_discount_bounds"
  CHECK ("discountCents" = 0 OR ("discountCents" > 0 AND "discountCents" <= "subtotalCents"));

-- D5's rule generalised: what is owed is the gross less the discount, and the
-- GST (taxCents) is contained in that. Identical for every existing row.
ALTER TABLE "Check" DROP CONSTRAINT "Check_total_is_gross";

ALTER TABLE "Check" ADD CONSTRAINT "Check_total_is_discounted_gross"
  CHECK ("totalCents" = "subtotalCents" - "discountCents");

-- Story 6-1: order idempotency key + uniquely-linked payment reference.
--
-- Hand-authored (no live Postgres instance was reachable in the
-- implementation environment to run `prisma migrate dev`), written to match
-- the DDL Prisma generates for the equivalent schema.prisma change. Run
-- `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <url>`
-- against a real Postgres before merge to confirm this file matches what
-- Prisma would generate, per this story's Definition of Done.

-- AddColumn (nullable first so existing rows can be backfilled before the
-- NOT NULL constraint is applied)
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentProviderTransactionId" TEXT;

-- Backfill: every pre-existing Order row gets a synthetic, guaranteed-unique
-- idempotency key derived from its own primary key (Story 6-1 AC7). No
-- historical row previously had a client-supplied key, so this is the only
-- value that can be assigned without inventing a false replay relationship
-- between unrelated historical orders.
UPDATE "Order" SET "idempotencyKey" = 'legacy-' || "id" WHERE "idempotencyKey" IS NULL;

-- paymentProviderTransactionId is intentionally left NULL for historical
-- rows: the prior implementation validated but never persisted a payment
-- reference, so there is no historical value to backfill, and NULL is a
-- valid, unconstrained value under the unique index below (Postgres unique
-- indexes permit unlimited NULLs).

-- Enforce NOT NULL now that every row has a value.
ALTER TABLE "Order" ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_venueId_idempotencyKey_key" ON "Order"("venueId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentProviderTransactionId_key" ON "Order"("paymentProviderTransactionId");

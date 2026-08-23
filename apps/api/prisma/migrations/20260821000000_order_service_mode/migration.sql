-- Story 15-13: explicit, authoritative dine-in/takeaway service mode.
--
-- Purely additive: one new enum, two new nullable/defaulted columns on the
-- existing "Order" table, one new unique index, and one new sequence used
-- only to mint takeawayReference values (never a "latest row + 1" read).
-- No existing table, column, enum value, or constraint is altered or
-- dropped.
--
-- Backfill policy: every pre-existing "Order" row predates the takeaway
-- capability entirely -- no code path in this repository has ever created
-- an order with any concept other than dine-in (the public kiosk path's
-- own optional table is untouched and out of this story's scope; its rows
-- are also correctly backfilled to dine_in for continuity, since no
-- alternative service-mode concept existed for them either). The
-- column-level DEFAULT below performs the entire backfill in one
-- constant-time DDL operation -- no separate UPDATE statement, no risk of
-- a long-running table rewrite under load, no ambiguous rows requiring a
-- legacy/unknown classification.

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('dine_in', 'takeaway');

-- AlterTable
ALTER TABLE "Order"
  ADD COLUMN "serviceMode" "ServiceMode" NOT NULL DEFAULT 'dine_in',
  ADD COLUMN "takeawayReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_takeawayReference_key" ON "Order"("takeawayReference");

-- Dedicated sequence for takeaway reference numbers. A Postgres sequence's
-- nextval() is inherently concurrency-safe (no read-then-increment race,
-- unlike the pre-existing ORD-6xxxxx order-id numbering scheme -- see
-- deferred-work.md's "Order-ID generation... races under concurrent load"
-- entry, not replicated here). nextval() is NOT transactional: a call
-- inside a transaction that later rolls back leaves a permanent gap in the
-- sequence rather than reusing the number -- an accepted, standard
-- trade-off (gaps are invisible/harmless; reuse would risk two different
-- orders sharing one customer-facing reference, which is not).
CREATE SEQUENCE "TakeawayReference_seq" START WITH 1 INCREMENT BY 1;

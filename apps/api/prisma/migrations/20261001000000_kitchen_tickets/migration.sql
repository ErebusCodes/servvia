-- Phase D4: kitchen tickets (ADR 0001, docs/migration/d4-kitchen-tickets.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated. No tickets are fabricated for history: tickets are
-- projected only from `order.round_submitted` outbox events, which only
-- Servvia Core writes.
--
--   * KitchenTicket / KitchenTicketLine: what the kitchen must prepare, one
--     ticket per round per server-routed station, one line per order line.
--     Kitchen progress is KitchenTicket.status; Order.status is not touched.
--   * KitchenTicketTransition: every ticket status change with its actor.
--   * OutboxEvent gains bounded-retry bookkeeping (attempts, lastError,
--     availableAt, failedAt). Existing rows get attempts 0, availableAt now.
--   * OrderRound gains a unique (id, orderId), the target of the ticket's
--     composite foreign key: a ticket's order is its round's order.
--
-- Idempotency rests on unique indexes, not on reads before writes:
-- (roundId, station) per ticket, orderItemId per line, (ticketId, version)
-- per transition.
--
-- Locks: adding columns with constant defaults to "OutboxEvent" is
-- metadata-only; the new unique index on "OrderRound" is built under a SHARE
-- lock (writes to OrderRound wait; the table is small and written only by
-- Servvia Core, which no client calls yet).
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop the three new tables, the enum, the OrderRound index and
-- the four OutboxEvent columns.

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('new', 'acknowledged', 'preparing', 'ready', 'completed', 'recalled');

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'new',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceEventId" TEXT NOT NULL,
    "roundSequence" INTEGER NOT NULL,
    "tableNumber" TEXT,
    "takeawayReference" TEXT,
    "orderSource" "OrderSource" NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "recalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicketLine" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "seat" INTEGER,

    CONSTRAINT "KitchenTicketLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicketTransition" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" "KitchenTicketStatus" NOT NULL,
    "toStatus" "KitchenTicketStatus" NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorRole" "StaffRole" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenTicketTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KitchenTicket_venueId_station_status_idx" ON "KitchenTicket"("venueId", "station", "status");

-- CreateIndex
CREATE INDEX "KitchenTicket_orderId_idx" ON "KitchenTicket"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_roundId_station_key" ON "KitchenTicket"("roundId", "station");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicketLine_orderItemId_key" ON "KitchenTicketLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicketLine_ticketId_position_key" ON "KitchenTicketLine"("ticketId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicketTransition_ticketId_version_key" ON "KitchenTicketTransition"("ticketId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRound_id_orderId_key" ON "OrderRound"("id", "orderId");

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_roundId_orderId_fkey" FOREIGN KEY ("roundId", "orderId") REFERENCES "OrderRound"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitchenTicketTransition" ADD CONSTRAINT "KitchenTicketTransition_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_round_sequence_positive"
  CHECK ("roundSequence" >= 1);

ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_station_format"
  CHECK ("station" ~ '^[a-z0-9_-]{1,40}$');

-- A stage the ticket is in has its timestamp. (A ticket may skip
-- acknowledged, so earlier stamps are not implied.)
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_stage_stamped"
  CHECK (
    ("status" <> 'acknowledged' OR "acknowledgedAt" IS NOT NULL) AND
    ("status" <> 'preparing'    OR "preparingAt"    IS NOT NULL) AND
    ("status" <> 'ready'        OR "readyAt"        IS NOT NULL) AND
    ("status" <> 'completed'    OR "completedAt"    IS NOT NULL) AND
    ("status" <> 'recalled'     OR "recalledAt"     IS NOT NULL)
  );

ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_quantity_positive"
  CHECK ("quantity" >= 1);

ALTER TABLE "KitchenTicketLine" ADD CONSTRAINT "KitchenTicketLine_position_positive"
  CHECK ("position" >= 1);

ALTER TABLE "KitchenTicketTransition" ADD CONSTRAINT "KitchenTicketTransition_version_after_first"
  CHECK ("version" >= 2);

ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_attempts_non_negative"
  CHECK ("attempts" >= 0);

-- The consumer's claim query: unprocessed, unparked events that are due.
CREATE INDEX "OutboxEvent_pending_idx" ON "OutboxEvent" ("eventType", "availableAt")
  WHERE "processedAt" IS NULL AND "failedAt" IS NULL;

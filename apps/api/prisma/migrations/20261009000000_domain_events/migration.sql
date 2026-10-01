-- Phase D13: generic domain events and per-consumer deliveries (ADR 0001,
-- docs/migration/d13-outbox-workers.md).
--
-- ADDITIVE: two new tables and one enum. No existing table, column,
-- constraint or row is touched or dropped. D4's OutboxEvent (with its
-- kitchen-projector progress) and D12's RealtimeEvent stay as they are; the
-- application stops writing them (OutboxEvent keeps being drained for rows
-- written before this migration). No event history is fabricated.
--
--   * DomainEvent: one canonical fact per change, in the change's
--     transaction; the D12 envelope and catalog. No consumer progress.
--   * EventDelivery: one work consumer's progress on one event: status,
--     attempts, backoff (availableAt), lease (leaseOwner, leaseExpiresAt),
--     outcome. Unique per (event, consumer).
--
-- Locks: new tables only.
--
-- Rollback (development/test databases only; production needs its own
-- approval): DROP TABLE "EventDelivery", "DomainEvent"; DROP TYPE
-- "EventDeliveryStatus" -- after re-enabling the D12/D4 writers.

-- CreateEnum
CREATE TYPE "EventDeliveryStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "txId" BIGINT NOT NULL DEFAULT ((pg_current_xact_id())::text)::bigint,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" "EventDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_sequence_key" ON "DomainEvent"("sequence");

-- CreateIndex
CREATE INDEX "DomainEvent_txId_sequence_idx" ON "DomainEvent"("txId", "sequence");

-- CreateIndex
CREATE INDEX "DomainEvent_occurredAt_idx" ON "DomainEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "EventDelivery_consumer_status_availableAt_idx" ON "EventDelivery"("consumer", "status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventDelivery_eventId_consumer_key" ON "EventDelivery"("eventId", "consumer");

-- AddForeignKey
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express.

ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_event_type_format"
  CHECK ("eventType" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$');

ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_aggregate_type_format"
  CHECK ("aggregateType" ~ '^[a-z][a-z_]*$');

ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_ids_present"
  CHECK (char_length("organizationId") > 0 AND char_length("venueId") > 0 AND char_length("aggregateId") > 0);

ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_version_positive"
  CHECK ("aggregateVersion" IS NULL OR "aggregateVersion" >= 1);

-- A payload is a small JSON object, never an arbitrary row dump.
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_payload_bounded"
  CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8192);

ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_consumer_format"
  CHECK ("consumer" ~ '^[a-z][a-z_]{0,62}$');

ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_attempts_nonnegative"
  CHECK ("attempts" >= 0);

-- A lease is a pair, and only a pending delivery holds one.
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_lease_pair"
  CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL)
     AND ("leaseOwner" IS NULL OR "status" = 'pending'));

-- The outcome timestamps match the status exactly.
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_outcome_fields"
  CHECK ((("status" = 'succeeded') = ("succeededAt" IS NOT NULL))
     AND (("status" = 'failed') = ("failedAt" IS NOT NULL)));

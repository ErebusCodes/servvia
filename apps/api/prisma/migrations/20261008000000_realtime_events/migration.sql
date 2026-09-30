-- Phase D12: canonical realtime delivery log (ADR 0001,
-- docs/migration/d12-realtime.md).
--
-- ADDITIVE: one new table. No existing table, column, constraint or row is
-- touched; D4's OutboxEvent (and its kitchen-projector progress columns) is
-- unchanged.
--
--   * RealtimeEvent: a canonical fact, written in the same transaction as
--     the change it announces, tailed by every Servvia Core instance with an
--     in-memory (txId, sequence) cursor bounded by the snapshot xmin. Not a
--     queue: no row is ever marked consumed. Pruned after its retention.
--
-- Locks: a new table only.
--
-- Rollback (development/test databases only; production needs its own
-- approval): DROP TABLE "RealtimeEvent". Nothing references it.

-- CreateTable
CREATE TABLE "RealtimeEvent" (
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

    CONSTRAINT "RealtimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RealtimeEvent_sequence_key" ON "RealtimeEvent"("sequence");

-- CreateIndex
CREATE INDEX "RealtimeEvent_txId_sequence_idx" ON "RealtimeEvent"("txId", "sequence");

-- CreateIndex
CREATE INDEX "RealtimeEvent_occurredAt_idx" ON "RealtimeEvent"("occurredAt");



-- Hand-authored below: invariants schema.prisma cannot express.

-- The envelope's identifiers and names are bounded and non-empty.
ALTER TABLE "RealtimeEvent" ADD CONSTRAINT "RealtimeEvent_event_type_format"
  CHECK ("eventType" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$');

ALTER TABLE "RealtimeEvent" ADD CONSTRAINT "RealtimeEvent_aggregate_type_format"
  CHECK ("aggregateType" ~ '^[a-z][a-z_]*$');

ALTER TABLE "RealtimeEvent" ADD CONSTRAINT "RealtimeEvent_ids_present"
  CHECK (char_length("organizationId") > 0 AND char_length("venueId") > 0 AND char_length("aggregateId") > 0);

ALTER TABLE "RealtimeEvent" ADD CONSTRAINT "RealtimeEvent_version_positive"
  CHECK ("aggregateVersion" IS NULL OR "aggregateVersion" >= 1);

-- A payload is a small JSON object, never an arbitrary row dump.
ALTER TABLE "RealtimeEvent" ADD CONSTRAINT "RealtimeEvent_payload_bounded"
  CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8192);

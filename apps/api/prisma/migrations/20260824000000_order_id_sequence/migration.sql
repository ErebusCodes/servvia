-- Order-ID generation race fix.
--
-- persistOrder previously minted ORD-6XXXXX ids via a plain
-- `findFirst(orderBy: createdAt desc)` + parse-and-increment read inside
-- the creation transaction -- a genuine, previously-known, never-fixed
-- race under concurrent load (see deferred-work.md's own
-- "Order-ID generation... races under concurrent load" entry, and the
-- identical pattern already fixed for takeawayReference via
-- TakeawayReference_seq in migration 20260821000000_order_service_mode).
-- Two concurrent transactions can both read the same "last order" row
-- before either commits its own insert, and both then attempt to create
-- the same next id -- one loses to a unique-constraint violation it was
-- never designed to expect from this particular column, rather than the
-- intended, already-handled idempotencyKey/payment-reference P2002 paths.
--
-- Fixed the same way as TakeawayReference_seq: a dedicated Postgres
-- sequence, nextval() is inherently concurrency-safe (each call is atomic
-- at the database level, no read-then-write window exists), and it is
-- called OUTSIDE the creation transaction in application code for the
-- identical reason TakeawayReference_seq's own migration/code comments
-- already document -- no atomicity benefit from being inside it (a
-- rolled-back transaction leaves a harmless permanent gap, never a
-- reused/duplicate number), and calling it inside the transaction would
-- only add a round-trip inside the lock window.
CREATE SEQUENCE IF NOT EXISTS "Order_ORD6_seq" START WITH 600001 INCREMENT BY 1;

-- Safe against a database that already has ORD-6XXXXX rows (applying this
-- migration to an existing, populated database, not just a from-zero one):
-- advance the sequence past the highest existing numeric suffix so a fresh
-- sequence starting at 600001 can never collide with a legacy
-- findFirst-generated id already present in the table.
DO $$
DECLARE
  max_existing BIGINT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 5) AS BIGINT)), 600000)
    INTO max_existing
    FROM "Order"
    WHERE id ~ '^ORD-6[0-9]+$';
  IF max_existing >= 600001 THEN
    PERFORM setval('"Order_ORD6_seq"', max_existing, true);
  END IF;
END $$;

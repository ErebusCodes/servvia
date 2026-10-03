-- Story 12.15: truthful audit attribution for staff, device and system actors.
--
-- Until now every AuditLog row needed a Staff actor (actorId NOT NULL, FK to
-- Staff), so a device action either failed on AuditLog_actorId_fkey (the KDS
-- venue-PIN token, actor "kds-device:<venueId>") or was attributed to a
-- synthetic, non-loginable Staff row. Actor identity, device identity and
-- provenance become separate columns. Existing rows are staff rows and keep
-- their values; the Staff foreign key is unchanged.

CREATE TYPE "AuditActorType" AS ENUM ('staff', 'device', 'system');

ALTER TABLE "AuditLog"
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'staff',
  ADD COLUMN "deviceKind" TEXT,
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "systemActor" TEXT,
  ALTER COLUMN "actorId" DROP NOT NULL,
  ALTER COLUMN "actorEmail" DROP NOT NULL,
  ALTER COLUMN "actorRole" DROP NOT NULL;

-- Each actor type has exactly its own identity: a staff row names a staff
-- member (and may name the device they acted through); a device row names
-- the device kind and never a staff member; a system row names the process
-- and nothing else.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_shape_check" CHECK (
  ("actorType" = 'staff'
     AND "actorId" IS NOT NULL AND "actorEmail" IS NOT NULL AND "actorRole" IS NOT NULL
     AND "systemActor" IS NULL)
  OR ("actorType" = 'device'
     AND "actorId" IS NULL AND "actorEmail" IS NULL
     AND "deviceKind" IS NOT NULL AND "systemActor" IS NULL)
  OR ("actorType" = 'system'
     AND "actorId" IS NULL AND "actorEmail" IS NULL AND "actorRole" IS NULL
     AND "deviceKind" IS NULL AND "deviceId" IS NULL AND "systemActor" IS NOT NULL)
);

-- The venue of an audit row is part of its history: deleting a venue may no
-- longer null it (ON DELETE SET NULL rewrote immutable rows). RESTRICT, as
-- every other foreign key to "Venue" already is.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_venueId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_venueId_fkey" FOREIGN KEY ("venueId")
  REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit rows are immutable: no code path updates them, and none may.
-- (Deletion is left to retention, which is a separate decision.)
CREATE FUNCTION "AuditLog_reject_update"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "AuditLog_immutable"
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "AuditLog_reject_update"();

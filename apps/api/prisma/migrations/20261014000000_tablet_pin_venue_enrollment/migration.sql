-- Story 8.3: a staff member's tablet PIN elevates a tablet only in venues
-- where that PIN was checked unique among the venue's PIN holders. PINs are
-- salted Argon2id hashes, so uniqueness can be checked only while the plain
-- PIN is known (when it is set), never when a venue is granted later: a new
-- grant therefore starts unenrolled, and setting the PIN again enrols it.
--
-- Existing grants of staff who hold a PIN keep working (enrolled at their
-- PIN's time); a duplicate among them, if any, still elevates nobody (the
-- ambiguity backstop in TabletAuthService).

ALTER TABLE "VenueAccess" ADD COLUMN "pinEnrolledAt" TIMESTAMP(3);

UPDATE "VenueAccess" AS va
SET "pinEnrolledAt" = COALESCE(s."pinSetAt", CURRENT_TIMESTAMP)
FROM "Staff" AS s
WHERE va."staffId" = s.id
  AND s."pinHash" IS NOT NULL
  AND s."deletedAt" IS NULL;

-- Story 2.8: staff login sessions in the canonical database.
--
-- Story 2.5 revoked a logged-out session with a Redis key. Redis is a cache:
-- after a Redis data loss a revoked session would have become valid again for
-- the rest of its life. The session row is now the source of truth, read by
-- Nest and Go Core on every use of a staff-session token.

CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffSession_staffId_idx" ON "StaffSession"("staffId");

CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Story 8.1: single-use credential setup codes. An owner or admin who
-- creates a staff account or resets its credential receives a code; the
-- staff member sets their own password with it. Only a hash is stored.

CREATE TABLE "StaffCredentialToken" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCredentialToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffCredentialToken_staffId_idx" ON "StaffCredentialToken"("staffId");

ALTER TABLE "StaffCredentialToken" ADD CONSTRAINT "StaffCredentialToken_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffCredentialToken" ADD CONSTRAINT "StaffCredentialToken_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

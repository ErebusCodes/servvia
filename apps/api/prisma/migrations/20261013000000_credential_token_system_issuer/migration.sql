-- Story 2.4: a credential setup code may be issued by the operator bootstrap
-- command (no staff member is signed in to issue it), so the issuer is either
-- a staff member or a named system process, never both and never neither.
-- Existing rows were all issued by staff and keep their issuer.

ALTER TABLE "StaffCredentialToken"
  ALTER COLUMN "issuedById" DROP NOT NULL,
  ADD COLUMN "issuedBySystem" TEXT;

ALTER TABLE "StaffCredentialToken" ADD CONSTRAINT "StaffCredentialToken_issuer_check" CHECK (
  ("issuedById" IS NOT NULL AND "issuedBySystem" IS NULL)
  OR ("issuedById" IS NULL AND "issuedBySystem" IS NOT NULL)
);

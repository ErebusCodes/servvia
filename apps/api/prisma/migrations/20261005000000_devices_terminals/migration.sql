-- Phase D8: canonical devices and terminals (ADR 0001,
-- docs/migration/d8-devices-terminals.md).
--
-- ADDITIVE. No column, table or row is dropped, renamed or rewritten, and no
-- data is migrated: no devices or terminals are fabricated, TabletDevice,
-- TabletEnrollment and the connector tables are untouched, and every
-- existing shift keeps terminalId NULL.
--
--   * Device: the permanent registry of enrolled installations. Credential
--     verifier only (sha256 of a 256-bit random secret); never plaintext.
--   * Terminal: a logical POS station; many per venue; code unique per
--     venue; optionally bound to one pos_terminal device of the same venue,
--     a device to at most one terminal.
--   * Shift.terminalId: optional, same venue (composite foreign key).
--
-- Locks: "Shift" gains a nullable column (metadata only) and a foreign key
-- (every existing row is NULL and passes). Everything else is new tables.
--
-- Rollback (development/test databases only; production needs its own
-- approval): drop the Shift foreign key and column, then "Terminal",
-- "Device" and the three enums.

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('pos_terminal', 'order_tablet', 'kds', 'payment_adapter');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "TerminalStatus" AS ENUM ('active', 'disabled');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "terminalId" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "credentialHash" TEXT NOT NULL,
    "credentialRotatedAt" TIMESTAMP(3),
    "enrollRequestKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByStaffId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TerminalStatus" NOT NULL DEFAULT 'active',
    "deviceId" TEXT,
    "deviceKind" "DeviceKind",
    "createRequestKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_credentialHash_key" ON "Device"("credentialHash");

-- CreateIndex
CREATE INDEX "Device_venueId_kind_status_idx" ON "Device"("venueId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Device_venueId_enrollRequestKey_key" ON "Device"("venueId", "enrollRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Device_id_kind_venueId_key" ON "Device"("id", "kind", "venueId");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_deviceId_key" ON "Terminal"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_venueId_code_key" ON "Terminal"("venueId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_venueId_createRequestKey_key" ON "Terminal"("venueId", "createRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_id_venueId_key" ON "Terminal"("id", "venueId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_terminalId_venueId_fkey" FOREIGN KEY ("terminalId", "venueId") REFERENCES "Terminal"("id", "venueId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_revokedByStaffId_fkey" FOREIGN KEY ("revokedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_deviceId_deviceKind_venueId_fkey" FOREIGN KEY ("deviceId", "deviceKind", "venueId") REFERENCES "Device"("id", "kind", "venueId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-authored below: invariants schema.prisma cannot express, documented on
-- the models they protect.

ALTER TABLE "Device" ADD CONSTRAINT "Device_display_name_length"
  CHECK (char_length(btrim("displayName")) BETWEEN 1 AND 80);

ALTER TABLE "Device" ADD CONSTRAINT "Device_credential_hash_format"
  CHECK ("credentialHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "Device" ADD CONSTRAINT "Device_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "Device" ADD CONSTRAINT "Device_enroll_request_key_length"
  CHECK (char_length("enrollRequestKey") BETWEEN 16 AND 255);

ALTER TABLE "Device" ADD CONSTRAINT "Device_revoked_fields"
  CHECK ((("status" = 'revoked') = ("revokedAt" IS NOT NULL)) AND
         (("status" = 'revoked') = ("revokedByStaffId" IS NOT NULL)));

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_name_length"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_code_format"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,19}$');

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_create_request_key_length"
  CHECK (char_length("createRequestKey") BETWEEN 16 AND 255);

ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_disabled_fields"
  CHECK (("status" = 'disabled') = ("disabledAt" IS NOT NULL));

-- A bound device is a POS device. deviceId and deviceKind are set together:
-- the composite foreign key (MATCH SIMPLE) is only checked when both are.
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_device_is_pos"
  CHECK ((("deviceId" IS NULL) = ("deviceKind" IS NULL)) AND
         ("deviceKind" IS NULL OR "deviceKind" = 'pos_terminal'));

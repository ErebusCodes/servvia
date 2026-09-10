-- Route exclusivity: one order, one POS submission pipeline, decided once.
--
-- PURELY ADDITIVE AND BACKWARD COMPATIBLE. One new enum, one new enum VALUE on
-- an existing type, one new column with a default. Nothing is altered, dropped
-- or rewritten, and no data migration is required.
--
-- WHY THE DEFAULT MATTERS MORE THAN THE COLUMN. Every POSSyncRecord that
-- existed before this migration means exactly what it always meant: 'webit'.
-- The Webit dispatcher's candidate query gains `strategy = 'webit'`, which is
-- true of every pre-existing row, so this migration changes the behaviour of
-- precisely zero historical orders. Applying it to production while
-- IDEALPOS_POS_STRATEGY stays unset is a no-op on live behaviour.
--
-- WHY A NEW STATUS AS WELL AS A NEW COLUMN. Both dispatcher sweeps
-- (PosSyncDispatcherService.sweep and IdealposOrderDispatcherService
-- .sweepDispatch) select on `status = 'not_synced'`. A native-owned record is
-- created at 'owned_by_native' instead, so it is outside both candidate sets
-- structurally - true even for code that has never heard of the strategy
-- column. The column is the authoritative, askable ownership record; the
-- status is the belt-and-braces that needs no query to have been updated.
--
-- ADDING AN ENUM VALUE IS NOT TRANSACTIONAL ON POSTGRES < 12 and cannot be
-- used in the same transaction that adds it on some versions. It is issued
-- here as its own statement, before anything reads it, and nothing in this
-- migration writes a row using the new value.

-- CreateEnum
CREATE TYPE "PosSubmissionStrategy" AS ENUM ('webit', 'native_table_round');

-- AlterEnum
ALTER TYPE "POSSyncStatus" ADD VALUE 'owned_by_native';

-- AlterTable
ALTER TABLE "POSSyncRecord" ADD COLUMN "strategy" "PosSubmissionStrategy" NOT NULL DEFAULT 'webit';

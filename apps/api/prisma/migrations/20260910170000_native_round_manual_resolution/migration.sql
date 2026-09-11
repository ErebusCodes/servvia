-- Manual resolution of an unresolved native round.
--
-- WHY THIS IS NEEDED AT ALL. `unresolved` occupies the table's single
-- in-flight slot, so no further round may be opened on that table while one
-- exists. Its only exits were the reconciler's `confirmed` / `failed` edges,
-- and both require a bound evidence reader that reads the till's token row.
-- No connector build binds one yet, so in the intended first production
-- configuration every round escalates to `unresolved` after its window and
-- the table is dead for the rest of the service. This migration adds the
-- state a human can move it to.
--
-- BACKWARD COMPATIBLE, and deliberately additive:
--   * the enum gains a value; no existing value is renamed or removed, and
--     no existing row changes, because nothing can already be in a state
--     that did not exist;
--   * the three columns are nullable with no default, so existing rows stay
--     NULL, which reads as "no human was involved" - the truth for every
--     round settled before this route existed.
-- There is no table rewrite and no backfill. Safe to apply ahead of the
-- application deploy that uses it.
--
-- ADDING AN ENUM VALUE IS NOT TRANSACTIONAL ON POSTGRES < 12 and cannot be
-- used in the same transaction that adds it on some versions; Prisma runs
-- each migration file in its own transaction, and on PG 12+ `ADD VALUE` is
-- transactional, so this is safe as written. It is a separate statement from
-- any use of the value for that reason.

-- AlterEnum
ALTER TYPE "NativeRoundState" ADD VALUE 'resolved_manually';

-- AlterTable
ALTER TABLE "NativeTableRound" ADD COLUMN     "resolvedByUserId" TEXT,
ADD COLUMN     "resolvedByActingStaffId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolutionBasis" TEXT;

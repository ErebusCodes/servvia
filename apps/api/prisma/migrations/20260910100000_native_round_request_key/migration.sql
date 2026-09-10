-- The double-tap guard for Send to Kitchen.
--
-- PURELY ADDITIVE. One nullable column and one unique index on a table that
-- does not yet exist in production (NativeTableRound arrives in the still
-- -unapplied 20260909120000_native_table_rounds migration), so this cannot
-- affect any live row.
--
-- WHY A CONSTRAINT AND NOT A READ-THEN-WRITE CHECK. Two taps a few hundred
-- milliseconds apart produce two concurrent requests carrying the same client
-- key. A "does a round with this key already exist?" read would return false
-- in both, and both would open a round - the second carrying a second copy of
-- the same food to a real kitchen. The unique index makes the loser fail at
-- the database, and the handler answers it with the round the winner opened.
--
-- NULLABLE, AND THAT IS DELIBERATE. Postgres does not treat two NULLs as
-- equal, so rounds opened without a client request behind them (tests,
-- operational tooling) never collide with each other.

-- AlterTable
ALTER TABLE "NativeTableRound" ADD COLUMN "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "NativeTableRound_requestKey_key" ON "NativeTableRound"("requestKey");

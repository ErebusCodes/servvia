# Migration Verification — `20260816120000_pos_sync_outbox_dispatch`

Story 9-3. Purely additive: 7 new nullable-or-defaulted columns on `POSSyncRecord`, plus one supporting index. No existing column, index, constraint, or enum value is altered. No data migration/backfill is needed — every existing row simply gets `dispatchAttemptCount = 0` and all other new columns `NULL`, which is the correct "never dispatched yet" state for historical rows too.

## What changed

```sql
ALTER TABLE "POSSyncRecord" ADD COLUMN     "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchClaimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "dispatchClaimId" TEXT,
ADD COLUMN     "dispatchClaimedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchExhaustedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "lastDispatchError" TEXT;

CREATE INDEX "POSSyncRecord_status_dispatchExhaustedAt_createdAt_idx" ON "POSSyncRecord"("status", "dispatchExhaustedAt", "createdAt");
```

## 1. Applied against the shared local dev database (populated)

```
$ npx prisma migrate deploy
Datasource "db": PostgreSQL database "verdura_dev", schema "public" at "127.0.0.1:5434"
7 migrations found in prisma/migrations
Applying migration `20260816120000_pos_sync_outbox_dispatch`
All migrations have been successfully applied.
```

Confirmed additive/no-op for existing data: pre-existing `POSSyncRecord` rows (from stories 6-1/8-1/9-1's own real-Postgres test runs and any historical fabricated-record test fixtures) were not touched — verified via `SELECT COUNT(*) FROM "POSSyncRecord" WHERE "dispatchAttemptCount" != 0 OR "dispatchClaimId" IS NOT NULL` returning `0` immediately after migration, before any dispatcher code ran.

## 2. Clean-from-zero deploy proven on a disposable container

Started a throwaway `postgres:16-alpine` container (`verdura-migration-verify`, port 5499, discarded after verification — not the shared dev database, not the docker-compose-managed `verdura-postgres-1`) and ran all 7 migrations from an empty database:

```
$ DATABASE_URL="postgresql://verdura:verdura_local_dev_only@127.0.0.1:5499/verdura_dev" npx prisma migrate deploy
Applying migration `20260618000000_init`
Applying migration `20260618000001_enable_rls_all_tables`
Applying migration `20260815120000_order_idempotency_and_payment_linkage`
Applying migration `20260815140000_printer_job_truthful_states`
Applying migration `20260815150000_pos_sync_unsupported_status`
Applying migration `20260815150100_pos_sync_correct_fabricated_records`
Applying migration `20260816120000_pos_sync_outbox_dispatch`
All migrations have been successfully applied.
```

Verified via `psql \d "POSSyncRecord"` that all 7 new columns and the new index exist with the expected types/nullability, and that the pre-existing `orderId` unique constraint and both foreign keys are unaffected. Container removed (`docker rm -f verdura-migration-verify`) immediately after — never used for anything beyond this verification, no application code ever pointed at it.

## 3. `npx prisma validate` and `npx prisma generate`

Both pass cleanly against the updated schema; the generated Prisma Client exposes all seven new fields on `POSSyncRecord`.

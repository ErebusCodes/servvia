# Verifying these migrations (Story 9-1)

Covers both `20260815150000_pos_sync_unsupported_status` (schema: adds the
`unsupported` `POSSyncStatus` enum value) and this migration
(`20260815150100_pos_sync_correct_fabricated_records`, data: corrects
historical fabricated rows). Split into two migrations because PostgreSQL
forbids using a value added by `ALTER TYPE ... ADD VALUE` within the same
transaction that added it — confirmed directly against this project's own
Postgres 16 dev instance (`BEGIN; ALTER TYPE ... ADD VALUE 'c'; INSERT ...
'c';` → `ERROR: unsafe use of new value "c"... New enum values must be
committed before they can be used.`) before writing these files, not assumed
from memory.

**Status: EXECUTED against real PostgreSQL 16 (2026-08-15)**, against the
shared local dev database (`verdura-postgres-1`, port 5434), and separately
against a disposable clean container.

## 1. Schema migration matches Prisma's own computed end-state

```
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
-- AlterEnum
ALTER TYPE "POSSyncStatus" ADD VALUE 'unsupported';
```

Generated against the real dev database before writing the migration file —
matches exactly.

## 2. Applied cleanly to the populated shared dev database — EXECUTED

```
npx prisma migrate deploy
Applying migration `20260815150000_pos_sync_unsupported_status`
Applying migration `20260815150100_pos_sync_correct_fabricated_records`
All migrations have been successfully applied.
```

`prisma migrate status` reported `Database schema is up to date!` afterward.

Pre-migration state (verified via direct query before applying): 0
`POSSyncRecord` rows existed in the dev database (the queue that would
create/process them has never been fed — see deferred-work.md), and 0
`Order` rows had `posSyncStatus = 'synced'`. So the data-correction
migration was a genuine, verified no-op in this environment — not "assumed
safe," confirmed via `SELECT count(*) FROM "POSSyncRecord" WHERE
status='synced';` → `0` and the equivalent `Order` query → `0`,
**both run immediately before applying.**

## 3. A bug in the first version of the correction logic was caught before merge, not after

The first version of the data-correction `UPDATE` joined to `Venue` and used
the venue's **current** `posAdapterType` to reclassify a historical
`synced` row. A dedicated real-Postgres integration test
(`test/pos-sync.integration-spec.ts`, "historical fabrication correction")
seeded a fabricated row with `adapterType: 'api'` against the seeded
`auckland` venue (whose *current* `posAdapterType` is `none`) and caught the
resulting inconsistency directly: the row was corrected to `not_applicable`
instead of the truthful `unsupported`. A historical record must be
reclassified according to what was actually configured **at the time the
attempt was made** (the record's own `adapterType` column, which is never
mutated), not the venue's config today, which can change independently.
Fixed by removing the `Venue` join from the primary `POSSyncRecord` update
entirely (keyed on the record's own column) and using a scalar subquery
(not a `LEFT JOIN`, which Postgres rejects when the join condition
references the `UPDATE` target's own alias — confirmed via a real syntax
error, `ERROR: invalid reference to FROM-clause entry for table "o"`,
before landing the working version) for the `Order` mirror, falling back to
the venue's current config only for the edge case of an order whose
`POSSyncRecord` was separately deleted.

Because the originally-applied version was a genuine no-op in this
environment (see §2), fixing it in place (`prisma migrate resolve
--rolled-back`, edit, redeploy) was safe and did not require a new
migration file or touch any pre-existing data.

## 4. New enum value is real and usable — EXECUTED

```sql
SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'POSSyncStatus' ORDER BY enumsortorder;
-- not_synced, synced, failed, not_applicable, unsupported
```

## 5. Data-correction logic proven against representative seeded data — EXECUTED

Since no historical fabricated rows existed in any reachable environment,
the correction logic itself is proven by directly seeding rows shaped
exactly like the removed bug would have produced (bypassing the now-removed
fabrication code path) and running the same SQL the migration executes
(`correctFabricatedPosSyncRecords()`, `prisma/scripts/correct-fabricated-pos-sync-records.ts`
— kept in sync with the migration's SQL) against real Postgres:

- A `none`-adapter venue's fabricated `synced` + `IDEAL-*` row → corrected
  to `not_applicable`, `posOrderId`/`responsePayload`/`syncedAt` cleared.
- A real-adapter-type (`api`) fabricated row → corrected to `unsupported`,
  same evidence cleared, `errorMessage` explains the correction.
- Re-running the correction a second time affects 0 rows (idempotent).
- The `Order.posSyncStatus` mirror is corrected in the same run.

All four proven via `test/pos-sync.integration-spec.ts`'s "historical
fabrication correction (AC5)" describe block, against real Postgres.

## 6. Clean database applies the complete migration chain from zero — EXECUTED

Ran against a disposable container (`verdura-migration-verify-9-1`, port
5557, destroyed afterward):

```
npx prisma migrate deploy
6 migrations found in prisma/migrations
Applying migration `20260618000000_init`
Applying migration `20260618000001_enable_rls_all_tables`
Applying migration `20260815120000_order_idempotency_and_payment_linkage`
Applying migration `20260815140000_printer_job_truthful_states`
Applying migration `20260815150000_pos_sync_unsupported_status`
Applying migration `20260815150100_pos_sync_correct_fabricated_records`
All migrations have been successfully applied.
```

`prisma migrate status` reported `Database schema is up to date!`; the
`pg_enum` query above, re-run against the fresh database, returned the same
5 labels.

## 7. Automated suites — EXECUTED

- `npx jest` (unit, mocked Prisma): 351/351 pass (327 pre-existing + 24 new
  across `pos-sync.processor.spec.ts`, `pos-sync-records.service.spec.ts`,
  and one new case in `orders.service.spec.ts`).
- `npm run test:integration` (real Postgres, local dev container
  `verdura-postgres-1`, port 5434): 74/74 pass across the full suite (menu +
  reservations + orders + printer-jobs + the new `pos-sync.integration-spec.ts`,
  19 tests), reproduced clean across 3+ consecutive full-suite runs and 2+
  standalone runs of the new file (some intermediate runs hit this
  environment's pre-existing per-IP login rate limiter from rapid repeated
  suite invocations within this session — an artifact of manual re-running,
  not a defect; resolved by clearing the local Redis rate-limit keys between
  runs, not a code or test change).
- `tsc --noEmit`, `nest build`, `prisma validate` all clean.
- Focused ESLint on every file this story touched: only the same,
  pre-existing, already-accepted untyped-supertest/BullMQ-mock
  `@typescript-eslint/no-unsafe-*` category remains, matching the
  established convention in `printer-jobs.integration-spec.ts` and
  `orders.integration-spec.ts` (see deferred-work.md's existing "Backend
  lint currently fails" entry).

## 8. Pre-existing, unrelated test-leak encountered and cleaned, not fixed

`test/menu.integration-spec.ts` leaked its own fixture rows into the shared
dev database across repeated runs during this session (the exact,
already-documented bug from deferred-work.md's Story 6-1 entry — reproduced
again here, not introduced by this story). Cleaned from the dev database
(`DELETE FROM "MenuItem" WHERE title LIKE 'Phase%Integration%'`) each time
it was found; not fixed in code, matching this repo's existing precedent for
this specific pre-existing, separately-tracked issue.

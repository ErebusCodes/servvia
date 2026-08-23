# Verifying this migration (Story 8-1)

**Status: EXECUTED against real PostgreSQL 16 (2026-08-15)**, against the
shared local dev database (`verdura-postgres-1`, port 5434) — purely
additive (new enum values, new nullable columns, two new nullable FKs), so
no disposable-container backfill drill was required (contrast Story 6-1's
migration, which added a `NOT NULL` column and needed one).

## 1. Migration matches Prisma's own computed end-state

Generated via `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
against the real dev database (not a hand-guessed diff), so the SQL below is
exactly what Prisma itself computed as the delta.

## 2. Applied cleanly to the populated shared dev database — EXECUTED

```
npx prisma migrate deploy
...
Applying migration `20260815140000_printer_job_truthful_states`
All migrations have been successfully applied.
```

`prisma migrate status` reported `Database schema is up to date!` afterward.
No existing `Printer`/`PrinterJob` rows existed in the dev database at
migration time (the feature has never been exercised end-to-end — see
`docs/printers.md`'s implementation-status banner), so there was no
pre-existing data to backfill or risk losing. Verified via
`SELECT count(*) FROM "PrinterJob";` returning `0` immediately before
applying.

## 3. New enum values are real and usable — EXECUTED

```sql
SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'PrintJobStatus' ORDER BY enumsortorder;
-- queued, printing, accepted, dispatching, delivered, printed, manual, uncertain, failed, cancelled

SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'PrinterConnectionType' ORDER BY enumsortorder;
-- tcp, usb, network, windows_shared, simulated
```

`printing` remains defined (Postgres cannot drop enum values without
recreating the type) but is unused by any code path from this story
onward — see the schema comment on `PrintJobStatus`.

## 4. New columns and foreign keys — EXECUTED

`\d "PrinterJob"` confirms `deliveredAt` (nullable timestamp),
`reprintOfId` (nullable text, FK to `PrinterJob.id`, `ON DELETE SET NULL`),
`reprintRequestedById` (nullable text, FK to `Staff.id`, `ON DELETE SET
NULL`). A real self-referencing insert was exercised directly in
`test/printer-jobs.integration-spec.ts` (the reprint-lineage test), proving
the FK is live, not just declared.

## 5. Clean database applies the complete migration chain from zero — EXECUTED

Ran against a disposable container (`verdura-migration-verify-8-1`, port
5556, destroyed afterward):

```
npx prisma migrate deploy
4 migrations found in prisma/migrations
Applying migration `20260618000000_init`
Applying migration `20260618000001_enable_rls_all_tables`
Applying migration `20260815120000_order_idempotency_and_payment_linkage`
Applying migration `20260815140000_printer_job_truthful_states`
All migrations have been successfully applied.
```

`prisma migrate status` reported `Database schema is up to date!` and both
new enum types carried the expected labels via the same `pg_enum` query
above, run against the fresh database.

## 6. Automated suites — EXECUTED

- `npx jest` (unit, mocked Prisma): 324/324 pass (289 pre-existing + 35 new
  across `print-jobs.processor.spec.ts` and `printer-jobs.service.spec.ts`).
- `npm run test:integration` (real Postgres, local dev container
  `verdura-postgres-1`, port 5434): 52/52 pass across the full suite (menu +
  reservations + orders + the new `printer-jobs.integration-spec.ts`, 16
  tests), reproduced clean across 2+ consecutive full-suite runs and 3+
  consecutive standalone runs of the new file. See the story's Dev Agent
  Record for the two real concurrency/crash-window behaviors this file
  proves against actual database compare-and-swap semantics.

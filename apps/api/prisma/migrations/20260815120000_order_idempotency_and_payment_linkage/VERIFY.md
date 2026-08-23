# Verifying this migration (Story 6-1, AC7)

**Status: EXECUTED against real PostgreSQL 16 (2026-08-15).** This
repository has no migration-testing harness (no prior migration in
`prisma/migrations/` was previously exercised by any automated test), so
this was run manually against a disposable `postgres:16-alpine` container
(`docker run --name verdura-migration-verify`, port 5555, destroyed
afterward — never the shared local dev database). Results below are the
actual executed evidence, not a projection.

## 1. Migration matches Prisma's own computed end-state

`npx prisma migrate diff --from-schema-datamodel <pre-change-schema> --to-schema-datamodel prisma/schema.prisma --script`
(schema-to-schema, no live DB needed) was run during implementation and
produced DDL structurally identical to this migration, modulo the
NULL-then-backfill-then-NOT-NULL split this file adds for safety.

`npx prisma migrate deploy` was additionally run twice against real
Postgres — once on a database with the first two migrations already applied
(the shared local dev DB, purely additive), and once from a fully empty
database applying all three migrations in sequence (see §3) — both
succeeded with `All migrations have been successfully applied.` and
`prisma migrate status` reported `Database schema is up to date!` afterward.
This supersedes the originally-planned `migrate diff --shadow-database-url`
step with a stronger check (actual application, not a diff).

## 2. Backfill against a representative pre-existing dataset — EXECUTED

Steps actually run, on the disposable container:

1. Applied `20260618000000_init` and `20260618000001_enable_rls_all_tables`
   directly (`psql -f migration.sql` for each) — confirmed via `\d "Order"`
   that no `idempotencyKey`/`paymentProviderTransactionId` columns existed
   yet at this point.
2. Inserted 4 representative legacy rows directly via SQL, exactly as
   pre-Story-6-1 code would have left them (no idempotency/payment columns):
   `ORD-LEGACY-KIOSK-1`, `ORD-LEGACY-KIOSK-2` (source=kiosk, completed),
   `ORD-LEGACY-STAFF-1` (source=staff, completed), `ORD-LEGACY-CANCELLED-1`
   (source=kiosk, cancelled) — covering both order sources and a non-happy
   final status.
3. Applied this migration (`psql -f migration.sql`): `UPDATE 4` — every
   existing row was backfilled in one pass.
4. Verified:
   - All 4 rows received a unique, non-null `idempotencyKey` in the format
     `legacy-<id>` (`legacy-ORD-LEGACY-KIOSK-1`, etc.). `count(*) = 4`,
     `count(DISTINCT idempotencyKey) = 4`, `count(*) FILTER (WHERE
     idempotencyKey IS NULL) = 0`.
   - `information_schema.columns`: `idempotencyKey` is `is_nullable = NO`;
     `paymentProviderTransactionId` remains `is_nullable = YES`.
   - `pg_indexes`: both `Order_venueId_idempotencyKey_key` and
     `Order_paymentProviderTransactionId_key` exist as unique indexes.
   - **No data loss**: `source`, `status`, `subtotalCents`, `taxCents`,
     `totalCents` on all 4 rows compared byte-for-byte before/after — all
     four unchanged.
   - **NOT NULL is genuinely enforced**: attempting to insert a new order
     with no `idempotencyKey` failed with `ERROR: null value in column
     "idempotencyKey" of relation "Order" violates not-null constraint`.
   - Constraint-name matching against real Postgres (separately, on the
     shared local dev DB — see the story's Dev Agent Record): a real
     duplicate-key violation on `(venueId, idempotencyKey)` reports
     constraint name `Order_venueId_idempotencyKey_key`, and on
     `paymentProviderTransactionId` reports
     `Order_paymentProviderTransactionId_key` — both exactly matching
     `OrdersService`'s hardcoded constants.

## 3. Clean database applies the complete migration chain from zero — EXECUTED

Dropped and recreated `verdura_migration_verify`, then ran
`npx prisma migrate deploy` from empty:

```
3 migrations found in prisma/migrations
Applying migration `20260618000000_init`
Applying migration `20260618000001_enable_rls_all_tables`
Applying migration `20260815120000_order_idempotency_and_payment_linkage`
All migrations have been successfully applied.
```

`prisma migrate status` then reported `Database schema is up to date!`, and
both unique indexes were present via `pg_indexes`. Disposable container
destroyed afterward (`docker rm -f verdura-migration-verify`); no volume
leaked.

## 4. Automated suites — EXECUTED

- `npx jest` (unit, mocked Prisma): 289/289 pass.
- `npm run test:integration` (real Postgres, local dev container
  `verdura-postgres-1`, port 5434): 36/36 pass across the full suite
  (menu + reservations + orders, including all 9 Story 6-1 integration
  tests), reproduced clean across multiple consecutive runs. See the
  story's Dev Agent Record for the two real concurrency bugs this run
  found and fixed, and for the pre-existing, out-of-scope test-hygiene gap
  found in `menu.integration-spec.ts` (leaks `Phase 2 Integration Test
  Item` rows even on success — logged to `deferred-work.md`, not fixed).

All steps in this document have now been executed at least once against
real PostgreSQL. Re-run before any future schema change touching `Order`.

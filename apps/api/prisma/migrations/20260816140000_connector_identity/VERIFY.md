# Migration Verification — `20260816140000_connector_identity`

Story 2-9. Purely additive: two new tables (`ConnectorEnrollment`, `ConnectorInstallation`), one new enum (`ConnectorInstallationStatus`), and new back-relation fields on `Organization`, `Venue`, and `Staff`. No existing table, column, enum value, or constraint is altered.

## What changed

- `ConnectorEnrollment` — short-lived, single-use bootstrap credential (hashed, never stored in plaintext).
- `ConnectorInstallation` — durable connector identity (secret hashed, never stored/returned in plaintext after issuance).
- `ConnectorInstallationStatus` enum (`active`/`revoked`/`replaced`).
- A hand-authored **partial unique index** (`ConnectorInstallation_one_active_per_venue`, `ON ("venueId") WHERE status = 'active'`) — the database-enforced "at most one active production connector identity per venue" invariant. Not expressible in `schema.prisma`'s declarative syntax; added directly in `migration.sql`, consistent with this repository's existing precedent for constraints Prisma's schema DSL can't express (e.g. the RLS-enable migration).
- A defensive `CHECK` constraint requiring `revokedAt` whenever `status = 'revoked'`.

## 1. Applied against the shared local dev database (populated)

```
$ npx prisma migrate deploy
Datasource "db": PostgreSQL database "verdura_dev", schema "public" at "127.0.0.1:5434"
8 migrations found in prisma/migrations
Applying migration `20260816140000_connector_identity`
All migrations have been successfully applied.
```

No existing row in any table was touched — both new tables start empty; there is no legacy connector data to backfill.

## 2. Clean-from-zero deploy proven on a disposable container

Started a throwaway `postgres:16-alpine` container (`verdura-migration-verify-2`, port 5499, discarded immediately after — not the shared dev database, not `verdura-postgres-1`) and ran all 8 migrations from empty:

```
$ DATABASE_URL="postgresql://verdura:verdura_local_dev_only@127.0.0.1:5499/verdura_dev" npx prisma migrate deploy
Applying migration `20260618000000_init`
... (all 7 prior migrations) ...
Applying migration `20260816140000_connector_identity`
All migrations have been successfully applied.
```

Verified via `psql \d "ConnectorInstallation"` that:
- The partial unique index exists exactly as intended: `"ConnectorInstallation_one_active_per_venue" UNIQUE, btree ("venueId") WHERE status = 'active'::"ConnectorInstallationStatus"`.
- The `CHECK` constraint exists: `"ConnectorInstallation_revoked_has_revokedAt" CHECK (status <> 'revoked'::"ConnectorInstallationStatus" OR "revokedAt" IS NOT NULL)`.
- All foreign keys (to `Organization`, `Venue`, `Staff`, `ConnectorEnrollment`, and the self-referential `replacedByInstallationId`) are present with the expected `ON DELETE` semantics.

Container removed (`docker rm -f verdura-migration-verify-2`) immediately after — never used for anything beyond this verification.

## 3. `npx prisma validate` and `npx prisma generate`

Both pass cleanly; the generated Prisma Client exposes `ConnectorEnrollment`, `ConnectorInstallation`, and `ConnectorInstallationStatus`.

## Concurrency proof (real-Postgres, application-level)

The partial unique index's actual concurrency behavior (two transactions racing to activate a second `active` row for the same venue; exactly one succeeds, the other observes a real `23505` unique-violation) is exercised and proven in `backend/test/connector.integration-spec.ts` against the real shared dev database, not only asserted here.

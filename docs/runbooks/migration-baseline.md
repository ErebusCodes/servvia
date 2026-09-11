# Bringing `verdura_production` under migration control

**Status:** rehearsed end to end on 2026-09-11 against a schema-only copy of
production. Not yet executed against production.

**Audience:** whoever runs the production deployment window. Every command below
is written out in full. Nothing in this document is optional and nothing in it
should be improvised.

---

## Why `prisma migrate deploy` is not the deployment path

`verdura_production` **has no `_prisma_migrations` table.** Its schema was created
some other way — `db push`, a hand-applied dump, or an earlier tool.

Prisma reads that table to decide what to run. Against a database without one it
concludes that NOTHING has ever been applied and tries to run the history from
the first migration. The first migration is `20260618000000_init`, which issues
`CREATE TABLE` for tables that already exist, so the deploy fails on the first
statement and stops.

That failure is loud and harmless. The dangerous variants are the ones an
operator reaches for next when it happens — `migrate reset` (drops everything)
or `db push --accept-data-loss` (silently drops whatever does not match). This
procedure exists so that neither is ever the improvised answer at 11pm.

The correct path is to **baseline**: record the migrations whose effects are
already present, then deploy only the ones that are genuinely missing.

---

## What was established, and how

### Production's state (read-only queries only)

| Fact | Value |
| --- | --- |
| PostgreSQL version | **18.6** |
| Service | `VerduraPostgreSQL`, binaries at `C:\Program Files\Verdura\PostgreSQL\18\bin` |
| Tables in `public` | 29 |
| `_prisma_migrations` | **absent** |
| Tables with RLS enabled | 18 |
| Row-level policies | 0 |
| Rows in every business table | **0** — see below |

**`verdura_production` is empty.** Organization, Venue, Staff, Category,
MenuItem, Table, Order, OrderItem, Payment, Reservation, TabletDevice and
AuditLog all contain zero rows. It is a provisioned database that has never
served an order.

Two consequences, and they pull in opposite directions:

* **The migration window carries no data risk.** There is no customer data to
  lose. This is as safe as a production migration ever gets.
* **The venue does not exist yet.** No organization, no venue, no staff, no
  menu, no PLU mapping, no table `posTableCode`. Nothing in the native handheld
  workflow can run against this database until it is seeded — which is a
  separate piece of work and a hard blocker on live acceptance, independent of
  any code.

### Which migrations are already present — established by EFFECT, not by date

Timestamp order proves nothing: a migration can be newer than the schema and
already applied, or older and never applied. So each cumulative prefix of the
history was built on a scratch database and diffed against a schema-only copy
of production.

The result was unambiguous:

```
 1 20260618000000_init                              differs (123 statements)
 …
24 20260828133203_menu_management_pos_identity…     differs (1 statement)
25 20260909010000_add_order_item_seat               <-- IDENTICAL TO PRODUCTION
26 20260909120000_native_table_rounds               differs
27 20260910090000_pos_submission_strategy           differs
28 20260910100000_native_round_request_key          differs
29 20260910170000_native_round_manual_resolution    differs
```

**Production is exactly the cumulative effect of migrations 1–25.** Migrations
26–29 — all four of them the native handheld work — are genuinely missing.

One caveat, stated rather than glossed: `prisma migrate diff` compares tables,
columns, indexes, constraints and enums. **It does not model row-level security
policies.** RLS was therefore compared separately by counting
`pg_class.relrowsecurity` and `pg_policies`; production and the copy both report
18 RLS-enabled tables and 0 policies, so the copy is faithful on that axis too.

---

## The rehearsal, and its result

Run against `verdura_baseline_rehearsal` — a database created on the same
PostgreSQL 18.6 server from `pg_dump --schema-only` of production. Production
was never opened for writing.

| Step | Result |
| --- | --- |
| Resolve migrations 1–25 as applied | 25 of 25 succeeded |
| `prisma migrate status` | exactly 4 pending, and they are 26–29 |
| `prisma migrate deploy` | all 4 applied |
| `prisma migrate status` | **Database schema is up to date!** |
| `prisma migrate diff` vs the datamodel | **No difference detected** |
| Diff vs a database built from a full migration run on an empty DB | **empty in BOTH directions** |

That last row is the one that matters most: after baselining and deploying, the
production copy is indistinguishable from a database created by running the
whole history from nothing. There is no residue of having been baselined.

---

## The procedure

> Run from `apps/api`. `DATABASE_URL` must point at the database being operated
> on, and you must confirm which one that is before every step.

### 0. Before the window

```bash
# Confirm the version, and that the tooling matches it. A pg_dump older than the
# server refuses to run, which is how the first attempt at this failed.
"C:/Program Files/Verdura/PostgreSQL/18/bin/pg_dump" --version    # expect 18.x
```

### 1. Take a full backup — data as well as schema

Not optional even though the database is empty today. It may not be empty on the
day this is run, and a backup is the only step here that cannot be redone
afterwards.

```bash
export PGPASSWORD='<verdura_admin password>'
"C:/Program Files/Verdura/PostgreSQL/18/bin/pg_dump" \
  -h localhost -p 5432 -U verdura_admin -d verdura_production \
  --format=custom --file=verdura_production_$(date +%Y%m%d_%H%M).dump
```

### 2. Re-run the rehearsal against a copy of production AS IT IS TODAY

The analysis above was done on 2026-09-11. If anything has touched the schema
since, the baseline point has moved. **Re-establish it; do not trust this
document's number.**

```bash
# Schema-only copy. Read-only against production.
"C:/Program Files/Verdura/PostgreSQL/18/bin/pg_dump" \
  -h localhost -p 5432 -U verdura_admin -d verdura_production \
  --schema-only --no-owner --no-acl > production-schema.sql

"C:/Program Files/Verdura/PostgreSQL/18/bin/psql" \
  -h localhost -p 5432 -U verdura_admin -d postgres \
  -c 'DROP DATABASE IF EXISTS verdura_baseline_rehearsal;' \
  -c 'CREATE DATABASE verdura_baseline_rehearsal;'

"C:/Program Files/Verdura/PostgreSQL/18/bin/psql" \
  -h localhost -p 5432 -U verdura_admin -d verdura_baseline_rehearsal \
  -v ON_ERROR_STOP=1 -f production-schema.sql
```

Then find the baseline point by effect, exactly as above: build a scratch
database one migration at a time and diff it against the copy after each.

```bash
# For each migration, in order:
psql -d verdura_prefix_scratch -v ON_ERROR_STOP=1 -f prisma/migrations/<name>/migration.sql
npx prisma migrate diff \
  --from-url "postgresql://…/verdura_prefix_scratch" \
  --to-url   "postgresql://…/verdura_baseline_rehearsal" --script
# The prefix whose diff prints "This is an empty migration." is the baseline.
```

Then run steps 3–5 below **against the copy** and confirm every expected result
before going near production.

### 3. Mark the already-present migrations as applied

One command per migration, in order, up to and including the baseline point.
`--applied` writes a row into `_prisma_migrations` and **runs no SQL**.

```bash
npx prisma migrate resolve --applied 20260618000000_init
npx prisma migrate resolve --applied 20260618000001_enable_rls_all_tables
npx prisma migrate resolve --applied 20260815120000_order_idempotency_and_payment_linkage
npx prisma migrate resolve --applied 20260815140000_printer_job_truthful_states
npx prisma migrate resolve --applied 20260815150000_pos_sync_unsupported_status
npx prisma migrate resolve --applied 20260815150100_pos_sync_correct_fabricated_records
npx prisma migrate resolve --applied 20260816120000_pos_sync_outbox_dispatch
npx prisma migrate resolve --applied 20260816140000_connector_identity
npx prisma migrate resolve --applied 20260816150000_connector_command_protocol
npx prisma migrate resolve --applied 20260817005226_venue_locale_tax_metadata
npx prisma migrate resolve --applied 20260817024943_gcs_media_asset
npx prisma migrate resolve --applied 20260818034619_tablet_device_identity_and_staff_pin
npx prisma migrate resolve --applied 20260819120000_kot_dispatch_producer
npx prisma migrate resolve --applied 20260820034728_table19_validation_run
npx prisma migrate resolve --applied 20260820122747_kds_delivery_outbox
npx prisma migrate resolve --applied 20260820123321_kds_delivery_record_cascade_on_order_delete
npx prisma migrate resolve --applied 20260821000000_order_service_mode
npx prisma migrate resolve --applied 20260821011551_payment_observation
npx prisma migrate resolve --applied 20260822010000_idealpos_native_code_mapping
npx prisma migrate resolve --applied 20260822020000_idealpos_connector_dispatch
npx prisma migrate resolve --applied 20260823030000_idealpos_retry_backoff
npx prisma migrate resolve --applied 20260824000000_order_id_sequence
npx prisma migrate resolve --applied 20260825234223_possync_cancelled_status
npx prisma migrate resolve --applied 20260828133203_menu_management_pos_identity_and_channels
npx prisma migrate resolve --applied 20260909010000_add_order_item_seat
```

**Do not resolve past the baseline point.** Marking migration 26 as applied
would tell Prisma the native tables exist when they do not, and the application
would then start against a database missing every table the native path writes
to.

### 4. Confirm what is left, then deploy it

```bash
npx prisma migrate status      # expect EXACTLY the 4 native migrations pending
npx prisma migrate deploy
```

Stop and re-examine if `status` lists anything other than those four. It means
the baseline point was wrong.

### 5. Verify

```bash
npx prisma migrate status      # expect: Database schema is up to date!
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource  prisma/schema.prisma --exit-code   # expect: no difference
```

---

## What must never be run against production

| Command | Why |
| --- | --- |
| `prisma migrate reset` | Drops every table. There is no confirmation that survives a tired operator. |
| `prisma db push` | Reconciles to the datamodel without recording anything, leaving the history problem in place and silently dropping whatever does not match. |
| `prisma db push --accept-data-loss` | The same, with the one guard removed. |
| `prisma migrate dev` | Generates migrations and may reset. It is a development command. |
| `prisma migrate resolve --applied <migration 26+>` | Records a migration as applied that has not been. The application then starts against a database missing the tables it writes to. |
| `prisma migrate resolve --rolled-back` | Only ever correct for a migration that genuinely failed part-way. Not part of this procedure. |

---

## After the migration

The schema being correct does **not** mean the native path is live. In order:

1. The database is still empty — organization, venue, staff, menu, PLU mapping
   and table `posTableCode` all have to be seeded before any order can exist.
2. `IDEALPOS_POS_STRATEGY` stays unset until that venue is configured and
   verified. Leaving it unset routes dine-in orders to the existing certified
   Webit path exactly as today.
3. The native writer stays disabled. See `apps/api/.env.example` for every key
   and what each one does, and note that reconciliation is armed by a
   **separate** flag from the writer.

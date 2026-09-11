#!/usr/bin/env bash
# Baseline rehearsal for migration 30, on a DISPOSABLE database.
#
# Reproduces production's shape exactly: the cumulative effect of migrations
# 1..25, and NO _prisma_migrations table (production was created with
# `prisma db push`, so Prisma has never recorded anything there).
#
# Then does what the controlled window will do: resolve 1..25 as applied,
# deploy the rest, and prove the result is indistinguishable from a database
# built by running the whole history from nothing.
#
# Touches nothing but the scratch database. Production is never opened.
set -euo pipefail

PG="postgresql://audit:audit@localhost:55501"
DB="baseline_prod_shape"
MIG="prisma/migrations"
BASELINE_THROUGH="20260909010000_add_order_item_seat"

psql_c() { docker exec -i verdura-recovery-it psql -U audit -d "$1" -v ON_ERROR_STOP=1 -q; }

echo "== recreating $DB =="
docker exec verdura-recovery-it psql -U audit -d recovery_it -q \
  -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"

echo "== applying migrations 1..25 as raw SQL (no history recorded) =="
applied=0
for d in $(ls "$MIG" | grep -v migration_lock | sort); do
  psql_c "$DB" < "$MIG/$d/migration.sql"
  applied=$((applied + 1))
  if [ "$d" = "$BASELINE_THROUGH" ]; then break; fi
done
echo "   applied $applied migration files"

echo "== confirming it looks like production: no _prisma_migrations =="
docker exec verdura-recovery-it psql -U audit -d "$DB" -tAc \
  "SELECT coalesce(to_regclass('public._prisma_migrations')::text,'ABSENT');"

echo "== resolving 1..25 as already applied =="
for d in $(ls "$MIG" | grep -v migration_lock | sort); do
  DATABASE_URL="$PG/$DB" npx prisma migrate resolve --applied "$d" >/dev/null
  if [ "$d" = "$BASELINE_THROUGH" ]; then break; fi
done

echo "== migrate status (expect exactly the un-baselined ones pending) =="
DATABASE_URL="$PG/$DB" npx prisma migrate status 2>&1 | tail -8 || true

echo "== deploying the rest =="
DATABASE_URL="$PG/$DB" npx prisma migrate deploy 2>&1 | tail -3

echo "== diff vs datamodel (expect: No difference detected) =="
npx prisma migrate diff --from-url "$PG/$DB" --to-schema-datamodel prisma/schema.prisma --exit-code
echo "   datamodel diff exit: $?"

echo "== diff vs a database built from the whole history on an empty DB =="
npx prisma migrate diff --from-url "$PG/$DB" --to-url "$PG/baseline_rehearsal_30" --exit-code
echo "   forward exit: $?"
npx prisma migrate diff --from-url "$PG/baseline_rehearsal_30" --to-url "$PG/$DB" --exit-code
echo "   reverse exit: $?"

echo "== REHEARSAL COMPLETE =="

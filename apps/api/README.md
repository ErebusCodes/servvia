# API

**Transitional NestJS 11 backend.** It is not the target architecture.

- **The canonical transactional backend** is Servvia Core (`services/core-platform/`, Go). It owns canonical restaurant state; see [`fileRestructure.md`](../../fileRestructure.md) and [ADR 0001](../../docs/adr/0001-servvia-is-the-operational-pos.md).
- **This API still serves today's callers** (`apps/web/customer-website`, `apps/web/admin-console` and its device-mode builds). It still performs transitional reads and writes against the database for the capabilities it serves.
- **Capabilities leave this API by migration:** a Core replacement is built, callers are migrated, behaviour is proven, then the Nest path retires. No new canonical behaviour is added here.
- **Prisma (`apps/api/prisma/`) remains the migration authority** during the transition. That is a schema-ownership arrangement only; it does **not** make this API the canonical transactional backend.

## Responsibility (current, transitional)

What this API serves today, until each capability migrates:
- auth (JWT + RBAC), venues, menu, orders, tables, reservations, staff;
- audit logging, media uploads, printer job records;
- Redis-backed background jobs (BullMQ: email, print jobs).

**Legacy and retiring:** POS-sync records, the retired on-premise connector's identity and command protocol, and the BullMQ POS-sync queue. These are not part of the target architecture and are removed once their callers have migrated.

## Development

```bash
npm run dev:api               # watch mode, port 3000
npm run build --workspace=apps/api
npm run start:prod --workspace=apps/api
```

Prerequisites: PostgreSQL + Redis running (`npm run db:start` from the repo root — see the root `README.md`).

## Database

```bash
npm run db:migrate --workspace=apps/api   # or: npm run db:migrate (root)
npm run seed --workspace=apps/api         # or: npm run db:seed (root)
npm run prisma:studio --workspace=apps/api
```

Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.

## Test / lint / typecheck

```bash
npm run test --workspace=apps/api          # Jest unit tests
npm run test:integration --workspace=apps/api
npm run test:e2e --workspace=apps/api
npm run lint --workspace=apps/api
npm run typecheck --workspace=apps/api
```

## Allowed dependencies

Repo-root `shared/` (menu seed data, table config, local-dev constants — consumed by `prisma/seed.ts`, `prisma/seed-status.ts`, and `src/tables/tables.service.ts`). Must never import from any `apps/*-frontend`/`apps/web/customer-website`/`apps/web/admin-console` source.

## Prohibited

Fabricating POS-sync, payment, printer, or Idealpos success — see `docs/mvp.md`'s "never fake success" principle and `docs/production_readiness_report.md` for the currently-tracked violations of it (`pos-sync` NullAdapter, printer queue not dispatched).

## Current limitations

Not production-ready — see `docs/production_readiness_report.md` for the authoritative, evidence-based list of release blockers (online payment lifecycle, POS success fabrication, missing edge connector, printing not deliverable, idempotency/concurrency gaps, incomplete venue authorization).

# API

NestJS 11 backend — the single application permitted to read/write the database directly. Authoritative for authentication, authorization, tenant/venue scoping, business rules, order/reservation lifecycle, and validation for every client (`apps/customer-website`, `apps/window-display`, `apps/admin-console` and its device-mode builds).

## Responsibility

Auth (JWT + RBAC), venues, menu, orders, tables, reservations, staff, audit logging, media uploads, printer job records, POS-sync records, the on-premise connector's identity/command protocol, and Redis-backed background jobs (BullMQ: email, print jobs, POS sync).

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

Repo-root `shared/` (menu seed data, table config, local-dev constants — consumed by `prisma/seed.ts`, `prisma/seed-status.ts`, and `src/tables/tables.service.ts`). Must never import from any `apps/*-frontend`/`apps/customer-website`/`apps/admin-console`/`apps/window-display` source.

## Prohibited

Fabricating POS-sync, payment, printer, or Idealpos success — see `docs/mvp.md`'s "never fake success" principle and `docs/production_readiness_report.md` for the currently-tracked violations of it (`pos-sync` NullAdapter, printer queue not dispatched).

## Current limitations

Not production-ready — see `docs/production_readiness_report.md` for the authoritative, evidence-based list of release blockers (online payment lifecycle, POS success fabrication, missing edge connector, printing not deliverable, idempotency/concurrency gaps, incomplete venue authorization).

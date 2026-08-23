# Verdura — Local PostgreSQL + Redis (development only)

This directory provides disposable, project-local PostgreSQL and Redis
instances for running Verdura's backend against **real dependencies in
local development**, instead of a remote database or any
natively-installed/Homebrew/Windows-service Postgres or Redis. It is not
used as a cloud service.

The database is fully reproducible: it is recreated from Prisma migrations
(`backend/prisma/migrations/`) plus the seed script
(`backend/prisma/seed.ts`), never from a committed data dump.

## Quick start

The normal path, on both macOS and Windows, is simply:

```bash
npm install
npm run dev
```

`scripts/dev.mjs` (from the repo root) handles everything below
automatically — starting Docker, waiting for both services to be healthy,
migrating, and seeding only if the database is empty. Read on only if you
want to manage Postgres/Redis independently of the full dev stack.

```text
# from the repository root (macOS, Windows, or Linux)
npm run db:start          # starts Postgres + Redis via Docker Compose, waits for health
npm run db:migrate        # applies backend/prisma/migrations/
npm run db:seed           # seeds org/venue/staff/tables + canonical menu

npm run dev                # start the full app stack (scripts/dev.mjs)
```

To stop the containers (data is preserved):

```bash
npm run db:stop
```

To check status:

```bash
npm run db:status
```

## How it works

Docker Compose (`docker-compose.yml` at the repository root) is the single
source of truth for both PostgreSQL and Redis in local development —
`scripts/docker-services.mjs` and `scripts/dev.mjs` shell out to the
`docker` CLI directly (no `/bin/bash`, no POSIX-only commands), so the same
code path runs identically on macOS, Windows, and Linux. Docker is
required; there is no Homebrew, Memurai, or Windows-service fallback for
either service.

PostgreSQL and Redis data live in the named Docker volumes
`verdura-postgres` and `verdura-redis`; `docker compose down` preserves both.

## Ports

Postgres's default port, 5432, is commonly already in use by another local
Postgres instance. On the machine this setup was built on, **both 5432 and
5433** were already bound by unrelated local Postgres processes, so
Verdura's local database defaults to **port 5434**. Change `POSTGRES_PORT`
in `local-postgres/.env` if 5434 is also unavailable on your machine, and
update `DATABASE_URL` in `backend/.env` to match.

Redis defaults to its standard port, **6379**. Change `REDIS_PORT` in
`local-postgres/.env` if it's already taken, and update `REDIS_PORT` in
`backend/.env` to match.

## Credentials

`local-postgres/.env` holds **local-only, throwaway** credentials for a
database that exists solely on your machine. They are not production
secrets, must never be reused for any real/hosted database, and must never
be committed (the file is gitignored — only `.env.example` is tracked).

## Connecting

Once started, point `backend/.env`'s `DATABASE_URL` at it, e.g.:

```
DATABASE_URL=postgresql://verdura:verdura_local_dev_only@127.0.0.1:5434/verdura_dev
```

(adjust the port/password to match whatever you set in
`local-postgres/.env`). Use `127.0.0.1`, not `localhost` — Postgres is
published bound to the IPv4 loopback only, and `localhost` can resolve to
the IPv6 loopback first on some machines (Windows in particular), which
fails to connect even though the container is healthy.

## Commands reference

| Command | What it does |
|---|---|
| `npm run dev` | Full stack: starts Docker Postgres+Redis, migrates, seeds if empty, starts backend + all frontends |
| `npm run db:start` | Start Postgres + Redis via Docker Compose (creates them on first run), waits for health |
| `npm run db:stop` | Stop them, preserving data |
| `npm run db:status` | Show container status |
| `npm run db:migrate` | Apply pending Prisma migrations (`prisma migrate deploy`) to whichever DB `backend/.env`'s `DATABASE_URL` points at |
| `npm run db:seed` | Run `backend/prisma/seed.ts` (org, venue, admin staff, tables, canonical 70-item menu) — idempotent, safe to re-run |

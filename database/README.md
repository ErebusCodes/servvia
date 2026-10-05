# Servvia database

- **Status:** Final structural ownership boundary for the database. Not yet the migration authority.
- **Target technology:** PostgreSQL.
- **Target responsibility:** schema, migrations, seeds, fixtures and database documentation.
- **Current implementation/source:** `apps/api/prisma/` (`schema.prisma` and `migrations/`).
- **Stage 2 state:** Structural scaffold only. Product implementation has not started. This directory holds no schema and no migrations.
- **Next implementation trigger:** a separately approved migration-authority task.

## Rules
- `apps/api/prisma/` remains the **sole migration authority** during the transition.
- `database/` is the **final structural ownership boundary**.
- Moving the schema or migrations requires a **separately approved migration-authority task**.
- **Published migrations must not be renamed or rewritten.**
- There is no second migration history. Nothing from `apps/api/prisma/` is copied here.

Structure and ownership: [PRD/product-requirements.md, Part C](../PRD/product-requirements.md).

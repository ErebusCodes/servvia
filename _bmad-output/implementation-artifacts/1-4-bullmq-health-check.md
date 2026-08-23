---
baseline_commit: 3ad11cc
---

# Story 1.4: BullMQ wiring and /health endpoint

Status: ready-for-dev

> **Enterprise conformance addendum — 2026-08-15:** BullMQ may coordinate cloud-internal work, but the venue connector must use an outbound mutually authenticated command channel plus encrypted local durable queue; it must never receive shared cloud Redis credentials. Health must separately expose database, Redis, outbox backlog, connector heartbeat, oldest edge command and reconciliation/DLQ age. See [`docs/target-operating-model.md`](../../docs/target-operating-model.md).

## Story

As a developer,
I want BullMQ wired to Redis and a `GET /health` endpoint that confirms both the database and Redis are reachable,
so that Sprint 1's success criterion (`GET /health` returns `{ db: "ok", redis: "ok" }`) is met and future stories have a verified infrastructure baseline.

## Acceptance Criteria

1. `@nestjs/bullmq` and `bullmq` are installed; a `QueueModule` registers at least one named queue (`health`) connected to Redis via `REDIS_HOST` / `REDIS_PORT` env vars.
2. A `PrismaModule` exists, exporting `PrismaService` which extends `PrismaClient` and calls `$connect()` on `onModuleInit` and `$disconnect()` on `onModuleDestroy`.
3. `GET /health` returns HTTP 200 with body `{ "db": "ok", "redis": "ok" }` when both are reachable.
4. `GET /health` returns HTTP 503 with body `{ "db": "error", "redis": "ok" }` (or the reverse) when one service is unreachable — never 500.
5. `AppModule` imports both `PrismaModule` and `QueueModule`; the health endpoint uses both to verify connectivity (Prisma `$queryRaw\`SELECT 1\`` and BullMQ queue `.isPaused()` or equivalent ping).
6. All unit tests pass (`npm test`); a unit test for `HealthController` mocks both services and asserts the 200 and 503 response shapes.
7. `npm run typecheck` and `npm run lint` pass with zero errors.

## Tasks / Subtasks

- [ ] Task 1 — Install dependencies
  - [ ] `npm install @nestjs/bullmq bullmq --workspace=backend`
  - [ ] `npm install @prisma/client --workspace=backend` (already installed — verify it's in `backend/package.json`)
  - [ ] Confirm both appear in `backend/package.json` dependencies

- [ ] Task 2 — PrismaModule + PrismaService (AC: 2)
  - [ ] Create `backend/src/prisma/prisma.service.ts`:
    ```typescript
    import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
    import { PrismaClient } from '@prisma/client';

    @Injectable()
    export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
      async onModuleInit() { await this.$connect(); }
      async onModuleDestroy() { await this.$disconnect(); }
    }
    ```
  - [ ] Create `backend/src/prisma/prisma.module.ts`:
    ```typescript
    import { Global, Module } from '@nestjs/common';
    import { PrismaService } from './prisma.service';

    @Global()
    @Module({ providers: [PrismaService], exports: [PrismaService] })
    export class PrismaModule {}
    ```
  - [ ] Write `backend/src/prisma/prisma.service.spec.ts` — unit test that PrismaService is defined (mock `$connect` and `$disconnect` on the prototype)
  - [ ] Run: `npm test -- --testPathPattern=prisma.service` → expect PASS

- [ ] Task 3 — QueueModule (AC: 1)
  - [ ] Create `backend/src/queue/queue.module.ts`:
    ```typescript
    import { Module } from '@nestjs/common';
    import { BullModule } from '@nestjs/bullmq';
    import { ConfigModule, ConfigService } from '@nestjs/config';

    @Module({
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              host: config.getOrThrow<string>('REDIS_HOST'),
              port: config.getOrThrow<number>('REDIS_PORT'),
            },
          }),
        }),
        BullModule.registerQueue({ name: 'health' }),
      ],
      exports: [BullModule],
    })
    export class QueueModule {}
    ```
  - [ ] Write `backend/src/queue/queue.module.spec.ts` — smoke test that module compiles (use fake REDIS_HOST/PORT env vars)
  - [ ] Run: `npm test -- --testPathPattern=queue.module` → expect PASS

- [ ] Task 4 — HealthModule with controller (AC: 3, 4, 5, 6)
  - [ ] Create `backend/src/health/health.controller.ts`:
    ```typescript
    import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
    import { Response } from 'express';
    import { InjectQueue } from '@nestjs/bullmq';
    import { Queue } from 'bullmq';
    import { PrismaService } from '../prisma/prisma.service';

    @Controller('health')
    export class HealthController {
      constructor(
        private readonly prisma: PrismaService,
        @InjectQueue('health') private readonly healthQueue: Queue,
      ) {}

      @Get()
      @HttpCode(HttpStatus.OK)
      async check(@Res() res: Response) {
        const result = { db: 'ok' as 'ok' | 'error', redis: 'ok' as 'ok' | 'error' };

        try {
          await this.prisma.$queryRaw`SELECT 1`;
        } catch {
          result.db = 'error';
        }

        try {
          await this.healthQueue.getWorkers();
        } catch {
          result.redis = 'error';
        }

        const status = result.db === 'ok' && result.redis === 'ok'
          ? HttpStatus.OK
          : HttpStatus.SERVICE_UNAVAILABLE;

        return res.status(status).json(result);
      }
    }
    ```
  - [ ] Create `backend/src/health/health.module.ts`:
    ```typescript
    import { Module } from '@nestjs/common';
    import { BullModule } from '@nestjs/bullmq';
    import { HealthController } from './health.controller';

    @Module({
      imports: [BullModule.registerQueue({ name: 'health' })],
      controllers: [HealthController],
    })
    export class HealthModule {}
    ```
  - [ ] Write `backend/src/health/health.controller.spec.ts`:
    ```typescript
    import { Test, TestingModule } from '@nestjs/testing';
    import { HealthController } from './health.controller';
    import { PrismaService } from '../prisma/prisma.service';
    import { getQueueToken } from '@nestjs/bullmq';
    import { HttpStatus } from '@nestjs/common';

    const mockResponse = () => {
      const res: any = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    };

    describe('HealthController', () => {
      let controller: HealthController;
      let prisma: { $queryRaw: jest.Mock };
      let queue: { getWorkers: jest.Mock };

      beforeEach(async () => {
        prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
        queue = { getWorkers: jest.fn().mockResolvedValue([]) };

        const module: TestingModule = await Test.createTestingModule({
          controllers: [HealthController],
          providers: [
            { provide: PrismaService, useValue: prisma },
            { provide: getQueueToken('health'), useValue: queue },
          ],
        }).compile();

        controller = module.get<HealthController>(HealthController);
      });

      it('returns 200 { db: ok, redis: ok } when both healthy', async () => {
        const res = mockResponse();
        await controller.check(res);
        expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(res.json).toHaveBeenCalledWith({ db: 'ok', redis: 'ok' });
      });

      it('returns 503 { db: error, redis: ok } when DB unreachable', async () => {
        prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
        const res = mockResponse();
        await controller.check(res);
        expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
        expect(res.json).toHaveBeenCalledWith({ db: 'error', redis: 'ok' });
      });

      it('returns 503 { db: ok, redis: error } when Redis unreachable', async () => {
        queue.getWorkers.mockRejectedValue(new Error('ECONNREFUSED'));
        const res = mockResponse();
        await controller.check(res);
        expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
        expect(res.json).toHaveBeenCalledWith({ db: 'ok', redis: 'error' });
      });
    });
    ```
  - [ ] Run: `npm test -- --testPathPattern=health.controller` → expect 3 tests PASS

- [ ] Task 5 — Wire into AppModule (AC: 5)
  - [ ] In `backend/src/app.module.ts`, add `PrismaModule`, `QueueModule`, `HealthModule` to the `imports` array
  - [ ] Run: `npm run typecheck` → expect zero errors
  - [ ] Run: `npm run lint` → expect zero errors
  - [ ] Run: `npm test` → expect all tests pass

- [ ] Task 6 — Update AppController to redirect to /health (AC: 3)
  - [ ] In `backend/src/app.controller.ts`, update the `GET /` response to include a link or note pointing to `/health` (keep it a simple welcome message — full replacement is this story's endpoint at `/health`)

- [ ] Task 7 — Commit
  - [ ] `git add backend/src/prisma/ backend/src/queue/ backend/src/health/ backend/src/app.module.ts backend/src/app.controller.ts`
  - [ ] `git commit -m "feat(api): add PrismaService, QueueModule (BullMQ/Redis), GET /health endpoint"`

## Dev Notes

**DATABASE_URL for PrismaService:** use the direct connection string — not the Supabase session pooler. The pooler (`pooler.supabase.com`) is for serverless/short-lived connections. A persistent NestJS process holds its own connections directly.

```
DATABASE_URL=postgresql://postgres:[PASSWORD_URL_ENCODED]@db.vmjgyqhnvllqnzihoiyl.supabase.co:5432/postgres?sslmode=require
```

Special characters in the password must be URL-encoded: `@` → `%40`, `!` → `%21`.

**BullMQ Redis connection:** `REDIS_HOST=localhost`, `REDIS_PORT=6379` for local dev. Docker Compose in `backend/` must have Redis 7 running (`docker-compose up -d redis`).

**`@Global()` on PrismaModule:** makes PrismaService available to all modules (HealthModule, and future feature modules) without re-importing PrismaModule everywhere.

**`$queryRaw\`SELECT 1\`` as DB ping:** lightweight — no table scan, works even if all application tables are empty.

**`getWorkers()` as Redis ping:** BullMQ calls Redis internally; any ECONNREFUSED will throw, which we catch and map to `redis: 'error'`.

**RLS note:** All 18 tables have RLS enabled with no policies yet (Sprint 2). PrismaService uses the `service_role` equivalent via DATABASE_URL (direct Postgres user `postgres`), which bypasses RLS. No access issues expected until Sprint 2 adds client-facing queries with the anon key.

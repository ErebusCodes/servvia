// Integration test against a REAL local Redis (and the app's real Postgres
// bootstrap) — no mocking.
// Story 12.14: an integration run's queues live in their own BullMQ key
// namespace, so a stale or concurrent process cannot consume its jobs. On
// 2026-10-03 a leftover local API process (a BullMQ consumer of the shared
// default namespace) took pos-sync-dispatcher's jobs and failed that suite.
//
// Run with: npm run test:integration --workspace=backend
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { QUEUE_NAMES } from '../src/queue/queue.constants';

const connection = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Integration-run queue isolation (integration, real Redis)', () => {
  let app: INestApplication;
  const prefix = process.env.QUEUE_PREFIX ?? '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives this spec file a unique namespace that the app queues actually use', async () => {
    expect(prefix).toMatch(/^it-[0-9a-f]{32}$/);
    const queue = app.get<Queue>(getQueueToken(QUEUE_NAMES.EMAILS));
    expect(queue.opts.prefix).toBe(prefix);

    const job = await queue.add('isolation-probe', {}, { delay: 60_000 });
    const redis = new Redis(connection);
    try {
      expect(await redis.exists(`${prefix}:${QUEUE_NAMES.EMAILS}:${job.id}`)).toBe(1);
      // Nothing was written under BullMQ's default namespace.
      expect(await redis.exists(`bull:${QUEUE_NAMES.EMAILS}:${job.id}`)).toBe(0);
    } finally {
      await job.remove();
      redis.disconnect();
    }
  });

  it('a stale consumer outside the namespace never receives this run’s jobs', async () => {
    const queueName = 'isolation-probe';
    const stale: Job[] = [];
    const own: Job[] = [];
    // A leftover process from another run: same queue name, default prefix
    // and another run's prefix.
    const staleWorkers = [
      new Worker(queueName, (job) => Promise.resolve(void stale.push(job)), { connection }),
      new Worker(queueName, (job) => Promise.resolve(void stale.push(job)), {
        connection,
        prefix: 'it-00000000000000000000000000000000',
      }),
    ];
    const ownWorker = new Worker(queueName, (job) => Promise.resolve(void own.push(job)), {
      connection,
      prefix,
    });
    const queue = new Queue(queueName, { connection, prefix });
    try {
      await Promise.all([...staleWorkers, ownWorker].map((w) => w.waitUntilReady()));
      for (let i = 0; i < 5; i++) await queue.add('work', { i });
      for (let waited = 0; own.length < 5 && waited < 5000; waited += 50) await sleep(50);
      expect(own).toHaveLength(5);
      expect(stale).toHaveLength(0);
    } finally {
      await Promise.all([...staleWorkers, ownWorker].map((w) => w.close()));
      await queue.obliterate({ force: true });
      await queue.close();
      // The simulated stale consumers' own (empty) namespaces.
      for (const stalePrefix of [undefined, 'it-00000000000000000000000000000000']) {
        const staleQueue = new Queue(queueName, { connection, prefix: stalePrefix });
        await staleQueue.obliterate({ force: true });
        await staleQueue.close();
      }
    }
  });
});

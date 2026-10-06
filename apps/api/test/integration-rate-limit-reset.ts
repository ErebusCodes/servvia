// Story 16-3 (CI regression gates) fix, 2026-08-19.
//
// Every integration spec file that logs in, or hits an admin/tablet/
// connector route, shares ONE Redis-backed rate-limit bucket per
// (ip, method, path) — see src/auth/guards/rate-limit.guard.ts. A few
// individual spec files (connector.integration-spec.ts,
// tablet-auth.integration-spec.ts) had each independently added their own
// ad hoc clearing of the specific keys THEY cared about. That doesn't
// scale: as more integration spec files are added over time, the shared
// `/api/auth/login` bucket (default 10 requests / 900s) is exhausted by
// EARLIER files before a LATER, otherwise-unrelated file (e.g.
// menu.integration-spec.ts, which has no rate-limit awareness of its own)
// ever gets to make its own single login call.
//
// Reproduced live (first real run of the full integration suite from a
// genuinely fresh, from-zero database — no CI existed before this story to
// have ever done that): 58/199 tests failed, every one a cascading 429
// from one exhausted shared bucket, not a real behavioural defect in any
// of the 58 tests themselves.
//
// Fix: centralize the clear here, once per spec FILE. Jest's
// `setupFilesAfterEnv` (unlike `setupFiles`, which runs before the test
// framework's own globals like `beforeAll` are installed) reruns this for
// every `*.integration-spec.ts` file even under `--runInBand` — so this
// removes the need for every future integration spec file to remember to
// add its own clearing logic.
import Redis from 'ioredis';

beforeAll(async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    // Per-address buckets, and Story 2.4's per-account sign-in counts, which
    // earlier files' deliberate failed sign-ins would otherwise carry over.
    const keys = [...(await redis.keys('rate-limit:*')), ...(await redis.keys('login-account:*'))];
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // Best-effort only: if Redis isn't reachable at all, the test file's
    // own real requests will surface that failure clearly on their own —
    // this hook exists to prevent cross-file bucket exhaustion, not to be
    // the sole source of truth about Redis availability.
  } finally {
    redis.disconnect();
  }
});

// Story 12.14: remove this spec file's BullMQ namespace (see
// integration-setup.ts) once the file is done, so runs leave no queue keys
// behind. Only keys under this file's own unique prefix are touched; another
// run's namespace, or a deployed queue, is never matched.
afterAll(async () => {
  const prefix = process.env.QUEUE_PREFIX;
  if (!prefix || !/^it-[0-9a-f]{32}$/.test(prefix)) return;
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Best-effort, as above: an unreachable Redis already failed the file.
  } finally {
    redis.disconnect();
  }
});

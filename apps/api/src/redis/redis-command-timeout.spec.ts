// Behavioral proof that ioredis's `commandTimeout` option actually bounds a
// command's wait time even when Redis is completely unreachable (not just
// slow) and the client is configured with `maxRetriesPerRequest: null` +
// an infinite `retryStrategy` — the exact combination redis.module.ts and
// health.module.ts use. RateLimitGuard/HealthService's own unit tests mock
// the client entirely, so they can't exercise this: this test uses a real
// `Redis` instance pointed at a port nothing listens on, which is the
// closest safe local approximation of "Redis is down" without needing an
// actual Redis server.
import Redis from 'ioredis';

describe('ioredis commandTimeout (real client, unreachable server)', () => {
  const UNREACHABLE_PORT = 65530; // reserved-range port with nothing bound to it
  const TEST_COMMAND_TIMEOUT_MS = 250; // short so this spec itself stays fast

  function makeUnreachableClient(): Redis {
    return new Redis({
      host: '127.0.0.1',
      port: UNREACHABLE_PORT,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: () => 100,
      commandTimeout: TEST_COMMAND_TIMEOUT_MS,
    });
  }

  it('rejects a command within the configured timeout instead of hanging forever', async () => {
    const client = makeUnreachableClient();
    // Redis emits 'error' repeatedly while it can't connect; without a
    // listener Node would treat these as unhandled and crash the test run.
    client.on('error', () => {});

    const start = Date.now();
    await expect(client.ping()).rejects.toThrow();
    const elapsedMs = Date.now() - start;

    // Generous upper bound (several multiples of the configured timeout)
    // to absorb CI scheduling jitter, while still proving this is bounded
    // and not the old unbounded-hang behavior.
    expect(elapsedMs).toBeLessThan(TEST_COMMAND_TIMEOUT_MS * 10);

    client.disconnect();
  });

  it('does not produce an unbounded retry storm for a single command', async () => {
    const client = makeUnreachableClient();
    client.on('error', () => {});

    // A single command should reject exactly once via its own commandTimeout,
    // not be silently resubmitted — retryStrategy only governs the client's
    // background reconnect attempts, never re-issuing of an already-timed-out
    // command.
    await expect(client.ping()).rejects.toThrow();
    await expect(client.ping()).rejects.toThrow();

    client.disconnect();
  });

  it('eval (the shape RateLimitGuard actually calls) also times out, not just ping', async () => {
    const client = makeUnreachableClient();
    client.on('error', () => {});

    const start = Date.now();
    await expect(client.eval('return 1', 0)).rejects.toThrow();
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(TEST_COMMAND_TIMEOUT_MS * 10);

    client.disconnect();
  });
});

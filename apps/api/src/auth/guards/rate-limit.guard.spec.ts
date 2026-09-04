import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let getAllAndOverrideMock: jest.Mock;

  const evalMock = jest.fn();
  const setHeaderMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            eval: evalMock,
          },
        },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
    getAllAndOverrideMock = mockReflector.getAllAndOverride;
  });

  const createMockContext = (
    ip: string | undefined,
    headers: Record<string, string> = {},
    path: string = '/api/auth/login',
    method: string = 'POST',
    socket?: { remoteAddress: string | undefined },
  ): ExecutionContext => {
    const mockRequest = {
      ip,
      headers,
      path,
      method,
      socket: socket !== undefined ? socket : { remoteAddress: ip },
    };
    return {
      getType: () => 'http',
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => ({ setHeader: setHeaderMock }),
      }),
    } as unknown as ExecutionContext;
  };

  it('allows access and increments attempts when under threshold', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([0, 2]);

    const context = createMockContext('192.168.1.1');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining('rate-limit:192.168.1.1'),
      expect.any(String),
      '60000',
      '5',
      expect.any(String),
      '60',
    );
  });

  it('throws HttpException and sets Retry-After header when threshold is exceeded', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    const now = Date.now();
    evalMock.mockResolvedValueOnce([1, 5, now - 30_000]);

    const context = createMockContext('192.168.1.1');

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });

  it('fails closed if Redis exec throws an error', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockRejectedValue(new Error('Connection timeout'));

    const context = createMockContext('192.168.1.1');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it('uses request.ip for the rate limit key', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([0, 1]);

    const context = createMockContext('203.0.113.195');
    await guard.canActivate(context);

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'rate-limit:203.0.113.195:POST:/api/auth/login',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('falls back to socket.remoteAddress when request.ip is undefined', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([0, 1]);

    const context = createMockContext(undefined, {}, '/api/auth/login', 'POST', {
      remoteAddress: '10.0.0.1',
    });
    await guard.canActivate(context);

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining('rate-limit:10.0.0.1'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('falls back to 127.0.0.1 when both request.ip and socket are unavailable', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([0, 1]);

    const context = {
      getType: () => 'http',
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({
        getRequest: () => ({
          ip: undefined,
          headers: {},
          path: '/api/auth/login',
          method: 'POST',
          socket: undefined,
        }),
        getResponse: () => ({ setHeader: setHeaderMock }),
      }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining('rate-limit:127.0.0.1'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('fails closed when Redis returns fewer than 2 elements', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([0]);

    const context = createMockContext('192.168.1.1');
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it('uses windowSeconds as Retry-After default when oldestTime is 0', async () => {
    getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
    evalMock.mockResolvedValueOnce([1, 5, 0]);

    const context = createMockContext('192.168.1.1');
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('uses default limits if no decorator configuration is defined', async () => {
    getAllAndOverrideMock.mockReturnValue(undefined);
    evalMock.mockResolvedValueOnce([0, 1]);

    const context = createMockContext('192.168.1.1');
    await guard.canActivate(context);

    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      expect.any(String),
      '900000',
      '10',
      expect.any(String),
      '900',
    );
  });

  // ---- transient Redis blocking -----------------------------------------
  //
  // Redis is single-threaded and is shared with BullMQ here. Its slow log on
  // 2026-09-04 carried a 1,501,581 us command against the client's 1500 ms
  // commandTimeout, which is exactly how a valid connector poll was rejected
  // with 503. One bounded retry absorbs that without opening the gate.

  describe('transient Redis fault handling', () => {
    it('retries once when the command times out, then allows a permitted request', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      evalMock
        .mockRejectedValueOnce(new Error('Command timed out'))
        .mockResolvedValueOnce([0, 3]);

      const context = createMockContext('127.0.0.1', {}, '/api/connector/commands/poll');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(evalMock).toHaveBeenCalledTimes(2);
    });

    it('still fails closed with 503 when the retry also times out', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      evalMock.mockRejectedValue(new Error('Command timed out'));

      const context = createMockContext('127.0.0.1', {}, '/api/connector/commands/poll');

      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
      expect(evalMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry more than once', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      evalMock.mockRejectedValue(new Error('Command timed out'));

      await expect(
        guard.canActivate(createMockContext('127.0.0.1')),
      ).rejects.toMatchObject({ status: 503 });
      expect(evalMock).toHaveBeenCalledTimes(2);
    });

    it('reuses the same window arguments on the retry', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      evalMock
        .mockRejectedValueOnce(new Error('Command timed out'))
        .mockResolvedValueOnce([0, 1]);

      await guard.canActivate(createMockContext('127.0.0.1'));

      const [first, second] = evalMock.mock.calls;
      // now, windowMs, limit, uniqueMember, windowSeconds must all be identical
      expect(second.slice(2)).toEqual(first.slice(2));
    });

    it('NEVER retries a genuine rate-limit decision', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
      evalMock.mockResolvedValueOnce([1, 5, Date.now() - 30_000]);

      await expect(
        guard.canActivate(createMockContext('192.168.1.1')),
      ).rejects.toMatchObject({ status: 429 });
      expect(evalMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a non-transient Redis failure', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
      evalMock.mockRejectedValue(new Error('WRONGTYPE Operation against a key'));

      await expect(
        guard.canActivate(createMockContext('192.168.1.1')),
      ).rejects.toMatchObject({ status: 503 });
      expect(evalMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a malformed reply', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 5, windowSeconds: 60 });
      evalMock.mockResolvedValueOnce([0]);

      await expect(
        guard.canActivate(createMockContext('192.168.1.1')),
      ).rejects.toMatchObject({ status: 503 });
      expect(evalMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---- retry idempotency against real ZSET semantics ---------------------
  //
  // The dangerous interleaving is: the first EVAL COMMITS server-side, the
  // reply is lost, and the retry runs with the same member. These tests model
  // the sorted set faithfully (members unique by value; re-adding an existing
  // member updates its score instead of inserting a second element) and assert
  // on CARDINALITY, which is what actually charges a caller's budget.

  describe('retry idempotency against a modelled sorted set', () => {
    /** Executes LUA_LIMIT_SCRIPT's semantics against a real Map-backed ZSET. */
    const makeRedisModel = (limit: number) => {
      const zset = new Map<string, number>();
      const run = (
        _script: string,
        _numKeys: number,
        _key: string,
        nowArg: string,
        windowMsArg: string,
        limitArg: string,
        member: string,
      ): [number, number, number?] => {
        const now = Number(nowArg);
        const windowMs = Number(windowMsArg);
        const lim = Number(limitArg);
        // ZREMRANGEBYSCORE key -inf (now - windowMs)
        const oldest = now - windowMs;
        for (const [m, score] of zset) if (score <= oldest) zset.delete(m);
        const count = zset.size; // ZCARD
        if (count < lim) {
          zset.set(member, now); // ZADD — unique by member, updates in place
          return [0, count + 1];
        }
        const oldestScore = Math.min(...Array.from(zset.values()));
        return [1, count, oldestScore];
      };
      return { zset, run, limit };
    };

    it('a committed-then-lost EVAL followed by a retry charges exactly ONE slot', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      const model = makeRedisModel(120);

      // First call: apply the mutation server-side, then lose the reply.
      evalMock.mockImplementationOnce((...args: unknown[]) => {
        model.run(...(args as Parameters<typeof model.run>));
        return Promise.reject(new Error('Command timed out'));
      });
      // Retry: same args reach the same modelled server.
      evalMock.mockImplementationOnce((...args: unknown[]) =>
        Promise.resolve(model.run(...(args as Parameters<typeof model.run>))),
      );

      await expect(
        guard.canActivate(createMockContext('127.0.0.1', {}, '/api/connector/commands/poll')),
      ).resolves.toBe(true);

      // The whole point: the retry did NOT insert a second element.
      expect(model.zset.size).toBe(1);
      expect(evalMock).toHaveBeenCalledTimes(2);
    });

    it('the retry re-adds the SAME member rather than a new one', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      const model = makeRedisModel(120);

      evalMock.mockImplementationOnce((...args: unknown[]) => {
        model.run(...(args as Parameters<typeof model.run>));
        return Promise.reject(new Error('Command timed out'));
      });
      evalMock.mockImplementationOnce((...args: unknown[]) =>
        Promise.resolve(model.run(...(args as Parameters<typeof model.run>))),
      );

      await guard.canActivate(createMockContext('127.0.0.1'));

      const memberAfterFirst = evalMock.mock.calls[0][6] as string;
      const memberAfterRetry = evalMock.mock.calls[1][6] as string;
      expect(memberAfterRetry).toBe(memberAfterFirst);
      expect(Array.from(model.zset.keys())).toEqual([memberAfterFirst]);
    });

    it('the window sweep cannot evict the member the retry is about to re-add', async () => {
      // M's score is exactly `now`, and the sweep removes scores <= now - windowMs.
      // For any positive window that boundary is strictly below `now`.
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      const model = makeRedisModel(120);

      evalMock.mockImplementationOnce((...args: unknown[]) => {
        model.run(...(args as Parameters<typeof model.run>));
        return Promise.reject(new Error('Command timed out'));
      });
      evalMock.mockImplementationOnce((...args: unknown[]) =>
        Promise.resolve(model.run(...(args as Parameters<typeof model.run>))),
      );

      await guard.canActivate(createMockContext('127.0.0.1'));
      expect(model.zset.size).toBe(1);
    });

    // The full ledger for the dangerous interleaving, measured rather than
    // argued: cardinality at each step, the value the script returns, and the
    // limiter's verdict. This is the test that would fail if ZADD ever stopped
    // being an upsert, or if the sweep boundary became inclusive of `now`.
    it('committed-then-lost retry: every quantity measured end to end', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 120, windowSeconds: 60 });
      const model = makeRedisModel(120);

      // Three pre-existing members in the window, so N = 3 rather than 0 --
      // the identity must hold at arbitrary occupancy, not just an empty set.
      const t0 = Date.now();
      model.zset.set('prior-1', t0);
      model.zset.set('prior-2', t0);
      model.zset.set('prior-3', t0);

      const cardinalityBefore = model.zset.size;
      let firstReturn: [number, number, number?] | undefined;
      let cardinalityAfterFirst = -1;

      evalMock.mockImplementationOnce((...args: unknown[]) => {
        firstReturn = model.run(...(args as Parameters<typeof model.run>));
        cardinalityAfterFirst = model.zset.size; // committed server-side...
        return Promise.reject(new Error('Command timed out')); // ...reply lost
      });

      let retryReturn: [number, number, number?] | undefined;
      evalMock.mockImplementationOnce((...args: unknown[]) => {
        retryReturn = model.run(...(args as Parameters<typeof model.run>));
        return Promise.resolve(retryReturn);
      });

      const verdict = await guard.canActivate(
        createMockContext('127.0.0.1', {}, '/api/connector/commands/poll'),
      );

      const cardinalityAfterRetry = model.zset.size;

      // 1. cardinality before
      expect(cardinalityBefore).toBe(3);
      // 2. cardinality after the first, committed command: exactly one added
      expect(cardinalityAfterFirst).toBe(4);
      // 3. cardinality after the retry: UNCHANGED. The retry consumed no slot.
      expect(cardinalityAfterRetry).toBe(4);
      expect(cardinalityAfterRetry - cardinalityBefore).toBe(1);

      // 4. returned command count. The first run saw N=3 and returned 3+1=4.
      //    The retry saw N=4 (its own member already present, and the sweep
      //    cannot evict a member scored exactly `now`) and returned 4+1=5 --
      //    the documented, harmless over-report by one.
      expect(firstReturn).toEqual([0, 4]);
      expect(retryReturn).toEqual([0, 5]);
      expect((retryReturn as [number, number])[1]).toBe(
        (firstReturn as [number, number])[1] + 1,
      );

      // 5. limiter decision: allowed, from result[0] only. The over-reported
      //    counter is never read, which is why it cannot affect a verdict.
      expect((retryReturn as [number, number])[0]).toBe(0);
      expect(verdict).toBe(true);
    });

    it('stays conservative at the limit: a committed-then-lost EVAL at capacity still yields 429', async () => {
      getAllAndOverrideMock.mockReturnValue({ limit: 2, windowSeconds: 60 });
      const model = makeRedisModel(2);
      const now = Date.now();
      model.zset.set('existing-1', now);
      model.zset.set('existing-2', now);

      evalMock.mockImplementation((...args: unknown[]) =>
        Promise.resolve(model.run(...(args as Parameters<typeof model.run>))),
      );

      await expect(
        guard.canActivate(createMockContext('127.0.0.1')),
      ).rejects.toMatchObject({ status: 429 });
      // Refused, and nothing was added.
      expect(model.zset.size).toBe(2);
    });
  });
});

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
});

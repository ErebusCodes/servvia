import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  LOGIN_ACCOUNT_ATTEMPT_LIMIT,
  LOGIN_ACCOUNT_WINDOW_SECONDS,
  LoginThrottleService,
  accountFingerprint,
} from './login-throttle.service';

const SECRET = 'a'.repeat(40);

function throttleWith(redis: Partial<Record<'eval' | 'del', jest.Mock>>) {
  const config = { getOrThrow: () => SECRET } as unknown as ConfigService;
  return new LoginThrottleService(redis as unknown as Redis, config);
}

describe('accountFingerprint (Story 2.4)', () => {
  it('is stable across case and surrounding spaces, and is not the address', () => {
    const a = accountFingerprint('Owner@Example.com ', SECRET);
    expect(a).toBe(accountFingerprint('owner@example.com', SECRET));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('owner');
  });

  it('depends on the server secret, so it cannot be recomputed by guessing addresses', () => {
    expect(accountFingerprint('owner@example.com', SECRET)).not.toBe(
      accountFingerprint('owner@example.com', 'b'.repeat(40)),
    );
  });
});

describe('LoginThrottleService (Story 2.4)', () => {
  it('reserves an attempt under a key that holds no address, with the window as its expiry', async () => {
    const evalMock = jest.fn().mockResolvedValue(1);
    await throttleWith({ eval: evalMock }).reserveAttempt('owner@example.com');
    const [, keys, key, window] = evalMock.mock.calls[0];
    expect(keys).toBe(1);
    expect(key).toBe(`login-account:${accountFingerprint('owner@example.com', SECRET)}`);
    expect(key).not.toContain('owner');
    expect(window).toBe(String(LOGIN_ACCOUNT_WINDOW_SECONDS));
  });

  it('allows the limit and refuses the attempt after it with the address limiter’s 429', async () => {
    const throttle = throttleWith({
      eval: jest
        .fn()
        .mockResolvedValueOnce(LOGIN_ACCOUNT_ATTEMPT_LIMIT)
        .mockResolvedValueOnce(LOGIN_ACCOUNT_ATTEMPT_LIMIT + 1),
    });
    await expect(throttle.reserveAttempt('x@example.com')).resolves.toBeUndefined();
    const refusal = await throttle.reserveAttempt('x@example.com').catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(429);
    expect((refusal as HttpException).getResponse()).toEqual({
      statusCode: 429,
      message: 'Too many requests, please try again later.',
      error: 'Too Many Requests',
    });
  });

  it('fails closed when Redis cannot answer, or answers nonsense', async () => {
    await expect(
      throttleWith({
        eval: jest.fn().mockRejectedValue(new Error('Command timed out')),
      }).reserveAttempt('x@example.com'),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      throttleWith({ eval: jest.fn().mockResolvedValue('not a number') }).reserveAttempt(
        'x@example.com',
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('clears the count after success, and a failed clear does not fail the sign-in', async () => {
    const del = jest.fn().mockResolvedValue(1);
    await throttleWith({ del }).clear('Owner@example.com');
    expect(del).toHaveBeenCalledWith(
      `login-account:${accountFingerprint('owner@example.com', SECRET)}`,
    );
    await expect(
      throttleWith({ del: jest.fn().mockRejectedValue(new Error('down')) }).clear('x@example.com'),
    ).resolves.toBeUndefined();
  });
});

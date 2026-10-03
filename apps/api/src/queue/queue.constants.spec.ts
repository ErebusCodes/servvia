import { QUEUE_PREFIX_PATTERN, queuePrefix } from './queue.constants';
import { configValidationSchema } from '../app.module';
import { validateEnvironment } from '../config/environment.validation';

describe('queuePrefix (Story 12.14)', () => {
  it('leaves BullMQ on its default prefix when unset or blank (production unchanged)', () => {
    expect(queuePrefix(undefined)).toBeUndefined();
    expect(queuePrefix('')).toBeUndefined();
    expect(queuePrefix('   ')).toBeUndefined();
  });

  it('uses a configured prefix', () => {
    expect(queuePrefix('it-0123abcd')).toBe('it-0123abcd');
  });

  it('accepts only a short key-safe prefix', () => {
    expect(QUEUE_PREFIX_PATTERN.test('it-0123456789abcdef0123456789abcdef')).toBe(true);
    for (const bad of ['has space', 'colon:inside', 'star*', 'x'.repeat(65)]) {
      expect(QUEUE_PREFIX_PATTERN.test(bad)).toBe(false);
    }
  });

  it('refuses a malformed QUEUE_PREFIX at startup', () => {
    const base = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://x:y@127.0.0.1:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
    };
    expect(() => validateEnvironment(configValidationSchema, { ...base })).not.toThrow();
    expect(() =>
      validateEnvironment(configValidationSchema, { ...base, QUEUE_PREFIX: 'bad prefix' }),
    ).toThrow(/QUEUE_PREFIX/);
  });
});

import { configValidationSchema } from '../app.module';
import { productionConfigurationViolations, validateEnvironment } from './environment.validation';

// Story 1.5: production configuration fails closed at startup.
describe('validateEnvironment', () => {
  const secrets = {
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    INTERNAL_SERVICE_TOKEN: 'internal-service-token-for-tests-0123456789',
  };
  const base = { DATABASE_URL: 'postgresql://localhost:5432/db', ...secrets };
  const validate = (env: Record<string, unknown>) =>
    validateEnvironment(configValidationSchema, env);

  it('refuses to start when NODE_ENV is unset (no silent development default)', () => {
    expect(() => validate({ ...base })).toThrow(/NODE_ENV: any\.required/);
  });

  it('refuses to start when NODE_ENV is not a known environment', () => {
    expect(() => validate({ ...base, NODE_ENV: 'prod' })).toThrow(/NODE_ENV: any\.only/);
  });

  it('starts in development and in production with safe configuration', () => {
    expect(validate({ ...base, NODE_ENV: 'development' }).NODE_ENV).toBe('development');
    const production = validate({
      ...base,
      NODE_ENV: 'production',
      ADMIN_CONSOLE_PIN: '482913',
      KDS_VENUE_PINS: JSON.stringify({ 'venue-1': '7391' }),
    });
    expect(production.NODE_ENV).toBe('production');
  });

  it('allows development-only values outside production', () => {
    expect(() =>
      validate({
        ...base,
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'verdura-local-dev-only-access-secret-32chars-min',
        JWT_REFRESH_SECRET: 'verdura-local-dev-only-refresh-secret-32chars-min',
        ADMIN_CONSOLE_PIN: '108',
        KDS_VENUE_PINS: JSON.stringify({ 'venue-1': '108' }),
        TABLE19_LIVE_TEST_ENABLED: 'true',
      }),
    ).not.toThrow();
  });

  describe('in production, refuses each development default at startup', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        'default JWT access secret',
        { JWT_ACCESS_SECRET: 'verdura-local-dev-only-access-secret-32chars-min' },
        /JWT_ACCESS_SECRET is a checked-in default/,
      ],
      [
        'default JWT refresh secret',
        { JWT_REFRESH_SECRET: 'local-docker-refresh-secret-change-me' },
        /JWT_REFRESH_SECRET is a checked-in default/,
      ],
      [
        'default service token',
        { INTERNAL_SERVICE_TOKEN: 'change-me-internal-service-token-32chars' },
        /INTERNAL_SERVICE_TOKEN is a checked-in default/,
      ],
      [
        'identical access and refresh secrets',
        { JWT_REFRESH_SECRET: secrets.JWT_ACCESS_SECRET },
        /must differ/,
      ],
      [
        'admin PIN 108',
        { ADMIN_CONSOLE_PIN: '108' },
        /ADMIN_CONSOLE_PIN is the checked-in default PIN/,
      ],
      ['3-digit admin PIN', { ADMIN_CONSOLE_PIN: '427' }, /ADMIN_CONSOLE_PIN is shorter than 4/],
      [
        'KDS PIN 108',
        { KDS_VENUE_PINS: JSON.stringify({ v1: '108' }) },
        /KDS_VENUE_PINS\[v1\] is the checked-in default PIN/,
      ],
      [
        '3-digit KDS PIN',
        { KDS_VENUE_PINS: JSON.stringify({ v1: '931' }) },
        /KDS_VENUE_PINS\[v1\] is shorter than 4/,
      ],
      [
        'malformed KDS PINs',
        { KDS_VENUE_PINS: '{not json' },
        /KDS_VENUE_PINS is not a JSON object/,
      ],
      [
        'Table 19 validation mode',
        { TABLE19_LIVE_TEST_ENABLED: 'true' },
        /TABLE19_LIVE_TEST_ENABLED is a development-only/,
      ],
    ];
    it.each(cases)('%s', (_name, override, message) => {
      expect(() => validate({ ...base, NODE_ENV: 'production', ...override })).toThrow(message);
    });
  });

  it('never includes a secret or PIN value in its error', () => {
    const leaky = {
      ...base,
      NODE_ENV: 'production',
      ADMIN_CONSOLE_PIN: '12',
      KDS_VENUE_PINS: JSON.stringify({ v1: '108' }),
      JWT_ACCESS_SECRET: 'verdura-local-dev-only-access-secret-32chars-min',
    };
    let message = '';
    try {
      validate(leaky);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('verdura-local-dev-only-access-secret-32chars-min');
    expect(message).not.toMatch(/"12"|"108"/);
    // A schema-level failure (a pattern mismatch) is reported without its value too.
    expect(() => validate({ ...base, NODE_ENV: 'production', ADMIN_CONSOLE_PIN: '12a' })).toThrow(
      /ADMIN_CONSOLE_PIN: string\.pattern\.base/,
    );
    try {
      validate({ ...base, NODE_ENV: 'production', ADMIN_CONSOLE_PIN: '12a' });
    } catch (e) {
      expect((e as Error).message).not.toContain('12a');
    }
  });

  it('applies production rules only in production', () => {
    expect(
      productionConfigurationViolations({ NODE_ENV: 'test', ADMIN_CONSOLE_PIN: '108' }),
    ).toEqual([]);
  });
});

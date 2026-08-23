import { assertSecretNotInsecureDefault, InsecureDefaultSecretError } from './insecure-default-secret.util';

describe('assertSecretNotInsecureDefault', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('never fires outside production, even for a checked-in default value', () => {
    process.env.NODE_ENV = 'development';
    expect(() =>
      assertSecretNotInsecureDefault(
        'verdura-local-dev-only-access-secret-32chars-min',
        'JWT_ACCESS_SECRET',
      ),
    ).not.toThrow();
  });

  it('refuses to start in production with the checked-in .env.example default', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertSecretNotInsecureDefault(
        'verdura-local-dev-only-access-secret-32chars-min',
        'JWT_ACCESS_SECRET',
      ),
    ).toThrow(InsecureDefaultSecretError);
  });

  it('refuses to start in production with the checked-in docker-compose.yml default', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertSecretNotInsecureDefault('local-docker-refresh-secret-change-me', 'JWT_REFRESH_SECRET'),
    ).toThrow(InsecureDefaultSecretError);
  });

  it('allows a genuinely distinct production secret through unchanged', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertSecretNotInsecureDefault('a-real-32-character-minimum-secret-value', 'JWT_ACCESS_SECRET'),
    ).not.toThrow();
  });

  it('does not throw on an undefined secret — that gap is already covered by the separate required-env-var check', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertSecretNotInsecureDefault(undefined, 'JWT_ACCESS_SECRET')).not.toThrow();
  });
});

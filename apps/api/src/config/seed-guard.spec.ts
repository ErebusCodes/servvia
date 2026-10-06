import { seedRefusal } from './seed-guard';

describe('seedRefusal (Story 2.11)', () => {
  const dev = 'postgresql://u@127.0.0.1:5432/verdura_dev';

  it('allows a development or test database', () => {
    expect(seedRefusal({ NODE_ENV: 'development', DATABASE_URL: dev })).toBeNull();
    expect(seedRefusal({ DATABASE_URL: 'postgresql://u@localhost/it_ci' })).toBeNull();
  });

  it('refuses a production runtime, whatever the database', () => {
    expect(seedRefusal({ NODE_ENV: 'production', DATABASE_URL: dev })).toMatch(/production/);
  });

  it('refuses a database that looks like production', () => {
    for (const name of ['verdura_production', 'prod', 'servvia-live', 'Production_copy']) {
      expect(seedRefusal({ DATABASE_URL: `postgresql://u@h/${name}` })).toMatch(/looks like/);
    }
  });

  it('refuses an unreadable or missing database name', () => {
    expect(seedRefusal({})).not.toBeNull();
    expect(seedRefusal({ DATABASE_URL: 'postgresql://u@h/' })).not.toBeNull();
  });
});

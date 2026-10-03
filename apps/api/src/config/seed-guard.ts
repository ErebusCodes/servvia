/**
 * prisma/seed.ts writes development and test data: a fixed organization,
 * venue and menu, and an owner whose password it sets from
 * SEED_OWNER_PASSWORD, resetting it (and restoring the account) when it
 * already exists, so a development database is reproducible. That must never
 * reach a real installation, where it would silently reset a named owner's
 * credential. A real installation's first owner is created with the governed
 * bootstrap (npm run staff:bootstrap-owner); a lost credential is recovered
 * with npm run staff:issue-setup-code.
 *
 * The seed therefore refuses a production runtime and a database whose name
 * looks like production (the rule test/integration-setup.ts and Core's
 * testsupport apply), and there is no override.
 */
const PRODUCTION_DATABASE_NAME = /(^|[_-])(prod|production|live)([_-]|$)|production/i;

export function seedRefusal(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === 'production') return 'NODE_ENV is production';
  let name: string;
  try {
    name = decodeURIComponent(new URL(env.DATABASE_URL ?? '').pathname.replace(/^\//, ''));
  } catch {
    return 'DATABASE_URL is not a readable connection URL';
  }
  if (!name) return 'DATABASE_URL names no database';
  if (PRODUCTION_DATABASE_NAME.test(name)) return `the database '${name}' looks like production`;
  return null;
}

// Unlike test-setup.ts (used by unit tests and the fully-mocked app
// bootstrap e2e spec), integration specs under *.integration-spec.ts hit a
// genuine local Postgres — they need a real DATABASE_URL, not a fake one.
// Requires `npm run db:local:start && npm run db:migrate && npm run db:seed`
// to have been run first (see local-postgres/README.md).
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS FILE NOW REFUSES THINGS.
//
// These specs WRITE. They create organizations, venues, staff and orders, and
// they do not clean all of it up. They took their connection from `.env`
// without ever looking at it, and on this machine `.env` names
// `verdura_production` — so `npm run test:integration`, typed by anyone at any
// time, wrote test fixtures straight into the database this venue is about to
// go live on. It has happened: on 2026-09-11 two runs left four rows behind
// (`story15-6-pay-obs-test other`, and its venue, twice over). They were
// identified by id and removed, and the database was verified empty again.
//
// Nothing about that was a Prisma problem or a test problem. It was this file
// trusting a variable whose whole job is to point at production.
//
// So: the database name is now checked before anything connects. A name that
// looks like production is refused outright, and the refusal explains how to
// point the suite somewhere disposable. There is deliberately NO override
// flag — an integration suite that writes has no legitimate reason to run
// against a production database, and an override would eventually be set.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Names that must never receive a write from this suite.
 *
 * Matched against the database name only, case-insensitively. Deliberately
 * broad: a false positive costs one environment variable, and a false negative
 * costs a restaurant its data.
 */
const FORBIDDEN_DATABASE_NAMES = /(^|[_-])(prod|production|live)([_-]|$)|production/i;

/** The variable that points this suite somewhere safe, and takes precedence. */
const INTEGRATION_URL_KEY = 'INTEGRATION_DATABASE_URL';

function loadDotEnv(): void {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * The database name a URL points at, or null if it cannot be read.
 *
 * An UNREADABLE url is treated as forbidden by the caller, not as safe. A
 * connection string this cannot parse is one nobody should be writing through
 * on the strength of a guess.
 */
function databaseNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '');
    return name === '' ? null : decodeURIComponent(name);
  } catch {
    return null;
  }
}

loadDotEnv();

// An explicit integration URL wins, always. This is the supported way to run
// the suite, and it is why no override flag is needed for the check below.
const explicit = process.env[INTEGRATION_URL_KEY];
if (explicit && explicit.trim() !== '') {
  process.env.DATABASE_URL = explicit.trim();
}

const target = process.env.DATABASE_URL;
const databaseName = databaseNameOf(target);

if (!databaseName) {
  throw new Error(
    'Integration tests have no readable DATABASE_URL.\n\n' +
      'These specs WRITE to a real Postgres. Refusing to run without knowing which database ' +
      `that is. Set ${INTEGRATION_URL_KEY} to a disposable database, e.g.\n\n` +
      `  ${INTEGRATION_URL_KEY}=postgresql://verdura:...@localhost:5434/verdura_dev npm run test:integration\n`,
  );
}

if (FORBIDDEN_DATABASE_NAMES.test(databaseName)) {
  throw new Error(
    `Integration tests refuse to run against a database named '${databaseName}'.\n\n` +
      'These specs CREATE organizations, venues, staff and orders, and do not remove all of ' +
      'them. Running them here would put test fixtures into the database this venue goes live ' +
      'on — which has already happened once, on 2026-09-11, from exactly this path.\n\n' +
      `Point the suite at a disposable database with ${INTEGRATION_URL_KEY}:\n\n` +
      `  ${INTEGRATION_URL_KEY}=postgresql://user:pass@localhost:5434/verdura_dev npm run test:integration\n\n` +
      'There is no override flag. An integration suite that writes has no legitimate reason to ' +
      'run against production, and a flag would eventually be set.',
  );
}

// Unlike test-setup.ts (used by unit tests and the fully-mocked app
// bootstrap e2e spec), integration specs under *.integration-spec.ts hit a
// genuine local Postgres — they need the real backend/.env, not a fake
// DATABASE_URL. Requires `npm run db:local:start && npm run db:migrate &&
// npm run db:seed` to have been run first (see local-postgres/README.md).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
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

// Fails when the API's production start command points at a file the build
// did not emit. `npm run start:prod` (used directly, by the backend
// Dockerfile and by docker/start-backend.mjs) once ran `node dist/main`
// while `nest build` emitted `dist/src/main.js`, so the production service
// could not start. Run this after `npm run build --workspace=apps/api`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// startEntry returns the entry file of a `node <path>` start script, or
// throws when the script is not of that form.
export function startEntry(script) {
  const match = /^node\s+(\S+)\s*$/.exec(script ?? '');
  if (!match) {
    throw new Error(`start:prod must be "node <entry>", got ${JSON.stringify(script)}`);
  }
  return match[1];
}

// entryCandidates lists the files Node would load for an entry path.
export function entryCandidates(appDir, entry) {
  const base = join(appDir, entry);
  return base.endsWith('.js') ? [base] : [base, `${base}.js`];
}

// checkApiEntry returns the resolved entry file, or throws naming every
// candidate that was looked for.
export function checkApiEntry(appDir) {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  const entry = startEntry(pkg.scripts?.['start:prod']);
  const candidates = entryCandidates(appDir, entry);
  const found = candidates.find((file) => existsSync(file));
  if (!found) {
    throw new Error(`start:prod runs "${entry}" but the build emitted none of: ${candidates.join(', ')}`);
  }
  return found;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const found = checkApiEntry(join(repoRoot, 'apps', 'api'));
    console.log(`check-api-entry: start:prod entry exists (${found})`);
  } catch (err) {
    console.error(`check-api-entry: ${err.message}`);
    process.exit(1);
  }
}

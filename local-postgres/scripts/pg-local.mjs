#!/usr/bin/env node
// Backward-compatible entry point for older local commands. Verdura now has
// one Docker-only dependency workflow; native/Homebrew/Windows-service
// PostgreSQL fallbacks are intentionally unsupported.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..', '..');
const actionMap = {
  start: 'up',
  stop: 'down',
  status: 'status',
};

const requestedAction = process.argv[2];
if (requestedAction === 'reset') {
  console.error(
    '[pg-local] Automatic database reset is no longer supported. ' +
    'Use the root Docker Compose workflow and remove volumes only when you explicitly intend to destroy local data.',
  );
  process.exit(1);
}

const action = actionMap[requestedAction];
if (!action) {
  console.error('Usage: node local-postgres/scripts/pg-local.mjs <start|stop|status>');
  process.exit(1);
}

const result = spawnSync(process.execPath, [join(root, 'scripts', 'docker-services.mjs'), action], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

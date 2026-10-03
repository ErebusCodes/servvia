// Unit tests for scripts/check-api-entry.mjs, using disposable fixture
// directories under the OS temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkApiEntry, entryCandidates, startEntry } from './check-api-entry.mjs';

function withApp(startProd, files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'api-entry-check-test-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'start:prod': startProd } }));
    for (const file of files) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), '');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('startEntry: extracts the entry of a node start script', () => {
  assert.equal(startEntry('node dist/src/main'), 'dist/src/main');
  assert.equal(startEntry('node dist/src/main.js'), 'dist/src/main.js');
});

test('startEntry: rejects anything that is not "node <entry>"', () => {
  assert.throws(() => startEntry(undefined));
  assert.throws(() => startEntry('nest start'));
  assert.throws(() => startEntry('node dist/main --inspect'));
});

test('entryCandidates: an extensionless entry also matches its .js file', () => {
  assert.deepEqual(entryCandidates('/app', 'dist/src/main'), ['/app/dist/src/main', '/app/dist/src/main.js']);
  assert.deepEqual(entryCandidates('/app', 'dist/src/main.js'), ['/app/dist/src/main.js']);
});

test('checkApiEntry: passes when the build emitted the start entry', () => {
  withApp('node dist/src/main', ['dist/src/main.js'], (dir) => {
    assert.equal(checkApiEntry(dir), join(dir, 'dist/src/main.js'));
  });
});

test('checkApiEntry: fails when start and emitted entry diverge (the original defect)', () => {
  withApp('node dist/main', ['dist/src/main.js'], (dir) => {
    assert.throws(() => checkApiEntry(dir), /start:prod runs "dist\/main" but the build emitted none of/);
  });
});

test('the repository start:prod targets the entry nest build emits', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'));
  assert.equal(startEntry(pkg.scripts['start:prod']), 'dist/src/main');
});

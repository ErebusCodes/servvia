// Unit tests for scripts/check-no-nul-bytes.mjs. Uses disposable fixture
// files under a fresh OS temp directory -- never stages a real NUL-corrupted
// file into this repo's own git history just to test the detector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFilesForNulBytes, filterSourceExtensions, SOURCE_EXTENSIONS } from './check-no-nul-bytes.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nul-byte-check-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('scanFilesForNulBytes: clean file is not flagged', () => {
  withTempDir((dir) => {
    const clean = join(dir, 'clean.ts');
    writeFileSync(clean, 'const key = `${a} ${b}`;\n');
    assert.deepEqual(scanFilesForNulBytes([clean]), []);
  });
});

test('scanFilesForNulBytes: a real 0x00 byte is detected', () => {
  withTempDir((dir) => {
    const corrupt = join(dir, 'corrupt.ts');
    // Exactly the real-world shape of the bug: a NUL byte standing in for
    // the space inside a template-literal interpolation.
    writeFileSync(corrupt, Buffer.from('const key = `${a}\x00${b}`;\n', 'binary'));
    assert.deepEqual(scanFilesForNulBytes([corrupt]), [corrupt]);
  });
});

test('scanFilesForNulBytes: reports only the offending file out of several', () => {
  withTempDir((dir) => {
    const clean1 = join(dir, 'clean1.ts');
    const corrupt = join(dir, 'corrupt.ts');
    const clean2 = join(dir, 'clean2.md');
    writeFileSync(clean1, 'export const x = 1;\n');
    writeFileSync(corrupt, Buffer.from('bad\x00byte', 'binary'));
    writeFileSync(clean2, '# heading\n');
    assert.deepEqual(scanFilesForNulBytes([clean1, corrupt, clean2]), [corrupt]);
  });
});

test('scanFilesForNulBytes: a genuinely binary image with real NUL bytes is only a problem if it were ever scanned -- filterSourceExtensions is what keeps it out of scope', () => {
  withTempDir((dir) => {
    const png = join(dir, 'photo.png');
    // Minimal PNG signature bytes -- legitimately contains 0x00.
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    // scanFilesForNulBytes itself is extension-agnostic (by design, so it
    // stays independently testable) -- it WOULD flag this if asked to.
    assert.deepEqual(scanFilesForNulBytes([png]), [png]);
    // The real guard never asks it to, because filterSourceExtensions
    // excludes .png before scanFilesForNulBytes ever sees the path.
    assert.deepEqual(filterSourceExtensions([png]), []);
  });
});

test('filterSourceExtensions: keeps known source extensions, drops unknown/binary ones', () => {
  const input = ['a.ts', 'b.tsx', 'c.png', 'd.jpg', 'e.md', 'f.avif', 'g.ps1', 'h.svg'];
  assert.deepEqual(filterSourceExtensions(input), ['a.ts', 'b.tsx', 'e.md', 'g.ps1']);
});

test('SOURCE_EXTENSIONS sanity: does not include common binary asset extensions', () => {
  for (const bad of ['.png', '.jpg', '.jpeg', '.avif', '.gif', '.webp', '.ico', '.pdf', '.zip']) {
    assert.equal(SOURCE_EXTENSIONS.has(bad), false, `${bad} must not be in scope`);
  }
});

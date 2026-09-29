// Structural check for contracts/: every YAML/JSON file parses, every
// OpenAPI document declares 3.1 with paths, every operation declares at
// least one response, and every local $ref resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts');
const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function parse(path) {
  const text = readFileSync(path, 'utf8');
  return extname(path) === '.json' ? JSON.parse(text) : yaml.load(text);
}

function localRefs(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => localRefs(child, found));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) found.push(value);
      else localRefs(value, found);
    }
  }
  return found;
}

function resolvePointer(doc, ref) {
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, key) => (node == null ? undefined : node[key]), doc);
}

const structured = files(root).filter((path) => ['.yaml', '.yml', '.json'].includes(extname(path)));

test('contracts/ contains structured contract files', () => {
  assert.ok(structured.length > 0);
});

for (const path of structured) {
  const name = relative(root, path);

  test(`${name} parses and its local $refs resolve`, () => {
    const doc = parse(path);
    assert.ok(doc && typeof doc === 'object', 'document is an object');
    for (const ref of localRefs(doc)) {
      assert.notEqual(resolvePointer(doc, ref), undefined, `unresolved $ref ${ref}`);
    }
  });

  if (name.startsWith('openapi/')) {
    test(`${name} is a complete OpenAPI 3.1 document`, () => {
      const doc = parse(path);
      assert.match(String(doc.openapi), /^3\.1\./);
      assert.ok(doc.info?.title && doc.info?.version, 'info.title and info.version');
      assert.ok(doc.paths && Object.keys(doc.paths).length > 0, 'at least one path');
      for (const [route, item] of Object.entries(doc.paths)) {
        for (const method of HTTP_METHODS.filter((m) => item[m])) {
          const responses = item[method].responses;
          assert.ok(
            responses && Object.keys(responses).length > 0,
            `${method.toUpperCase()} ${route} declares responses`,
          );
        }
      }
    });
  }
}

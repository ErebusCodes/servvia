// supertest-dependency-delta (Story 1.9). The only manifest and lockfile change is the dev-only
// supertest upgrade with exactly the approved lockfile entries; everything else in apps/api/package.json
// and package-lock.json is hash-pinned to the baseline. Generated constants: RANGE, PKG_REST, LOCK_REST,
// ENTRIES, BASE_META (all derived from the baseline commit and the approved entries).
const fs = require('node:fs'); const { createHash } = require('node:crypto');
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const sha = (v) => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const RANGE = __RANGE__;
const PKG_REST = __PKG_REST__;
const LOCK_REST = __LOCK_REST__;
const ENTRIES = __ENTRIES__;
const BASE_META = __BASE_META__;
const problems = [];
const pkg = JSON.parse(fs.readFileSync('apps/api/package.json', 'utf8'));
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.devDependencies?.supertest !== RANGE) problems.push(`apps/api devDependencies.supertest is ${JSON.stringify(pkg.devDependencies?.supertest)}, not ${JSON.stringify(RANGE)}`);
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) if (pkg[field]?.supertest !== undefined) problems.push(`supertest appears in apps/api ${field}`);
const rest = JSON.parse(JSON.stringify(pkg)); if (rest.devDependencies) delete rest.devDependencies.supertest;
if (sha(rest) !== PKG_REST) problems.push('apps/api/package.json changed beyond devDependencies.supertest (scripts, jest configuration, engines or another dependency)');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const [k, want] of Object.entries(ENTRIES)) if (!same(lock.packages?.[k], want)) problems.push(`package-lock.json ${k} is not the approved entry (${want.version}, ${want.integrity.slice(0, 19)}…): found ${JSON.stringify(lock.packages?.[k]?.version)}`);
if (lock.packages?.['apps/api']?.devDependencies?.supertest !== RANGE) problems.push(`package-lock.json apps/api devDependencies.supertest is not ${JSON.stringify(RANGE)}`);
// npm may synchronise these lockfile metadata fields with the (unchanged) manifests; nothing else.
const meta = [['name', lock.name, root.name], ['packages[""].name', lock.packages?.['']?.name, root.name], ['packages[""].engines', lock.packages?.['']?.engines, root.engines], ['packages["apps/api"].name', lock.packages?.['apps/api']?.name, pkg.name], ['packages["apps/api"].engines', lock.packages?.['apps/api']?.engines, pkg.engines]];
for (const [label, have, manifest] of meta) if (!same(have, BASE_META[label]) && !same(have, manifest)) problems.push(`package-lock.json ${label} is neither its baseline value nor the value its package.json declares`);
const stripped = JSON.parse(JSON.stringify(lock)); delete stripped.name;
for (const k of Object.keys(ENTRIES)) delete stripped.packages?.[k];
for (const k of ['', 'apps/api']) { if (stripped.packages?.[k]) { delete stripped.packages[k].name; delete stripped.packages[k].engines; } }
if (stripped.packages?.['apps/api']?.devDependencies) delete stripped.packages['apps/api'].devDependencies.supertest;
if (sha(stripped) !== LOCK_REST) problems.push('package-lock.json changed beyond the approved supertest, superagent and formidable entries (another package, a production dependency, or lockfile settings)');
for (const p of problems) console.log('FAIL ' + p);
if (problems.length) process.exit(1);
console.log(`ok   dependency delta is exactly supertest ${RANGE} (${Object.values(ENTRIES).map((e) => e.version).join(', ')}; dev-only), nothing else`);

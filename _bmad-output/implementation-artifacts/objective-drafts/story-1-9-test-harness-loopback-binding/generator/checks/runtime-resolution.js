// supertest-runtime-resolution (Story 1.9). The supertest, superagent and formidable the API tests
// load at run time are the versions the candidate's lockfile pins (the evaluated dependencies are the
// candidate's, not whatever node_modules the operator linked).
const fs = require('node:fs'); const path = require('node:path');
const lock = JSON.parse(fs.readFileSync('../../package-lock.json', 'utf8')).packages;
const problems = [];
// Node's node_modules lookup from a directory, read without require.resolve (package exports may hide package.json).
const find = (name, from) => { for (let d = path.resolve(from); ; d = path.dirname(d)) { const f = path.join(d, 'node_modules', name, 'package.json'); if (fs.existsSync(f)) return { file: fs.realpathSync(f), version: JSON.parse(fs.readFileSync(f, 'utf8')).version }; if (path.dirname(d) === d) return null; } };
const st = find('supertest', process.cwd());
const sa = st && find('superagent', path.dirname(st.file));
const fm = sa && find('formidable', path.dirname(sa.file));
for (const [name, got] of [['supertest', st], ['superagent', sa], ['formidable', fm]]) {
  const want = lock[`node_modules/${name}`]?.version;
  console.log(`${name}: resolved ${got?.version ?? 'nothing'} (locked ${want})`);
  if (!want || got?.version !== want) problems.push(`${name} resolves to ${got?.version ?? 'nothing'} at runtime but package-lock.json locks ${want}: the evaluated dependencies are not the candidate's`);
}
for (const p of problems) console.log('FAIL ' + p);
if (problems.length) process.exit(1);
console.log('ok   the supertest the tests load is the version the candidate locks');

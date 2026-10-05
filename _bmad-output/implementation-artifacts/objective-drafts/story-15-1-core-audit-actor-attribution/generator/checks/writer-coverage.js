// audit-writer-single-path (Story 15.1). Core production Go (cmd/** and internal/**, test files
// excluded) writes the AuditLog in exactly one place, the audit package: exactly one INSERT INTO
// "AuditLog", under AUDIT_DIR, and the quoted "AuditLog" table identifier appears nowhere else; no
// production code updates, deletes or copies AuditLog rows. Every writer of the baseline (WRITERS,
// derived from the baseline: the files that inserted AuditLog rows) has no AuditLog SQL of its own left.
// Generated constants: CORE, AUDIT_DIR, WRITERS.
const fs = require('node:fs'); const path = require('node:path');
const CORE = __CORE__;
const AUDIT_DIR = __AUDIT_DIR__;
const WRITERS = __WRITERS__;
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const files = ['cmd', 'internal'].flatMap((d) => walk(path.join(CORE, d))).map((f) => f.split(path.sep).join('/'))
  .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort();
const IDENT = /\\?"AuditLog\\?"/g;
const INSERT = /INSERT\s+INTO\s+\\?"AuditLog\\?"/gi;
const OTHER = /(UPDATE|DELETE\s+FROM|COPY|TRUNCATE(\s+TABLE)?|ALTER\s+TABLE|DROP\s+TABLE)\s+\\?"AuditLog\\?"|Identifier\s*\{\s*"AuditLog"\s*\}/gi;
const bad = []; const inserts = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const inAudit = f.startsWith(AUDIT_DIR + '/');
  for (const m of text.matchAll(INSERT)) inserts.push(f);
  for (const m of text.matchAll(OTHER)) bad.push(`${f}: ${m[0]} (production code never rewrites, removes or bulk-copies AuditLog rows)`);
  if (!inAudit && IDENT.test(text)) bad.push(`${f}: names the "AuditLog" table outside ${AUDIT_DIR}`);
  IDENT.lastIndex = 0;
}
if (!files.some((f) => f.startsWith(AUDIT_DIR + '/'))) bad.push(`${AUDIT_DIR} has no production Go file`);
if (inserts.length !== 1 || !inserts[0].startsWith(AUDIT_DIR + '/')) bad.push(`INSERT INTO "AuditLog" must occur exactly once, under ${AUDIT_DIR}; found ${inserts.length}: ${inserts.join(', ') || 'none'}`);
for (const w of WRITERS) {
  if (!fs.existsSync(w)) { bad.push(`${w}: a baseline audit writer is missing`); continue; }
  if (IDENT.test(fs.readFileSync(w, 'utf8'))) bad.push(`${w}: still holds AuditLog SQL of its own`);
  IDENT.lastIndex = 0;
}
for (const b of bad) console.log('FAIL ' + b);
if (bad.length) process.exit(1);
console.log(`ok   ${files.length} Core production Go files: the AuditLog is written only by ${inserts[0]}; the ${WRITERS.length} baseline writers delegate to it`);

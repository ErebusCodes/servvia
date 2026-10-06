import { createHash } from 'node:crypto';

/**
 * A normalized failure signature: the same failure, met again with different
 * ports, temporary paths, ids, timestamps, line numbers or process ids, gives
 * the same signature, so the correction loop can stop on a repeat without any
 * judgement call. Deterministic: string normalization and a hash.
 */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function normalizeText(text) {
  return String(text ?? '')
    .replace(ANSI, '')
    .replace(/(?:file:\/\/)?(?:\/private)?\/(?:tmp|var\/folders)\/[^\s'"`),:]+/g, '<path>')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@+-]+){2,}\/(candidate|baseline)\//g, '<workspace>/')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The first meaningful line of a failure message, normalized: its error class. */
export function errorClass(message) {
  const line = String(message ?? '')
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^(?:---|\.\.\.|duration_ms|type:|location:|failuretype:|code:|(?:error|message|stack):\s*[|>]-?$)/i.test(l));
  // "error: 'boom'" (TAP YAML) and "Error: boom" are the same class.
  const text = (line ?? '').replace(/^(?:error|message):\s*/i, '').replace(/^['"]|['"]$/g, '');
  return normalizeText(text).slice(0, 200);
}

/**
 * Components of a FAIL: one per failing finding (check, required-test,
 * setup), with the failing tests' names and the error class of each, sorted
 * so their order never matters.
 */
export function failureComponents(record) {
  const components = [];
  const excerpts = record.excerpts ?? [];
  for (const f of record.findings ?? []) {
    if (f.severity !== 'FAIL') continue;
    if (f.code === 'check-failed') {
      const tests = excerpts.filter((e) => e.source === `check:${f.check}` && e.test);
      if (tests.length === 0) {
        const generic = excerpts.find((e) => e.source === `check:${f.check}`);
        components.push({ check: f.check, code: f.code, test: null, error: errorClass(generic?.text) });
      }
      for (const e of tests) components.push({ check: f.check, code: f.code, test: normalizeText(e.test), error: errorClass(e.text) });
    } else {
      components.push({ check: f.check ?? null, code: f.code, test: null, error: normalizeText(f.detail).slice(0, 200) });
    }
  }
  const key = (c) => JSON.stringify([c.check, c.code, c.test, c.error]);
  return [...new Map(components.map((c) => [key(c), c])).values()].sort((a, b) => key(a).localeCompare(key(b)));
}

export function failureSignature(record) {
  const components = failureComponents(record);
  return {
    signature: createHash('sha256').update(JSON.stringify(components)).digest('hex'),
    components,
  };
}

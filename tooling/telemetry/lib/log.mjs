// The telemetry event log: one JSON event per line, append-only and hash-chained (each event's `prev` is
// the SHA-256 of the previous line). Nothing here edits or removes a line.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const EVENT_SCHEMA = 'servvia.telemetry-event/v1';
export const DEFAULT_LOG = '_bmad-output/implementation-artifacts/telemetry/events.jsonl';
export const EVENT_KEYS = ['schema', 'seq', 'prev', 'at', 'story', 'objectiveId', 'type', 'phase', 'reason', 'value', 'unit', 'refs', 'corrects', 'note', 'provenance'];
export const PROVENANCES = ['measured', 'derived', 'recorded'];

export class Refused extends Error {}

export const sha256Hex = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** The exact line of an event: contract key order, absent keys omitted, refs sorted by key. */
export function lineOf(event) {
  const ordered = {};
  for (const key of EVENT_KEYS) {
    if (event[key] === undefined) continue;
    ordered[key] = key === 'refs'
      ? Object.fromEntries(Object.entries(event.refs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : event[key];
  }
  return JSON.stringify(ordered);
}

/** Reads and verifies the whole log. Returns { lines, events } or { problem: { seq, reason } }. */
export function inspect(path) {
  if (!existsSync(path)) return { lines: [], events: [] };
  const text = readFileSync(path, 'utf8');
  if (text === '') return { lines: [], events: [] };
  const lines = text.split('\n');
  if (lines.pop() !== '') return { problem: { seq: lines.length + 1, reason: 'the log must end with a newline' } };
  const events = [];
  for (const [i, line] of lines.entries()) {
    const seq = i + 1;
    const bad = (reason) => ({ problem: { seq, reason } });
    let event;
    try { event = JSON.parse(line); } catch { return bad('the line is not JSON'); }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) return bad('the line is not an event object');
    const keys = Object.keys(event);
    if (!keys.every((k) => EVENT_KEYS.includes(k))) return bad(`unexpected key ${keys.find((k) => !EVENT_KEYS.includes(k))}`);
    if (keys.join(',') !== EVENT_KEYS.filter((k) => keys.includes(k)).join(',')) return bad('keys are not in contract order');
    if (event.schema !== EVENT_SCHEMA) return bad('wrong schema');
    if (event.seq !== seq) return bad(`seq ${event.seq} at line ${seq}`);
    const expected = i === 0 ? null : sha256Hex(lines[i - 1]);
    if (event.prev !== expected) return bad('prev is not the hash of the previous line');
    if (typeof event.at !== 'string' || typeof event.story !== 'string' || typeof event.type !== 'string' || !PROVENANCES.includes(event.provenance)) return bad('missing at, story, type or provenance');
    events.push(event);
  }
  return { lines, events };
}

/** The verified log, or a refusal naming the first bad seq. */
export function open(path) {
  const log = inspect(path);
  if (log.problem) throw new Refused(`the log fails verification at seq ${log.problem.seq}: ${log.problem.reason}`);
  return log;
}

/** Appends events (without schema, seq and prev) after the verified log; one write. */
export function appendEvents(path, log, events) {
  if (events.length === 0) return [];
  let prev = log.lines.length ? sha256Hex(log.lines[log.lines.length - 1]) : null;
  const written = events.map((event, i) => {
    const line = lineOf({ ...event, schema: EVENT_SCHEMA, seq: log.lines.length + i + 1, prev });
    prev = sha256Hex(line);
    return line;
  });
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, written.map((l) => `${l}\n`).join(''));
  return written;
}

/** Events that count: retract events and the events they retract are excluded. */
export function counted(events) {
  const retracted = new Set(events.filter((e) => e.type === 'retract').map((e) => e.corrects));
  return events.filter((e) => e.type !== 'retract' && !retracted.has(e.seq));
}

/** A UTC time in the contract form, or a refusal. */
export function utc(value, what) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Refused(`${what} is not a valid time: ${value}`);
  return date.toISOString();
}

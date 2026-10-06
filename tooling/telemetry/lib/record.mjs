// `record`: one lifecycle event, measured from the clock or recorded with an explicit time.
import { DEFAULT_LOG, Refused, appendEvents, counted, open, utc } from './log.mjs';

export const PHASES = ['preparation', 'implementation', 'correction', 'review'];
export const RECORDED_TYPES = ['phase-start', 'phase-end', 'blocked-start', 'blocked-end', 'review-decision', 'accepted', 'effort-recorded', 'defect', 'retract'];
export const DERIVED_TYPES = ['frozen', 'candidate', 'evaluated', 'test-growth', 'integrated'];
const REASONS = {
  'blocked-start': ['owner-decision', 'external', 'authorization', 'infrastructure', 'other'],
  'review-decision': ['accept', 'revise', 'reject'],
  defect: ['escaped', 'reopened'],
};
// Which optional fields each type needs; every other field is refused for that type.
const NEEDS = {
  'phase-start': ['phase'], 'phase-end': ['phase'], 'blocked-start': ['reason'], 'review-decision': ['reason'],
  defect: ['reason'], 'effort-recorded': ['phase', 'value', 'unit'], retract: ['corrects', 'note'],
};
const FIELD_OPTIONS = { phase: 'phase', reason: 'reason', value: 'value', unit: 'unit', corrects: 'corrects' };
export const STORY_ID = /^\d+\.\d+[a-z]?$/;

export function record(opts, env) {
  const path = opts.log ?? DEFAULT_LOG;
  const log = open(path);
  const { story, type } = opts;
  if (!STORY_ID.test(story ?? '')) throw new Refused('--story must be a story id such as 20.3');
  if (DERIVED_TYPES.includes(type)) throw new Refused(`${type} is derived from git and the evaluator, never recorded`);
  if (!RECORDED_TYPES.includes(type)) throw new Refused(`unknown event type: ${type ?? '(missing)'}`);
  const needs = NEEDS[type] ?? [];
  for (const [field, option] of Object.entries(FIELD_OPTIONS)) {
    if (needs.includes(field) && opts[option] === undefined) throw new Refused(`${type} needs --${option}`);
    if (!needs.includes(field) && opts[option] !== undefined) throw new Refused(`--${option} is not used by ${type}`);
  }
  if (needs.includes('note') && !opts.note) throw new Refused(`${type} needs --note`);
  if (opts.phase !== undefined && !PHASES.includes(opts.phase)) throw new Refused(`unknown phase: ${opts.phase}`);
  if (REASONS[type] && !REASONS[type].includes(opts.reason)) throw new Refused(`${type} reason must be one of: ${REASONS[type].join(', ')}`);
  if (opts.note !== undefined && opts.note.length > 200) throw new Refused('a note has at most 200 characters');
  let value;
  if (type === 'effort-recorded') {
    value = Number(opts.value);
    if (!Number.isFinite(value) || value <= 0) throw new Refused('recorded effort must be a positive number of hours');
    if (opts.unit !== 'hours') throw new Refused('recorded effort is in hours');
  }
  const refs = {};
  for (const pair of opts.ref) {
    const eq = pair.indexOf('=');
    if (eq < 1 || !/^[A-Za-z][\w-]*$/.test(pair.slice(0, eq))) throw new Refused(`--ref must be key=value: ${pair}`);
    refs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  // Lifecycle state of the story, from the events that count.
  const mine = counted(log.events).filter((e) => e.story === story);
  const isOpen = (start, end, sameKind) => mine.filter(sameKind).reduce((open, e) => (e.type === start ? true : e.type === end ? false : open), false);
  const phaseOpen = isOpen('phase-start', 'phase-end', (e) => (e.type === 'phase-start' || e.type === 'phase-end') && e.phase === opts.phase);
  const blockedOpen = isOpen('blocked-start', 'blocked-end', (e) => e.type === 'blocked-start' || e.type === 'blocked-end');
  if (type === 'phase-start' && phaseOpen) throw new Refused(`the ${opts.phase} phase of ${story} is already open`);
  if (type === 'phase-end' && !phaseOpen) throw new Refused(`the ${opts.phase} phase of ${story} is not open`);
  if (type === 'blocked-start' && blockedOpen) throw new Refused(`${story} is already blocked`);
  if (type === 'blocked-end' && !blockedOpen) throw new Refused(`${story} is not blocked`);
  let corrects;
  if (type === 'retract') {
    corrects = Number(opts.corrects);
    const target = log.events.find((e) => e.seq === corrects);
    if (!Number.isInteger(corrects) || !target) throw new Refused(`there is no event ${opts.corrects} to retract`);
    if (target.type === 'retract') throw new Refused('a retraction cannot be retracted');
    if (log.events.some((e) => e.type === 'retract' && e.corrects === corrects)) throw new Refused(`event ${corrects} is already retracted`);
  }

  const explicit = opts.at !== undefined;
  const at = explicit ? utc(opts.at, '--at') : utc(env.SERVVIA_TELEMETRY_CLOCK ?? new Date().toISOString(), 'the clock');
  const provenance = type === 'effort-recorded' || explicit ? 'recorded' : 'measured';
  const [line] = appendEvents(path, log, [{
    at, story, objectiveId: opts['objective-id'], type, phase: opts.phase, reason: opts.reason, value, unit: opts.unit,
    refs: Object.keys(refs).length ? refs : undefined, corrects, note: opts.note, provenance,
  }]);
  return `${line}\n`;
}

// `summary`: per-story metrics and a program view. Every metric is { value, provenance, basis }; a value
// that was never measured, derived or recorded is null with provenance `unknown`, never zero or a guess.
import { DEFAULT_LOG, Refused, counted, open } from './log.mjs';

export const SUMMARY_SCHEMA = 'servvia.telemetry-summary/v1';
export const METRICS = ['preparationElapsedMs', 'implementationElapsedMs', 'implementationEffectiveMs', 'evaluationElapsedMs', 'evaluatorIterations', 'correctionIterations', 'firstPassVerdict', 'reviewRounds', 'blockedMs', 'recordedEffortHours', 'testDeclarationsAdded', 'defectsEscaped', 'defectsReopened', 'cycleElapsedMs'];
const STRENGTH = { recorded: 0, derived: 1, measured: 2 };
const time = (iso) => Date.parse(iso);

const known = (value, provenances, basis) => ({ value, provenance: provenances.reduce((weak, p) => (STRENGTH[p] < STRENGTH[weak] ? p : weak), 'measured'), basis });
const unknown = (basis) => ({ value: null, provenance: 'unknown', basis });

/** Closed [start, end] intervals in log order; unmatched starts are ignored. */
function pairs(events, startType, endType) {
  const out = [];
  let start = null;
  for (const e of events) {
    if (e.type === startType && start === null) start = e;
    else if (e.type === endType && start !== null) { out.push({ from: time(start.at), to: time(e.at), provenances: [start.provenance, e.provenance] }); start = null; }
  }
  return out;
}
const length = (intervals) => intervals.reduce((sum, x) => sum + (x.to - x.from), 0);
const overlap = (x, y) => Math.max(0, Math.min(x.to, y.to) - Math.max(x.from, y.from));
const earliest = (events) => events.reduce((a, b) => (a === null || time(b.at) < time(a.at) ? b : a), null);
const latest = (events) => events.reduce((a, b) => (a === null || time(b.at) > time(a.at) ? b : a), null);

function metricsOf(events) {
  const ofType = (type) => events.filter((e) => e.type === type);
  const phase = (name) => pairs(events.filter((e) => (e.type === 'phase-start' || e.type === 'phase-end') && e.phase === name), 'phase-start', 'phase-end');
  const blocked = pairs(events.filter((e) => e.type === 'blocked-start' || e.type === 'blocked-end'), 'blocked-start', 'blocked-end');
  const phaseEvents = events.filter((e) => e.type === 'phase-start' || e.type === 'phase-end');
  const live = ofType('phase-start').length > 0; // live-tracked story
  const liveProvenances = phaseEvents.map((e) => e.provenance);
  const preparation = phase('preparation');
  const implementation = phase('implementation');
  const evaluated = ofType('evaluated');
  const frozen = earliest(ofType('frozen'));
  const firstCandidate = earliest(ofType('candidate'));
  const m = {};

  m.preparationElapsedMs = preparation.length ? known(length(preparation), preparation.flatMap((x) => x.provenances), 'preparation phase intervals') : unknown('preparation was not measured');
  if (implementation.length) m.implementationElapsedMs = known(length(implementation), implementation.flatMap((x) => x.provenances), 'implementation phase intervals');
  else if (frozen && firstCandidate) m.implementationElapsedMs = known(time(firstCandidate.at) - time(frozen.at), ['derived'], 'freeze to first candidate, wall clock (not effort)');
  else m.implementationElapsedMs = unknown('neither implementation intervals nor freeze and candidate');
  if (implementation.length) {
    const touching = blocked.filter((b) => implementation.some((x) => overlap(x, b) > 0));
    const effective = implementation.reduce((sum, x) => sum + (x.to - x.from) - blocked.reduce((o, b) => o + overlap(x, b), 0), 0);
    m.implementationEffectiveMs = known(effective, [...implementation.flatMap((x) => x.provenances), ...touching.flatMap((x) => x.provenances)], 'implementation intervals minus blocked time');
  } else m.implementationEffectiveMs = unknown('effective time needs measured implementation intervals');
  m.evaluationElapsedMs = evaluated.length ? known(evaluated.reduce((sum, e) => sum + time(e.at) - time(e.refs.startedAt), 0), ['derived'], 'evaluation start to ledger time') : unknown('no evaluation');
  m.evaluatorIterations = evaluated.length ? known(evaluated.length, ['derived'], 'evaluated iterations') : unknown('no evaluation');
  m.correctionIterations = evaluated.length ? known(evaluated.filter((e) => e.value > 1).length, ['derived'], 'iterations after the first') : unknown('no evaluation');
  const first = evaluated.find((e) => e.value === 1);
  m.firstPassVerdict = first ? known(first.refs.verdict, ['derived'], 'verdict of iteration 1') : unknown('no first iteration');
  const reviews = ofType('review-decision');
  m.reviewRounds = reviews.length ? known(reviews.length, reviews.map((e) => e.provenance), 'review decisions') : unknown('no review decision recorded');
  if (blocked.length) m.blockedMs = known(length(blocked), blocked.flatMap((x) => x.provenances), 'blocked intervals');
  else m.blockedMs = live ? known(0, liveProvenances, 'live-tracked and never blocked') : unknown('waiting was not tracked');
  const effort = ofType('effort-recorded');
  m.recordedEffortHours = effort.length ? known(effort.reduce((sum, e) => sum + e.value, 0), ['recorded'], 'stated effort') : unknown('no effort was stated');
  const growth = ofType('test-growth');
  m.testDeclarationsAdded = growth.length ? known(growth.reduce((sum, e) => sum + e.value, 0), ['derived'], 'test declarations, anchor to candidate') : unknown('no test-growth derived');
  for (const [name, kind] of [['defectsEscaped', 'escaped'], ['defectsReopened', 'reopened']]) {
    const defects = ofType('defect').filter((e) => e.reason === kind);
    if (defects.length) m[name] = known(defects.length, defects.map((e) => e.provenance), `${kind} defects`);
    else m[name] = live ? known(0, liveProvenances, `live-tracked, no ${kind} defect`) : unknown('defects were not tracked');
  }
  const start = earliest(events.filter((e) => e.type === 'phase-start' && e.phase === 'preparation')) ?? frozen;
  const end = latest(ofType('accepted')) ?? latest(ofType('integrated'));
  m.cycleElapsedMs = start && end
    ? known(time(end.at) - time(start.at), [start.provenance, end.provenance], `${start.type === 'frozen' ? 'freeze' : 'preparation start'} to ${end.type === 'accepted' ? 'acceptance' : 'integration'}`)
    : unknown('no cycle start or end');
  return Object.fromEntries(METRICS.map((name) => [name, m[name]]));
}

function storyOrder(a, b) {
  const parse = (id) => { const [epic, rest] = id.split('.'); const [, num, suffix] = rest.match(/^(\d+)(.*)$/); return [Number(epic), Number(num), suffix]; };
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1] - y[1] || (x[2] === y[2] ? 0 : x[2] < y[2] ? -1 : 1);
}
const nearestRank = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];

export function summarise(events, { story, epic } = {}) {
  const live = counted(events);
  const ids = [...new Set(live.map((e) => e.story))]
    .filter((id) => story === undefined || id === story)
    .filter((id) => epic === undefined || id.split('.')[0] === epic)
    .sort(storyOrder);
  const stories = ids.map((id) => {
    const mine = live.filter((e) => e.story === id);
    return { story: id, objectiveIds: [...new Set(mine.map((e) => e.objectiveId).filter(Boolean))].sort(), metrics: metricsOf(mine) };
  });
  const verdicts = stories.map((s) => s.metrics.firstPassVerdict).filter((m) => m.provenance !== 'unknown');
  const program = {
    stories: stories.length,
    firstPassRate: { value: verdicts.length ? verdicts.filter((m) => m.value === 'PASS').length / verdicts.length : null, n: verdicts.length },
  };
  for (const name of METRICS.filter((n) => n !== 'firstPassVerdict')) {
    const values = stories.map((s) => s.metrics[name]).filter((m) => m.provenance !== 'unknown').map((m) => m.value).sort((a, b) => a - b);
    program[name] = { n: values.length, median: values.length ? nearestRank(values, 0.5) : null, p90: values.length ? nearestRank(values, 0.9) : null, unknown: stories.length - values.length };
  }
  return { schema: SUMMARY_SCHEMA, stories, program };
}

export function summary(opts) {
  const format = opts.format ?? 'json';
  if (format !== 'json' && format !== 'text') throw new Refused('--format must be json or text');
  const { events } = open(opts.log ?? DEFAULT_LOG);
  const result = summarise(events, { story: opts.story, epic: opts.epic });
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  const out = [`Servvia engineering-program telemetry: ${result.stories.length} story(ies)`];
  for (const s of result.stories) {
    out.push('', `Story ${s.story}${s.objectiveIds.length ? ` — ${s.objectiveIds.join(', ')}` : ''}`);
    for (const name of METRICS) {
      const m = s.metrics[name];
      out.push(`  ${name} = ${m.value === null ? 'unknown' : m.value} (${m.provenance}; ${m.basis})`);
    }
  }
  out.push('', `Program: first-pass rate ${result.program.firstPassRate.value ?? 'unknown'} over ${result.program.firstPassRate.n} story(ies)`);
  for (const name of METRICS.filter((n) => n !== 'firstPassVerdict')) {
    const p = result.program[name];
    out.push(`  ${name}: n=${p.n} median=${p.median ?? 'unknown'} p90=${p.p90 ?? 'unknown'} unknown=${p.unknown}`);
  }
  return `${out.join('\n')}\n`;
}

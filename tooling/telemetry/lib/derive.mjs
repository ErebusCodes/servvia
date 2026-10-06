// `derive`: facts re-computable from git and the evaluator's ledger and records, appended as derived
// events. Read-only towards the evaluator: the ledger must pass the evaluator's own verifyChain and each
// record must match the SHA-256 the ledger holds, or nothing is appended.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { verifyChain } from '../../evaluator/lib/controller.mjs';
import { matches } from '../../evaluator/lib/glob.mjs';
import { countTests } from '../../evaluator/lib/integrity.mjs';
import { DEFAULT_LOG, Refused, appendEvents, open, utc } from './log.mjs';
import { STORY_ID } from './record.mjs';

function gitReader(repo) {
  const run = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  const commit = (ref) => {
    try { return run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim(); } catch { throw new Refused(`${ref} is not a commit of ${repo}`); }
  };
  const time = (ref) => utc(run(['show', '-s', '--format=%cI', ref]).trim(), `the committer time of ${ref}`);
  const file = (ref, path) => { try { return run(['show', `${ref}:${path}`]); } catch { return null; } };
  const changed = (from, to) => run(['diff', '--name-only', from, to]).split('\n').filter(Boolean);
  const contains = (ancestor, descendant) => {
    try { execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' }); return true; } catch { return false; }
  };
  return { commit, time, file, changed, contains };
}

function testGrowth(git, anchor, candidate) {
  const policy = git.file(anchor, 'tooling/evaluator/policy.json');
  if (policy === null) throw new Refused(`tooling/evaluator/policy.json is missing at ${anchor}`);
  const globs = JSON.parse(policy).testFiles;
  return git.changed(anchor, candidate)
    .filter((path) => matches(path, globs))
    .reduce((sum, path) => sum + countTests(path, git.file(candidate, path)) - countTests(path, git.file(anchor, path)), 0);
}

export function derive(opts) {
  for (const option of ['repo', 'objective-id', 'story', 'state-dir', 'evidence-dir']) if (!opts[option]) throw new Refused(`derive needs --${option}`);
  if (!STORY_ID.test(opts.story)) throw new Refused('--story must be a story id such as 20.3');
  const path = opts.log ?? DEFAULT_LOG;
  const log = open(path);
  const objectiveId = opts['objective-id'];
  const ledgerFile = join(opts['state-dir'], objectiveId, 'ledger.json');
  if (!existsSync(ledgerFile)) throw new Refused(`there is no ledger at ${ledgerFile}`);
  let ledger;
  try { ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')); } catch { throw new Refused('the ledger is not valid JSON'); }
  if (ledger?.objectiveId !== objectiveId || !Array.isArray(ledger.versions) || !verifyChain(ledger)) {
    throw new Refused('the ledger does not verify (objective id, seal or hash chain)');
  }
  const git = gitReader(opts.repo);
  const found = [];
  let lastCandidate = null;
  for (const version of ledger.versions) {
    if (!version.iterations?.length) continue;
    const anchor = git.commit(version.anchorCommit);
    found.push({ type: 'frozen', at: git.time(anchor), refs: { anchor, baseline: git.commit(version.baseline) } });
    let parent = anchor;
    for (const iteration of version.iterations) {
      const recordFile = join(opts['evidence-dir'], objectiveId, `v${version.version}`, basename(iteration.evidenceDir), 'record.json');
      if (!existsSync(recordFile)) throw new Refused(`there is no evaluation record at ${recordFile}`);
      const bytes = readFileSync(recordFile);
      if (createHash('sha256').update(bytes).digest('hex') !== iteration.recordSha256) throw new Refused(`the record of iteration ${iteration.n} does not match the ledger`);
      const startedAt = utc(JSON.parse(bytes.toString('utf8')).evaluatedAt, 'the record evaluatedAt');
      const candidate = git.commit(iteration.candidate);
      found.push({ type: 'candidate', at: git.time(candidate), refs: { candidate, parent } });
      found.push({
        type: 'evaluated', at: utc(iteration.at, 'the ledger time'), value: iteration.n,
        refs: { candidate, decision: iteration.decision, record: iteration.recordSha256, startedAt, verdict: iteration.verdict },
      });
      parent = candidate;
    }
    found.push({ type: 'test-growth', at: git.time(parent), value: testGrowth(git, anchor, parent), refs: { anchor, candidate: parent } });
    lastCandidate = parent;
  }
  if (opts.integration !== undefined) {
    if (!lastCandidate) throw new Refused('the ledger records no candidate to integrate');
    const commit = git.commit(opts.integration);
    if (!git.contains(lastCandidate, commit)) throw new Refused(`${opts.integration} does not contain the candidate ${lastCandidate}`);
    found.push({ type: 'integrated', at: git.time(commit), refs: { candidate: lastCandidate, commit } });
  }
  const identity = (e) => JSON.stringify([e.story, e.objectiveId ?? null, e.type, Object.entries(e.refs ?? {}).sort()]);
  const present = new Set(log.events.map(identity));
  const fresh = found.map((e) => ({ ...e, story: opts.story, objectiveId, provenance: 'derived' })).filter((e) => !present.has(identity(e)));
  const written = appendEvents(path, log, fresh);
  return `derived ${found.length} event(s) for ${opts.story}; appended ${written.length}\n`;
}

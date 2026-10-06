#!/usr/bin/env node
// Servvia evaluator: judges one candidate commit against a frozen objective.
//
//   node tooling/evaluator/bin/evaluate.mjs \
//     --repo <path> --anchor-commit <sha> --objective <path> --objective-sha256 <hex> \
//     --candidate <sha> [--evidence-dir <dir>] [--node-modules <dir>] \
//     [--go-root <dir> --go-modcache <dir>] [--dotnet-root <dir> --nuget-packages <dir>] [--pg-bin <dir>] [--redis-bin <dir>]
//
// The anchor (commit, objective path, objective sha256) comes from the
// orchestrator's approval, never from the implementer. Run it from an export
// of the anchor commit (see README.md); it refuses to run if its own files
// differ from the anchor's tooling/evaluator.
//
// Exit codes: 0 PASS, 1 FAIL, 2 NEEDS_REVIEW, 3 INTEGRITY_VIOLATION, 4 HARNESS_ERROR.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluate } from '../lib/evaluate.mjs';

const EXIT = { PASS: 0, FAIL: 1, NEEDS_REVIEW: 2, INTEGRITY_VIOLATION: 3, HARNESS_ERROR: 4 };

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

const args = parse(process.argv.slice(2));
for (const required of ['repo', 'anchor-commit', 'objective', 'objective-sha256', 'candidate']) {
  if (!args[required]) {
    console.error(`missing --${required}`);
    process.exit(EXIT.HARNESS_ERROR);
  }
}

const record = await evaluate({
  repo: resolve(args.repo),
  anchor: { commit: args['anchor-commit'], objectivePath: args.objective, objectiveSha256: args['objective-sha256'] },
  candidate: args.candidate,
  evidenceRoot: resolve(args['evidence-dir'] ?? join(homedir(), '.servvia', 'evaluator-evidence')),
  tools: {
    nodeModules: args['node-modules'] && resolve(args['node-modules']),
    goRoot: args['go-root'] && resolve(args['go-root']),
    goModCache: args['go-modcache'] && resolve(args['go-modcache']),
    dotnetRoot: args['dotnet-root'] && resolve(args['dotnet-root']),
    nugetPackages: args['nuget-packages'] && resolve(args['nuget-packages']),
    pgBin: args['pg-bin'] ?? '/opt/homebrew/opt/postgresql@18/bin',
    redisBin: args['redis-bin'] ?? '/opt/homebrew/bin',
  },
});

console.log(JSON.stringify({
  verdict: record.verdict,
  objective: record.objective,
  candidate: record.candidate,
  reasons: record.verdictReasons,
  checks: (record.checks ?? []).map((c) => ({ id: c.id, exitCode: c.exitCode, counts: c.counts, flaky: c.flaky })),
  evidence: record.evidence,
}, null, 2));
process.exit(EXIT[record.verdict]);

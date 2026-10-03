import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Read-only git access. The evaluator reads commits by id from the object
 * store; it never reads a working tree, so a dirty checkout cannot influence
 * what is evaluated.
 */
const MAX = 1024 * 1024 * 1024;

export class GitError extends Error {}

function git(repo, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const res = spawnSync('git', ['-C', repo, ...args], {
    encoding: encoding === 'buffer' ? undefined : encoding,
    maxBuffer: MAX,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (res.status !== 0 && !allowFailure) {
    throw new GitError(`git ${args.join(' ')} failed: ${String(res.stderr).trim()}`);
  }
  return res;
}

export function resolveCommit(repo, rev) {
  const res = git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFailure: true });
  return res.status === 0 ? res.stdout.trim() : null;
}

export function isAncestor(repo, ancestor, descendant) {
  const res = git(repo, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  throw new GitError(`merge-base failed: ${String(res.stderr).trim()}`);
}

export function parents(repo, commit) {
  return git(repo, ['rev-list', '--parents', '-n', '1', commit]).stdout.trim().split(/\s+/).slice(1);
}

/** The bytes of `path` at `commit`, or null if it does not exist there. */
export function showFile(repo, commit, path) {
  const res = git(repo, ['cat-file', 'blob', `${commit}:${path}`], { allowFailure: true, encoding: 'buffer' });
  return res.status === 0 ? res.stdout : null;
}

export function treeId(repo, commit, path) {
  const res = git(repo, ['rev-parse', '--verify', '--quiet', `${commit}:${path}`], { allowFailure: true });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** path -> blob id for every file under `path` at `commit`. */
export function lsTree(repo, commit, path) {
  const out = git(repo, ['ls-tree', '-r', '-z', commit, '--', path]).stdout;
  const files = new Map();
  for (const entry of out.split('\0').filter(Boolean)) {
    const [meta, file] = entry.split('\t');
    files.set(file, meta.split(' ')[2]);
  }
  return files;
}

export function hashObject(repo, file) {
  return git(repo, ['hash-object', '--no-filters', file]).stdout.trim();
}

/** [{ status: 'A'|'M'|'D'|'T', path }] between two commits, renames as delete + add. */
export function changedPaths(repo, from, to) {
  const out = git(repo, ['diff', '--name-status', '--no-renames', '-z', from, to]).stdout;
  const parts = out.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < parts.length; i += 2) changes.push({ status: parts[i][0], path: parts[i + 1] });
  return changes;
}

/** Lines added to `path` between two commits (unified diff, no context). */
export function addedLines(repo, from, to, path) {
  const out = git(repo, ['diff', '-U0', '--no-color', from, to, '--', path]).stdout;
  return out
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

export function diffBytes(repo, from, to) {
  return git(repo, ['diff', '--binary', from, to], { encoding: 'buffer' }).stdout;
}

export function shortStat(repo, from, to) {
  return git(repo, ['diff', '--shortstat', from, to]).stdout.trim();
}

/** Writes the tree of `commit` (all of it, or `paths`) into `dest`. */
export function exportCommit(repo, commit, dest, paths = []) {
  const tar = git(repo, ['archive', '--format=tar', commit, ...paths], { encoding: 'buffer' }).stdout;
  const res = spawnSync('tar', ['-x', '-C', dest], { input: tar, maxBuffer: MAX });
  if (res.status !== 0) throw new GitError(`tar -x failed: ${String(res.stderr)}`);
}

export function gitVersion() {
  return execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
}

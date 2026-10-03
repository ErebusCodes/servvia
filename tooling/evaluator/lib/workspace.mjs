import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportCommit, showFile } from './git.mjs';

/**
 * A clean evaluation workspace: the tree of one commit (git archive), never a
 * working directory, so untracked files, local edits and ignored files such
 * as `.env` cannot be read. Dependencies come from an operator-supplied
 * node_modules root: each entry is linked, except npm workspace links (they
 * would resolve to another checkout's sources) and the entries listed in
 * `copy`, which are copied so code generation in the workspace (the Prisma
 * client) never writes outside it.
 */
export function createWorkspace({ repo, commit, dest, nodeModules, copy = ['@prisma/client'], overlay }) {
  mkdirSync(dest, { recursive: true });
  exportCommit(repo, commit, dest);
  if (overlay) {
    for (const path of overlay.paths) {
      const bytes = showFile(repo, overlay.commit, path);
      if (!bytes) continue;
      mkdirSync(join(dest, path, '..'), { recursive: true });
      writeFileSync(join(dest, path), bytes);
    }
  }
  if (nodeModules) linkNodeModules(nodeModules, join(dest, 'node_modules'), copy);
  return dest;
}

function linkNodeModules(src, dest, copy) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name === '.cache' || name === '.package-lock.json') continue;
    const from = join(src, name);
    if (name.startsWith('@') && lstatSync(from).isDirectory()) {
      mkdirSync(join(dest, name), { recursive: true });
      for (const sub of readdirSync(from)) placeEntry(join(from, sub), join(dest, name, sub), `${name}/${sub}`, copy);
      continue;
    }
    placeEntry(from, join(dest, name), name, copy);
  }
}

function placeEntry(from, to, name, copy) {
  if (existsSync(to)) return;
  const stat = lstatSync(from);
  if (stat.isSymbolicLink() && !name.startsWith('.bin')) return; // npm workspace link
  if (name === '.prisma') return; // generated per workspace
  if (copy.includes(name)) cpSync(from, to, { recursive: true });
  else symlinkSync(from, to);
}

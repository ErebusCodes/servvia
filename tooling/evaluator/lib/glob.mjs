/**
 * Minimal, dependency-free glob matching for repository-relative paths:
 * `**` (any number of segments), `*` (within a segment), `?` (one character).
 */
const cache = new Map();

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matches(path, globs) {
  return (globs ?? []).some((glob) => {
    if (!cache.has(glob)) cache.set(glob, globToRegExp(glob));
    return cache.get(glob).test(path);
  });
}

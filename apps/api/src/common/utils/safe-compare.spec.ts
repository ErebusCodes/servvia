import { safeCompare } from './safe-compare';

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('secret-value', 'secret-value')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(safeCompare('secret-value', 'secret-valuf')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(safeCompare('short', 'a-much-longer-value')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(safeCompare('', 'nonempty')).toBe(false);
  });
});

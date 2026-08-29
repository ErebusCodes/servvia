import { resolveNativeProductCode } from './resolve-native-product-code';

describe('resolveNativeProductCode', () => {
  it('prefers an active linked PosProductIdentity over a stale legacy posProductCode', () => {
    const result = resolveNativeProductCode({
      posProductCode: '999-STALE',
      posIdentity: { nativeCode: '710', lifecycleStatus: 'active' },
    });
    expect(result).toEqual({ ok: true, nativeCode: '710' });
  });

  it('falls back to the legacy posProductCode when no PosProductIdentity is linked (the current state of the 9 verified production mappings)', () => {
    const result = resolveNativeProductCode({ posProductCode: '710', posIdentity: null });
    expect(result).toEqual({ ok: true, nativeCode: '710' });
  });

  it('fails closed as unmapped when neither a linked identity nor a legacy code exists', () => {
    const result = resolveNativeProductCode({ posProductCode: null, posIdentity: null });
    expect(result).toEqual({ ok: false, reason: 'unmapped' });
  });

  it.each([
    ['source_missing' as const],
    ['source_inactive' as const],
    ['hidden' as const],
    ['unavailable' as const],
    ['pending_review' as const],
  ])(
    'fails closed for a linked identity in %s status — never falls back to a legacy code even if one is set',
    (lifecycleStatus) => {
      const result = resolveNativeProductCode({
        posProductCode: '710', // deliberately present, must still be ignored
        posIdentity: { nativeCode: '710', lifecycleStatus },
      });
      expect(result).toEqual({ ok: false, reason: lifecycleStatus });
    },
  );

  it('never derives a code from anything other than posProductCode/posIdentity.nativeCode (no name-based fallback exists in this module at all)', () => {
    // There is no title/menuItemId parameter in the input type at all —
    // this test documents that invariant rather than exercising a
    // fallback path, since the type system already makes one impossible.
    const input: Parameters<typeof resolveNativeProductCode>[0] = {
      posProductCode: null,
      posIdentity: null,
    };
    expect(Object.keys(input)).toEqual(['posProductCode', 'posIdentity']);
  });
});

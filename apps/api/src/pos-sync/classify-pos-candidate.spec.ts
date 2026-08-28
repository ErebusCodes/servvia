import { classifyPosCandidate, PosCandidateEvidence } from './classify-pos-candidate';

// Table-driven against this session's real, live-verified fixture set
// (DL-107 continuity) — regressions against these known-good historical
// judgments must fail loudly, not silently drift.
describe('classifyPosCandidate', () => {
  const base: PosCandidateEvidence = {
    hasAnyGridPlacement: false,
    hasVisibleGridPlacement: false,
    isDepartment41: false,
    hasDepartment41TwinSameDescription: false,
  };

  it('classifies a visible-grid item as high_confidence_active (e.g. Pesto Chicken Pizza/710, dept 33, visible grid)', () => {
    const result = classifyPosCandidate({
      ...base,
      hasAnyGridPlacement: true,
      hasVisibleGridPlacement: true,
    });
    expect(result.tier).toBe('high_confidence_active');
  });

  it("classifies Iskender Grill Chicken/20's exact real-world shape (on a grid, that button not Visible) as ambiguous, never excluded", () => {
    const result = classifyPosCandidate({
      ...base,
      hasAnyGridPlacement: true,
      hasVisibleGridPlacement: false,
    });
    expect(result.tier).toBe('ambiguous');
  });

  it("classifies Chicken Avocado Salad/663's exact real-world shape (no grid placement at all) as ambiguous, never excluded — absence of grid evidence is not exclusion evidence", () => {
    const result = classifyPosCandidate({
      ...base,
      hasAnyGridPlacement: false,
      hasVisibleGridPlacement: false,
    });
    expect(result.tier).toBe('ambiguous');
  });

  it('classifies a department-41 item with an identical-description twin as takeaway_duplicate (the proven, zero-counterexample rule)', () => {
    const result = classifyPosCandidate({
      ...base,
      isDepartment41: true,
      hasDepartment41TwinSameDescription: true,
      hasAnyGridPlacement: true,
      hasVisibleGridPlacement: true,
    });
    expect(result.tier).toBe('takeaway_duplicate');
  });

  it('classifies the Falafel 667/761 content-mismatch shape (department 41, no matching-description twin) as ambiguous, never auto-classified as a duplicate', () => {
    const result = classifyPosCandidate({
      ...base,
      isDepartment41: true,
      hasDepartment41TwinSameDescription: false,
    });
    expect(result.tier).toBe('ambiguous');
  });

  it('department-41 status takes precedence over grid placement — a dept-41 item with a matching twin is a duplicate even if it also sits on a visible grid', () => {
    const result = classifyPosCandidate({
      hasAnyGridPlacement: true,
      hasVisibleGridPlacement: true,
      isDepartment41: true,
      hasDepartment41TwinSameDescription: true,
    });
    expect(result.tier).toBe('takeaway_duplicate');
  });

  it('never returns operational_non_menu or inactive — both tiers are reserved, no evidence-backed detector exists for them yet', () => {
    const shapes: PosCandidateEvidence[] = [
      base,
      { ...base, hasAnyGridPlacement: true, hasVisibleGridPlacement: true },
      { ...base, isDepartment41: true, hasDepartment41TwinSameDescription: true },
      { ...base, isDepartment41: true, hasDepartment41TwinSameDescription: false },
    ];
    for (const shape of shapes) {
      const result = classifyPosCandidate(shape);
      expect(result.tier).not.toBe('operational_non_menu');
      expect(result.tier).not.toBe('inactive');
    }
  });

  it('always returns at least one human-readable reason', () => {
    const result = classifyPosCandidate(base);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(typeof result.reasons[0]).toBe('string');
  });
});

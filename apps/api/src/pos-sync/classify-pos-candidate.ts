import { PosCandidateConfidenceTier } from '@prisma/client';

/**
 * Raw signals gathered for one candidate StockItem during a sync pass.
 * Deliberately narrow — every field here was chosen because this session
 * found it either useful or explicitly proven useless against the real
 * live IdealPOS database (DL-107 continuity). Do not add a new signal
 * without the same live-evidence rigor: `Discontinue` and `SentOnline`
 * were both tested and are 100% one value across the entire 826-row live
 * catalog (confirmed non-diagnostic, not merely unused), and
 * `StockItems.Condiment` was tested and falsified as a modifier-exclusion
 * signal (793/826 rows flagged true, including 8 of the 9 known-good real
 * dine-in items) — none of the three are represented here.
 */
export interface PosCandidateEvidence {
  /** Any TouchscreenGridDetails row references this StockItem, regardless of that button's own Visible flag. */
  hasAnyGridPlacement: boolean;
  /** At least one such row has Visible=1. */
  hasVisibleGridPlacement: boolean;
  /** True when this candidate's StockItems.DepartmentCode is Department 41 ("Verdura Takeaway"). */
  isDepartment41: boolean;
  /**
   * True only when a non-Department-41 StockItem exists with an
   * IDENTICAL description — the proven, zero-counterexample "41 = takeaway
   * duplicate" direction (25+ pairs verified live). A department-41 item
   * whose only near-match has a genuinely different description (e.g. the
   * Falafel 667 "FALAFEL SALAD" vs 761 "FALAFEL SALAD/ PLATE" case) must
   * report this as false, not true — content differences are a
   * disqualifying signal, not noise to average over.
   */
  hasDepartment41TwinSameDescription: boolean;
}

export interface PosCandidateClassification {
  tier: PosCandidateConfidenceTier;
  reasons: string[];
}

/**
 * Pure, deterministic, advisory-only classification — mirrors
 * `apply-plu-mapping.ts`'s plan/apply split in spirit: this only ever
 * scores and sorts a review queue. It never sets
 * `PosProductIdentity.lifecycleStatus` to anything but `pending_review`,
 * and nothing here may cause an item to become customer-visible. A human
 * explicitly linking a `menuItemId` is the only path to that.
 *
 * The decision table below is derived directly from this session's live
 * evidence, not a generic heuristic: cross-checked against the 9
 * already-verified real mappings, grid placement was found to be strong
 * positive evidence but NOT reliable negative evidence (Iskender Grill
 * Chicken/20 sits on a grid button with Visible=0; Chicken Avocado
 * Salad/663 has no grid placement row at all — both proven-real). Absence
 * of grid evidence must never be treated as exclusion evidence.
 */
export function classifyPosCandidate(evidence: PosCandidateEvidence): PosCandidateClassification {
  const {
    hasAnyGridPlacement,
    hasVisibleGridPlacement,
    isDepartment41,
    hasDepartment41TwinSameDescription,
  } = evidence;

  if (isDepartment41) {
    if (hasDepartment41TwinSameDescription) {
      return {
        tier: 'takeaway_duplicate',
        reasons: [
          'Department 41 ("Verdura Takeaway") item with an identical-description twin outside department 41 — the proven dine-in/takeaway duplicate pattern.',
        ],
      };
    }
    return {
      tier: 'ambiguous',
      reasons: [
        'Department 41 ("Verdura Takeaway") item with no identical-description twin outside department 41 — content may genuinely differ (see the Falafel 667/761 precedent); requires human disambiguation, never auto-classified as a duplicate.',
      ],
    };
  }

  if (hasVisibleGridPlacement) {
    return {
      tier: 'high_confidence_active',
      reasons: ['Placed on a live IdealPOS touchscreen grid button with Visible=1.'],
    };
  }

  if (hasAnyGridPlacement) {
    return {
      tier: 'ambiguous',
      reasons: [
        'Placed on a live IdealPOS touchscreen grid, but that specific button is not marked Visible — proven real items exist in this exact state (e.g. Iskender Grill Chicken/20); absence of visibility is not treated as exclusion evidence.',
      ],
    };
  }

  return {
    tier: 'ambiguous',
    reasons: [
      'No touchscreen grid placement found for this item — proven real items exist with no grid placement at all (e.g. Chicken Avocado Salad/663, likely ordered via direct PLU/keyboard entry); absence of grid evidence is never treated as exclusion evidence.',
    ],
  };
}

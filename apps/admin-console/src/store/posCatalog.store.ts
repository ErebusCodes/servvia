import { create } from 'zustand';
import { api } from '../lib/api';

// Backs the POS Catalog Review page — the successor to running
// `apply-plu-mapping.ts` by hand. Talks only to `admin/pos-catalog/*`
// (apps/api/src/pos-sync/pos-catalog.controller.ts); never touches
// IdealPOS directly and never publishes anything automatically — linking
// only ever sets PosProductIdentity.menuItemId, it never changes a
// MenuItem's visibleChannels/isAvailable.

export type PosLifecycleStatus =
  | 'pending_review'
  | 'active'
  | 'hidden'
  | 'unavailable'
  | 'source_missing'
  | 'source_inactive';

export type PosConfidenceTier =
  | 'high_confidence_active'
  | 'likely_active'
  | 'ambiguous'
  | 'takeaway_duplicate'
  | 'operational_non_menu'
  | 'inactive';

export interface PosCandidateLinkedMenuItem {
  id: string;
  title: string;
  priceCents: number;
  category: { name: string } | null;
}

export interface PosCandidate {
  id: string;
  nativeCode: string;
  nativeDescription: string;
  lifecycleStatus: PosLifecycleStatus;
  confidenceTier: PosConfidenceTier | null;
  evidence: Record<string, unknown>;
  priceCentsFromPos: number | null;
  lastSyncedAt: string | null;
  descriptionDriftDetectedAt: string | null;
  menuItemId: string | null;
  menuItem: PosCandidateLinkedMenuItem | null;
}

export interface PosCatalogFilters {
  status?: PosLifecycleStatus;
  tier?: PosConfidenceTier;
}

interface PosCatalogState {
  candidates: PosCandidate[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Per-candidate action error, keyed by candidate id — surfaced inline
   *  next to that candidate's row rather than a single page-wide banner,
   *  since link/unlink are per-row actions. */
  actionErrors: Record<string, string>;
  actionPending: Record<string, boolean>;
  fetchCandidates: (filters?: PosCatalogFilters) => Promise<void>;
  link: (candidateId: string, menuItemId: string) => Promise<boolean>;
  unlink: (candidateId: string) => Promise<boolean>;
  clearActionError: (candidateId: string) => void;
}

export const usePosCatalogStore = create<PosCatalogState>((set) => ({
  candidates: [],
  loading: false,
  loaded: false,
  error: null,
  actionErrors: {},
  actionPending: {},

  fetchCandidates: async (filters) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get<PosCandidate[]>('/api/admin/pos-catalog/candidates', {
        params: { status: filters?.status, tier: filters?.tier },
      });
      set({ candidates: data, loading: false, loaded: true });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load the POS catalog from the server.',
      });
    }
  },

  link: async (candidateId, menuItemId) => {
    set((s) => ({ actionPending: { ...s.actionPending, [candidateId]: true } }));
    try {
      const { data } = await api.post<PosCandidate>(
        `/api/admin/pos-catalog/candidates/${candidateId}/link`,
        { menuItemId },
      );
      set((s) => ({
        candidates: s.candidates.map((c) => (c.id === candidateId ? data : c)),
        actionPending: { ...s.actionPending, [candidateId]: false },
        actionErrors: { ...s.actionErrors, [candidateId]: '' },
      }));
      return true;
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Failed to link this candidate.');
      set((s) => ({
        actionPending: { ...s.actionPending, [candidateId]: false },
        actionErrors: { ...s.actionErrors, [candidateId]: message },
      }));
      return false;
    }
  },

  unlink: async (candidateId) => {
    set((s) => ({ actionPending: { ...s.actionPending, [candidateId]: true } }));
    try {
      const { data } = await api.post<PosCandidate>(`/api/admin/pos-catalog/candidates/${candidateId}/unlink`);
      set((s) => ({
        candidates: s.candidates.map((c) => (c.id === candidateId ? data : c)),
        actionPending: { ...s.actionPending, [candidateId]: false },
        actionErrors: { ...s.actionErrors, [candidateId]: '' },
      }));
      return true;
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Failed to unlink this candidate.');
      set((s) => ({
        actionPending: { ...s.actionPending, [candidateId]: false },
        actionErrors: { ...s.actionErrors, [candidateId]: message },
      }));
      return false;
    }
  },

  clearActionError: (candidateId) => {
    set((s) => ({ actionErrors: { ...s.actionErrors, [candidateId]: '' } }));
  },
}));

import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock('../lib/api', () => ({ api: apiMock }));

const { usePosCatalogStore } = await import('./posCatalog.store');

function resetStore() {
  usePosCatalogStore.setState({
    candidates: [],
    loading: false,
    loaded: false,
    error: null,
    actionErrors: {},
    actionPending: {},
  });
  Object.values(apiMock).forEach((fn) => fn.mockReset());
}

const candidate = {
  id: 'candidate-1',
  nativeCode: '710',
  nativeDescription: 'PESTO CHICKEN PIZZA',
  lifecycleStatus: 'pending_review' as const,
  confidenceTier: 'high_confidence_active' as const,
  evidence: { hasVisibleGridPlacement: true },
  priceCentsFromPos: 2300,
  lastSyncedAt: '2026-08-28T00:00:00.000Z',
  descriptionDriftDetectedAt: null,
  menuItemId: null,
  menuItem: null,
};

describe('usePosCatalogStore', () => {
  afterEach(() => resetStore());

  it('fetchCandidates loads candidates and forwards status/tier filters as query params', async () => {
    apiMock.get.mockResolvedValue({ data: [candidate] });

    await usePosCatalogStore.getState().fetchCandidates({ status: 'pending_review', tier: 'ambiguous' });

    expect(apiMock.get).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates', {
      params: { status: 'pending_review', tier: 'ambiguous' },
    });
    const state = usePosCatalogStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.candidates).toEqual([candidate]);
  });

  it('fetchCandidates surfaces a real error instead of silently showing stale/empty data', async () => {
    apiMock.get.mockRejectedValue(new Error('network down'));

    await usePosCatalogStore.getState().fetchCandidates();

    const state = usePosCatalogStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.error).toBe('network down');
  });

  it('link posts only menuItemId — never touches visibleChannels/isAvailable (no automatic publishing)', async () => {
    apiMock.post.mockResolvedValue({ data: { ...candidate, menuItemId: 'item-1', lifecycleStatus: 'active' } });

    const ok = await usePosCatalogStore.getState().link('candidate-1', 'item-1');

    expect(ok).toBe(true);
    expect(apiMock.post).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates/candidate-1/link', {
      menuItemId: 'item-1',
    });
    const postedBody = apiMock.post.mock.calls[0][1];
    expect(Object.keys(postedBody)).toEqual(['menuItemId']);
  });

  it('link surfaces a per-candidate error and returns false on failure — no optimistic success', async () => {
    usePosCatalogStore.setState({ candidates: [candidate] });
    apiMock.post.mockRejectedValue({ response: { data: { message: 'already linked' } } });

    const ok = await usePosCatalogStore.getState().link('candidate-1', 'item-1');

    expect(ok).toBe(false);
    expect(usePosCatalogStore.getState().actionErrors['candidate-1']).toBe('already linked');
    // The candidate's stored state must be untouched — no client-side
    // optimistic mutation before the server actually confirms the link.
    expect(usePosCatalogStore.getState().candidates[0]).toEqual(candidate);
  });

  it('unlink posts to the unlink endpoint and updates the candidate on success', async () => {
    const linked = { ...candidate, menuItemId: 'item-1', lifecycleStatus: 'active' as const, menuItem: { id: 'item-1', title: 'Pesto Chicken Pizza', priceCents: 2350, category: null } };
    usePosCatalogStore.setState({ candidates: [linked] });
    apiMock.post.mockResolvedValue({ data: { ...candidate, menuItemId: null, lifecycleStatus: 'pending_review' } });

    const ok = await usePosCatalogStore.getState().unlink('candidate-1');

    expect(ok).toBe(true);
    expect(apiMock.post).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates/candidate-1/unlink');
    expect(usePosCatalogStore.getState().candidates[0].menuItemId).toBeNull();
  });

  it('unlink surfaces a per-candidate error and returns false on failure', async () => {
    usePosCatalogStore.setState({ candidates: [candidate] });
    apiMock.post.mockRejectedValue(new Error('network down'));

    const ok = await usePosCatalogStore.getState().unlink('candidate-1');

    expect(ok).toBe(false);
    expect(usePosCatalogStore.getState().actionErrors['candidate-1']).toBe('network down');
  });

  it('clearActionError resets only the named candidate\'s error', async () => {
    usePosCatalogStore.setState({ actionErrors: { 'candidate-1': 'boom', 'candidate-2': 'also boom' } });
    usePosCatalogStore.getState().clearActionError('candidate-1');
    expect(usePosCatalogStore.getState().actionErrors).toEqual({ 'candidate-1': '', 'candidate-2': 'also boom' });
  });
});

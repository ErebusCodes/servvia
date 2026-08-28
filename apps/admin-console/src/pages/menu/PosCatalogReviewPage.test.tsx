import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock('../../lib/api', () => ({ api: apiMock }));

const { usePosCatalogStore } = await import('../../store/posCatalog.store');
const { useMenuStore } = await import('../../store/menu.store');
const { PosCatalogReviewPage } = await import('./PosCatalogReviewPage');

const pendingCandidate = {
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

const linkedCandidate = {
  ...pendingCandidate,
  id: 'candidate-2',
  nativeCode: '704',
  lifecycleStatus: 'active' as const,
  menuItemId: 'item-1',
  menuItem: { id: 'item-1', title: "Za'atar Loaf", priceCents: 1300, category: { name: 'Fresh From The Oven' } },
};

const unlinkedMenuItem = {
  id: 'item-2',
  categoryId: 'cat-1',
  subCategory: null,
  title: 'Pesto Chicken Pizza',
  description: 'Wood-fired.',
  imageUrl: null,
  price: '23.5',
  nutritionalDetails: {},
  modifierGroups: [],
  isSpicy: false,
  isAvailable: true,
  sortOrder: 0,
  visibleChannels: [],
  isFeatured: false,
  posIdentity: null,
};

function seedMenuStore() {
  useMenuStore.setState({
    categories: [],
    items: [unlinkedMenuItem],
    loading: false,
    loaded: true,
    error: null,
    fetchMenu: vi.fn().mockResolvedValue(undefined),
  } as never);
}

beforeEach(() => {
  seedMenuStore();
  usePosCatalogStore.setState({
    candidates: [],
    loading: false,
    loaded: false,
    error: null,
    actionErrors: {},
    actionPending: {},
  });
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

afterEach(() => cleanup());

describe('PosCatalogReviewPage', () => {
  it('loads and renders candidates, defaulting to the pending_review filter', async () => {
    apiMock.get.mockResolvedValue({ data: [pendingCandidate] });

    render(<PosCatalogReviewPage />);

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates', {
        params: { status: 'pending_review', tier: undefined },
      }),
    );
    expect(await screen.findByText('710')).toBeInTheDocument();
    expect(screen.getByText('PESTO CHICKEN PIZZA')).toBeInTheDocument();
  });

  it('changing the status filter re-fetches with the new filter', async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    render(<PosCatalogReviewPage />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByDisplayValue('Pending review'), { target: { value: 'source_missing' } });

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenLastCalledWith('/api/admin/pos-catalog/candidates', {
        params: { status: 'source_missing', tier: undefined },
      }),
    );
  });

  it('an already-linked candidate shows its linked Verdura item and an Unlink action, not a Link action', async () => {
    apiMock.get.mockResolvedValue({ data: [linkedCandidate] });
    render(<PosCatalogReviewPage />);

    expect(await screen.findByText(/Linked to/)).toBeInTheDocument();
    expect(screen.getByText("Za'atar Loaf", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /link to a verdura item/i })).not.toBeInTheDocument();
  });

  it('linking requires an explicit confirmation step before the API call fires (no optimistic/one-click link)', async () => {
    apiMock.get.mockResolvedValue({ data: [pendingCandidate] });
    render(<PosCatalogReviewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /link to a verdura item/i }));
    expect(await screen.findByRole('dialog', { name: /link pos candidate/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Verdura menu item'), { target: { value: 'item-2' } });
    fireEvent.click(screen.getByRole('button', { name: /review & confirm link/i }));

    // Confirmation copy must appear before the API call — not fired on the first click.
    expect(await screen.findByText(/Confirm: link IdealPOS/)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();

    apiMock.post.mockResolvedValue({ data: { ...pendingCandidate, menuItemId: 'item-2', lifecycleStatus: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm link$/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates/candidate-1/link', {
        menuItemId: 'item-2',
      }),
    );
  });

  it('a link conflict (already-linked target) is shown inline in the modal, not swallowed', async () => {
    apiMock.get.mockResolvedValue({ data: [pendingCandidate] });
    apiMock.post.mockRejectedValue({
      response: { data: { message: 'MenuItem item-2 already has a PosProductIdentity' } },
    });
    render(<PosCatalogReviewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /link to a verdura item/i }));
    fireEvent.change(screen.getByLabelText('Verdura menu item'), { target: { value: 'item-2' } });
    fireEvent.click(screen.getByRole('button', { name: /review & confirm link/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm link$/i }));

    expect(await screen.findByText(/already has a PosProductIdentity/)).toBeInTheDocument();
    // Modal stays open on failure — no silent dismissal.
    expect(screen.getByRole('dialog', { name: /link pos candidate/i })).toBeInTheDocument();
  });

  it('unlinking requires explicit confirmation and warns about order-handoff impact before calling the API', async () => {
    apiMock.get.mockResolvedValue({ data: [linkedCandidate] });
    render(<PosCatalogReviewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /unlink/i }));
    const dialog = await screen.findByRole('dialog', { name: /unlink pos candidate/i });
    expect(within(dialog).getByText(/Order Tablet will not be able to send this item to the kitchen/)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();

    apiMock.post.mockResolvedValue({ data: { ...pendingCandidate, id: 'candidate-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^unlink$/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/admin/pos-catalog/candidates/candidate-2/unlink'),
    );
  });
});

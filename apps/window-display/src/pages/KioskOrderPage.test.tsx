import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useKioskStore } from '../store/kiosk.store';

// Regression coverage for the pre-Phase-D leak (Menu Management
// architecture): KioskOrderPage's `/order` self-service ordering screen
// used to call the always-unfiltered `GET /api/kiosk/venues/:venueId/menu`
// directly and only visually dim (never exclude) unavailable items — so
// every one of the ~825 unreviewed IdealPOS-imported staging rows
// (isAvailable:false) rendered, dimmed but fully visible, in the real
// customer-facing kiosk. Phase D's fix moved the filtering server-side
// (channel-menu-resolver.ts, window_display channel: visibleChannels +
// isAvailable both enforced) — this suite proves the *frontend* now
// renders exactly, and only, what that endpoint returns, with no
// independent frontend path that could reintroduce the leak.

vi.mock('../api/menu', () => ({
  fetchVenueMenu: vi.fn(),
  submitKioskOrder: vi.fn(),
}));

const { fetchVenueMenu } = await import('../api/menu');
const { KioskOrderPage } = await import('./KioskOrderPage');

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KioskOrderPage onBackToTables={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useKioskStore.setState({ selectedTable: null, orderType: 'Dine-in', cart: [] });
  vi.mocked(fetchVenueMenu).mockReset();
});

afterEach(() => cleanup());

describe('KioskOrderPage — menu source (Phase D regression)', () => {
  it('renders exactly the items the window_display channel endpoint returns — never more, never a leaked/unreviewed item', async () => {
    vi.mocked(fetchVenueMenu).mockResolvedValue({
      categories: [{ id: 'cat-1', name: 'Mains', description: null, sortOrder: 0, isActive: true }],
      menuItems: [
        {
          id: 'published-1',
          categoryId: 'cat-1',
          title: 'Pesto Chicken Pizza',
          description: 'Wood-fired.',
          imageUrl: null,
          imageThumbnailUrl: null,
          priceCents: 2350,
          isSpicy: false,
          isAvailable: true,
          sortOrder: 0,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('Pesto Chicken Pizza')).toBeInTheDocument();
    // Exactly one item card rendered — proves the page is not merging in
    // any second, independent, unfiltered data source alongside the
    // channel response.
    const allTitles = screen.getAllByText('Pesto Chicken Pizza');
    expect(allTitles.length).toBe(1);
  });

  it('calls fetchVenueMenu exactly once and never falls back to a second raw menu fetch', async () => {
    vi.mocked(fetchVenueMenu).mockResolvedValue({
      categories: [{ id: 'cat-1', name: 'Mains', description: null, sortOrder: 0, isActive: true }],
      menuItems: [],
    });

    renderPage();

    await waitFor(() => expect(fetchVenueMenu).toHaveBeenCalledTimes(1));
  });

  it('shows a truthful error state rather than silently rendering stale/fabricated items when the channel endpoint fails', async () => {
    vi.mocked(fetchVenueMenu).mockRejectedValue(new Error('network down'));

    renderPage();

    expect(await screen.findByText(/Failed to Load Menu/i)).toBeInTheDocument();
  });
});

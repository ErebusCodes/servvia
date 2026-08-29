import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVenueMenu } from './menu';

// Phase D (Menu Management architecture): this is the structural fix for
// the pre-Phase-D leak where fetchVenueMenu hit the always-unfiltered
// GET /api/kiosk/venues/:venueId/menu directly, and KioskOrderPage.tsx
// only visually dimmed (never excluded) unavailable/staging rows — see
// KioskOrderPage.test.tsx for the full render-level regression proof.

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('fetchVenueMenu', () => {
  it('calls the canonical window_display channel endpoint, never the old raw kiosk endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ categories: [], menuItems: [] }),
    });

    await fetchVenueMenu('venue-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/menu/venues/venue-1/channel/window_display');
    expect(calledUrl).not.toContain('/api/kiosk/');
  });

  it('throws on a non-ok response rather than silently returning nothing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchVenueMenu('venue-1')).rejects.toThrow('Failed to fetch menu: 500');
  });
});

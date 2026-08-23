import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useLiveOrders, liveOrdersQueryKey } from './orders';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

// Regression coverage for a real defect found during story 15-1's
// independent review: an unelevated standalone Order Tablet's floor screen
// called useLiveOrders() unconditionally, which always fetched
// GET /api/admin/orders — a staff-only endpoint (RolesGuard requires
// admin/manager/cashier/kitchen) that 403s for a bare device token (role
// `viewer`). Restricted-mode order *viewing* must route through the
// purpose-built GET /api/tablet/orders instead, mirroring the endpoint
// split order *creation* already had.
describe('useLiveOrders — restricted vs. staff endpoint routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }));
  });

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it('defaults to GET /api/admin/orders (staff/KDS/admin Orders page — unchanged behavior)', async () => {
    renderHook(() => useLiveOrders(), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('/api/admin/orders');
    expect(String(url)).not.toContain('/api/tablet/orders');
  });

  it('routes through GET /api/tablet/orders when restrictedEndpoint is true (unelevated standalone tablet)', async () => {
    renderHook(() => useLiveOrders({ restrictedEndpoint: true }), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('/api/tablet/orders');
  });

  it('gives the restricted and staff variants distinct query cache keys, so switching between them (staff elevation/lock) always refetches rather than serving the other variant\'s stale data', () => {
    expect(liveOrdersQueryKey(true)).not.toEqual(liveOrdersQueryKey(false));
    expect(liveOrdersQueryKey()).toEqual(liveOrdersQueryKey(false));
  });
});

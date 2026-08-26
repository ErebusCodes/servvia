import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useLiveOrders, liveOrdersQueryKey } from './orders';
import { useAuthStore } from '../store/auth.store';

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

// Regression coverage for the 2026-08-26/27 DUNEDIN Order Tablet incident:
// a real staff submission produced no backend Order/POSSyncRecord/
// ConnectorCommand row and no Bridge traffic whatsoever, yet the UI showed
// "This table already has an order being prepared." for a stale, no-longer-
// real order (ORD-601017). Root cause: once the orders query's background
// refetch started failing (session expiry, 401), React Query's default
// behavior kept serving the last-successful `data` forever, and callers
// (OrderTabletPage's duplicate-order guard, its createdOrderRef resync
// effect) had no way to tell that data was no longer trustworthy — so they
// kept treating a dead session's stale cache as current truth. Also: the
// Order Tablet's hand-rolled fetch() calls never went through api.ts's
// axios instance, so they never benefited from its existing "401 clears
// the session" interceptor either — clearAuthOnUnauthorized closes that gap
// without inventing a second auth mechanism.
describe('useLiveOrders — ordersDataIsAuthoritative (2026-08-26/27 stale-cache incident)', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  beforeEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it('is true once the initial fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const { result } = renderHook(() => useLiveOrders(), { wrapper });
    await waitFor(() => expect(result.current.ordersDataIsAuthoritative).toBe(true));
  });

  it('is false — not merely "data present" — once a refetch fails, even though the last-known data (a stale active order) is still sitting in the cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'ORD-601017', tableNumber: '3', status: 'confirmed' }],
      })
      .mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useLiveOrders(), { wrapper: localWrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.ordersDataIsAuthoritative).toBe(true);

    // A failed background refetch must not be indistinguishable from a
    // healthy, merely-unchanged cache — this is the exact defect: the
    // stale order stays in `data`, but it must no longer count as
    // authoritative.
    await result.current.refetch();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toHaveLength(1); // React Query's real default: stale data lingers
    expect(result.current.ordersDataIsAuthoritative).toBe(false);
  });

  it('clears the active staff session on a 401 — mirrors api.ts\'s axios interceptor for these hand-rolled fetch() calls, which never went through it', async () => {
    useAuthStore.getState().setAuth('a-real-looking-token', { id: 's1', email: 'owner@verdura.co.nz', role: 'owner' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const { result } = renderHook(() => useLiveOrders(), { wrapper });
    // useLiveOrders hardcodes retry: 1 regardless of the QueryClient's own
    // defaults, so this must clear real backoff delay before settling.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });

    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('returns to true once a subsequent fetch succeeds after re-authentication — no manual invalidation needed', async () => {
    // useLiveOrders hardcodes retry: 1, so the initial attempt's automatic
    // retry also needs to fail before this settles into isError — only the
    // later manual refetch() below should see success.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useLiveOrders(), { wrapper: localWrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.ordersDataIsAuthoritative).toBe(false);

    await result.current.refetch();
    await waitFor(() => expect(result.current.ordersDataIsAuthoritative).toBe(true));
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBootstrapAuth } from './useBootstrapAuth';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
}));

function fakeJwt(claims: Record<string, unknown>): string {
  const base64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(claims))}.`;
}

describe('useBootstrapAuth', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    useAuthStore.setState({ accessToken: null, user: null });
    localStorage.clear();
    vi.mocked(api.post).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('silently restores the session when the refresh cookie is valid', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { accessToken: fakeJwt({ sub: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' }) },
    });

    const { result } = renderHook(() => useBootstrapAuth());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.post).toHaveBeenCalledWith('/api/auth/refresh', undefined, expect.anything());
    expect(useAuthStore.getState().accessToken).not.toBeNull();
    expect(useAuthStore.getState().user?.email).toBe('owner@verdura.co.nz');
  });

  it('does not auto-authenticate when there is no valid session — leaves auth cleared', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 401 } });

    const { result } = renderHook(() => useBootstrapAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('skips the refresh call entirely when a session already exists', () => {
    useAuthStore.setState({
      accessToken: 'existing-token',
      user: { id: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' },
    });

    const { result } = renderHook(() => useBootstrapAuth());

    expect(result.current.isLoading).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  // Regression coverage for the Admin Menu Management "401 on load" bug:
  // isLoading used to start `false` in DEV specifically, so App.tsx rendered
  // protected routes (and their eager fetchMenu()-on-mount calls) before
  // this hook's silent refresh had a chance to populate accessToken — a
  // race that could send an unauthenticated request even for a user with a
  // valid session, purely because of which promise happened to resolve
  // first. isLoading must block identically in DEV and PROD.
  describe('in development mode', () => {
    beforeEach(() => {
      vi.stubEnv('DEV', true);
    });

    it('still starts loading (blocking route render) when no session is cached, same as production', () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { accessToken: fakeJwt({ sub: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' }) },
      });

      const { result } = renderHook(() => useBootstrapAuth());

      // This is the exact invariant DEV mode used to violate: a consumer
      // (App.tsx) reading isLoading synchronously on first render must see
      // `true` here, not `false` — otherwise it renders routes (and their
      // eager data fetches) before the silent refresh below has resolved.
      expect(result.current.isLoading).toBe(true);
      expect(useAuthStore.getState().accessToken).toBeNull();
    });

    it('resolves isLoading only after the refresh call settles, and the token is set before that', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { accessToken: fakeJwt({ sub: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' }) },
      });

      const { result } = renderHook(() => useBootstrapAuth());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // By the time isLoading flips false, accessToken must already be
      // populated — a consumer gated on isLoading can safely fire an
      // authenticated request the instant it renders.
      expect(useAuthStore.getState().accessToken).not.toBeNull();
    });
  });
});

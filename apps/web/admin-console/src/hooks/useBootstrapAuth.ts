import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';
import { decodeJwtPayload } from '../lib/decodeJwt';

interface RefreshTokenClaims {
  sub: string;
  email: string;
  role: string;
}

/**
 * On app load, silently attempts to restore a session from the httpOnly
 * refresh-token cookie (POST /api/auth/refresh) — matching the documented
 * design (see 2-6-admin-login-page.md AC10: "a silent POST /api/auth/refresh
 * is attempted... if it succeeds the access token is stored and the user
 * bypasses the login page. If it fails (401) the user is redirected to
 * dashboard which displays the unauthenticated state").
 *
 * This intentionally does NOT auto-authenticate with any credentials of its
 * own — an unauthenticated visitor with no prior session gets nothing, and
 * ProtectedRoute renders the AccessUnavailable view.
 */
export function useBootstrapAuth(): { isLoading: boolean } {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  // Must NOT special-case DEV here: the effect below fires its silent
  // POST /api/auth/refresh regardless of DEV/PROD, but a DEV-only "start
  // not-loading" meant App.tsx rendered protected routes immediately,
  // before that refresh resolved. A page with an eager fetch-on-mount
  // (e.g. MenuManagementPage's fetchMenu()) could then race ahead of the
  // refresh and send its request with no Authorization header yet — the
  // backend correctly 401s a genuinely unauthenticated request, even
  // though the user had a valid session that would have restored a moment
  // later. Matching PROD's block-until-resolved behavior in DEV too closes
  // that race entirely.
  const [isLoading, setIsLoading] = useState(!accessToken);

  useEffect(() => {
    if (accessToken) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    api
      .post('/api/auth/refresh', undefined, { signal: controller.signal })
      .then(({ data }) => {
        const claims = decodeJwtPayload<RefreshTokenClaims>(data.accessToken);
        setAuth(data.accessToken, {
          id: claims?.sub ?? '',
          email: claims?.email ?? '',
          role: claims?.role ?? '',
        });
      })
      .catch(() => {
        // No valid session cookie (or refresh failed) — clear any stale
        // state and let ProtectedRoute render the AccessUnavailable screen.
        clearAuth();
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isLoading };
}

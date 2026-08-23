import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { decodeJwtPayload } from '../lib/decodeJwt';

interface KdsDeviceAuthState {
  accessToken: string | null;
  venueId: string | null;
  expiresAt: number | null;
  setToken: (accessToken: string, venueId: string) => void;
  clear: () => void;
}

/**
 * Venue-scoped device token for this unattended kitchen-display terminal
 * (docs/ux.md "PIN entry on first load — no full staff login").
 */
export const useKdsDeviceAuthStore = create<KdsDeviceAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      venueId: null,
      expiresAt: null,
      setToken: (accessToken, venueId) => {
        const claims = decodeJwtPayload<{ exp?: number }>(accessToken);
        const expiresAt = claims?.exp ? claims.exp * 1000 : null;
        set({ accessToken, venueId, expiresAt });
      },
      clear: () => set({ accessToken: null, venueId: null, expiresAt: null }),
    }),
    { name: 'kds-device-auth-storage' },
  ),
);

export function isKdsDeviceTokenValid(state: KdsDeviceAuthState, forVenueId: string): boolean {
  return (
    !!state.accessToken &&
    state.venueId === forVenueId &&
    !!state.expiresAt &&
    state.expiresAt > Date.now()
  );
}

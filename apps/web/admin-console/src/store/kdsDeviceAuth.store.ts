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
 * Holds the venue-scoped device token for an unattended KDS/tablet
 * terminal (see docs/ux.md "PIN entry on first load — no full staff
 * login"). This is a device credential, not a staff session — it is kept
 * separate from useAuthStore so a KDS terminal never carries staff-level
 * privileges.
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

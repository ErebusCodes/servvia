import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { decodeJwtPayload } from '../lib/decodeJwt';

interface StaffElevationClaims {
  sub: string;
  exp?: number;
}

interface TabletDeviceAuthState {
  // Device identity — persisted (localStorage), matching the existing
  // KDS device-token precedent: an unattended terminal must survive a
  // reload without re-enrolling. Revocation is still re-checked live by
  // the server on every request (TabletDeviceGuard) — this persisted
  // token is a convenience, never the actual security boundary.
  deviceToken: string | null;
  deviceId: string | null;
  venueId: string | null;
  deviceLabel: string | null;
  setDevice: (deviceToken: string, deviceId: string, venueId: string, label: string) => void;
  clearDevice: () => void;

  // Named staff elevation — deliberately memory-only, never persisted.
  // Story 15-1 (DL-081): "browser reload must restore only valid,
  // unexpired state" — the safest reading of that is that a reload always
  // returns to restricted mode and requires re-entering a staff PIN,
  // rather than risking a stale elevated session surviving an accidental
  // refresh.
  staffToken: string | null;
  staffName: string | null;
  staffRole: string | null;
  staffElevatedUntil: number | null; // epoch ms, from the token's own exp claim
  setStaffElevation: (token: string, name: string, role: string) => void;
  clearStaffElevation: () => void;

  // Manager step-up — same memory-only rule, even shorter-lived.
  managerToken: string | null;
  managerName: string | null;
  managerElevatedUntil: number | null;
  setManagerStepUp: (token: string, name: string) => void;
  clearManagerStepUp: () => void;
}

function expiryOf(token: string): number | null {
  const claims = decodeJwtPayload<StaffElevationClaims>(token);
  return claims?.exp ? claims.exp * 1000 : null;
}

export const useTabletDeviceAuthStore = create<TabletDeviceAuthState>()(
  persist(
    (set) => ({
      deviceToken: null,
      deviceId: null,
      venueId: null,
      deviceLabel: null,
      setDevice: (deviceToken, deviceId, venueId, deviceLabel) =>
        set({ deviceToken, deviceId, venueId, deviceLabel }),
      clearDevice: () =>
        set({
          deviceToken: null,
          deviceId: null,
          venueId: null,
          deviceLabel: null,
          staffToken: null,
          staffName: null,
          staffRole: null,
          staffElevatedUntil: null,
          managerToken: null,
          managerName: null,
          managerElevatedUntil: null,
        }),

      staffToken: null,
      staffName: null,
      staffRole: null,
      staffElevatedUntil: null,
      setStaffElevation: (token, name, role) =>
        set({ staffToken: token, staffName: name, staffRole: role, staffElevatedUntil: expiryOf(token) }),
      clearStaffElevation: () =>
        set({
          staffToken: null,
          staffName: null,
          staffRole: null,
          staffElevatedUntil: null,
          // Manager step-up never outlives the staff session it was
          // granted under.
          managerToken: null,
          managerName: null,
          managerElevatedUntil: null,
        }),

      managerToken: null,
      managerName: null,
      managerElevatedUntil: null,
      setManagerStepUp: (token, name) =>
        set({ managerToken: token, managerName: name, managerElevatedUntil: expiryOf(token) }),
      clearManagerStepUp: () => set({ managerToken: null, managerName: null, managerElevatedUntil: null }),
    }),
    {
      name: 'tablet-device-auth-storage',
      // Only the device identity persists — see the memory-only comments
      // above for why staff/manager elevation must not be included here.
      partialize: (state) => ({
        deviceToken: state.deviceToken,
        deviceId: state.deviceId,
        venueId: state.venueId,
        deviceLabel: state.deviceLabel,
      }),
    },
  ),
);

export function isDeviceEnrolled(state: TabletDeviceAuthState): boolean {
  return !!state.deviceToken && !!state.deviceId;
}

export function isStaffElevated(state: TabletDeviceAuthState): boolean {
  return !!state.staffToken && !!state.staffElevatedUntil && state.staffElevatedUntil > Date.now();
}

export function isManagerSteppedUp(state: TabletDeviceAuthState): boolean {
  return !!state.managerToken && !!state.managerElevatedUntil && state.managerElevatedUntil > Date.now();
}

/** The single Bearer token to send for the current authority level — manager > staff > device. */
export function activeTabletToken(state: TabletDeviceAuthState): string | undefined {
  if (isManagerSteppedUp(state)) return state.managerToken!;
  if (isStaffElevated(state)) return state.staffToken!;
  if (isDeviceEnrolled(state)) return state.deviceToken!;
  return undefined;
}

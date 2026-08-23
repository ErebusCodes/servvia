import { create } from 'zustand';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

// Access tokens are deliberately memory-only. The httpOnly refresh cookie is
// the durable session mechanism; useBootstrapAuth restores a fresh access
// token after reload without exposing it to localStorage-based XSS theft.
// Remove credentials written by older builds during migration.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('auth-storage');
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  setAuth: (token, user) => set({ accessToken: token, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));

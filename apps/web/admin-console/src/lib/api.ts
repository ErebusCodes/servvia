import axios from 'axios';
import { useAuthStore } from '../store/auth.store';

export const api = axios.create({
  // Empty baseURL: Vite dev proxy forwards /api/* to the API server.
  // In production, VITE_API_URL is set and requests go directly.
  baseURL: import.meta.env['VITE_API_URL'] ?? '',
  withCredentials: true,
  xsrfCookieName: 'csrf_token',
  xsrfHeaderName: 'x-csrf-token',
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// An expired/invalid session must not linger client-side: clear it so
// ProtectedRoute renders the AccessUnavailable component on the next render, rather than
// silently retrying with a dead token.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      useAuthStore.getState().clearAuth();
    }
    return Promise.reject(error);
  },
);

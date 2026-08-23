import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '../../store/auth.store';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  describe('in production mode', () => {
    beforeEach(() => {
      // In production mode, DEV environment variable is false/undefined
      vi.stubEnv('DEV', false);
      useAuthStore.setState({ accessToken: null, user: null });
      localStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('renders the admin PIN gate for an unauthenticated user', () => {
      renderAt('/dashboard');
      expect(screen.getByText('Operations Console')).toBeInTheDocument();
      expect(screen.getByLabelText('Admin PIN')).toBeInTheDocument();
      expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    });

    it('renders the protected route for an authenticated user', () => {
      useAuthStore.setState({
        accessToken: 'a-valid-looking-access-token',
        user: { id: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' },
      });
      renderAt('/dashboard');
      expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
      expect(screen.queryByText('Operations Console')).not.toBeInTheDocument();
    });

    it('does not grant access merely because an empty token is stored', () => {
      useAuthStore.setState({ accessToken: '', user: null });
      renderAt('/dashboard');
      expect(screen.getByText('Operations Console')).toBeInTheDocument();
    });
  });

  describe('in development mode', () => {
    beforeEach(() => {
      vi.stubEnv('DEV', true);
      useAuthStore.setState({ accessToken: null, user: null });
      localStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('still requires the admin PIN when unauthenticated', () => {
      renderAt('/dashboard');
      expect(screen.getByText('Operations Console')).toBeInTheDocument();
      expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    });

    it('renders the protected route directly when authenticated', () => {
      useAuthStore.setState({
        accessToken: 'a-valid-looking-access-token',
        user: { id: 'staff-1', email: 'owner@verdura.co.nz', role: 'owner' },
      });
      renderAt('/dashboard');
      expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
      expect(screen.queryByText('Operations Console')).not.toBeInTheDocument();
    });
  });
});

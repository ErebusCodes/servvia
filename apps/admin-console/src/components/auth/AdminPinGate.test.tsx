import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPinGate } from './AdminPinGate';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));

describe('AdminPinGate', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    useAuthStore.setState({ accessToken: null, user: null });
    localStorage.clear();
  });

  it('exchanges PIN 108 for the existing admin auth state', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        accessToken: 'staff-access-token',
        user: { id: 'staff-1', email: 'owner@verdura.co.nz', name: 'Owner', role: 'owner' },
      },
    });
    render(<AdminPinGate />);

    fireEvent.change(screen.getByLabelText('Admin PIN'), { target: { value: '108' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Console' }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('staff-access-token'));
    expect(api.post).toHaveBeenCalledWith('/api/auth/admin-pin', { pin: '108' });
  });

  it('shows an error and leaves auth empty when the PIN is rejected', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 401 } });
    render(<AdminPinGate />);

    fireEvent.change(screen.getByLabelText('Admin PIN'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Console' }));

    expect(await screen.findByText('Incorrect PIN.')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

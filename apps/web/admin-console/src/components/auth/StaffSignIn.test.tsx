import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StaffSignIn } from './StaffSignIn';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));

function signIn(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('StaffSignIn (Story 2.4)', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it('signs a named staff member in through the staff login', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        accessToken: 'staff-access-token',
        user: { id: 'staff-1', email: 'owner@example.com', name: 'Owner', role: 'owner' },
      },
    });
    render(<StaffSignIn />);
    signIn(' owner@example.com ', 'a long staff password');

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('staff-access-token'));
    expect(api.post).toHaveBeenCalledWith('/api/auth/login', {
      email: 'owner@example.com',
      password: 'a long staff password',
    });
    expect(useAuthStore.getState().user?.email).toBe('owner@example.com');
  });

  it('never calls the removed shared-PIN endpoint, and offers no PIN field', () => {
    render(<StaffSignIn />);
    expect(screen.queryByLabelText(/PIN/i)).not.toBeInTheDocument();
    signIn('owner@example.com', 'x');
    expect(api.post).not.toHaveBeenCalledWith('/api/auth/admin-pin', expect.anything());
  });

  it('gives one message for every refused sign-in and clears the password', async () => {
    for (const status of [401, 400]) {
      vi.mocked(api.post).mockRejectedValueOnce({ response: { status } });
      const view = render(<StaffSignIn />);
      signIn('owner@example.com', 'wrong password');
      expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toHaveValue('');
      expect(useAuthStore.getState().accessToken).toBeNull();
      view.unmount();
    }
  });

  it('tells a throttled user when to try again, and an unreachable server apart', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 429 } });
    const view = render(<StaffSignIn />);
    signIn('owner@example.com', 'x');
    expect(await screen.findByText('Too many attempts. Try again in 15 minutes.')).toBeInTheDocument();
    view.unmount();

    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network Error'));
    render(<StaffSignIn />);
    signIn('owner@example.com', 'x');
    expect(await screen.findByText('Could not reach the server. Please try again.')).toBeInTheDocument();
  });

  it('links to the setup page for someone holding a setup code', () => {
    render(<StaffSignIn />);
    expect(screen.getByRole('link', { name: 'Set your password' })).toHaveAttribute(
      'href',
      '/setup-credential',
    );
  });
});

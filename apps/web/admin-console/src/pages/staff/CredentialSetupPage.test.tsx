import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CredentialSetupPage } from './CredentialSetupPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));

function fill(code: string, password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
}

describe('CredentialSetupPage (Story 8.1)', () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it('sets the password with the code', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: undefined });
    render(<CredentialSetupPage />);
    fill(' id.secret ', 'a long new password');
    expect(await screen.findByText('Your password is set. You can now sign in.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/auth/credential-setup', {
      code: 'id.secret',
      password: 'a long new password',
    });
  });

  it('checks length and confirmation before sending anything', () => {
    render(<CredentialSetupPage />);
    fill('id.secret', 'short');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 12 characters');
    fill('id.secret', 'a long new password', 'a different password');
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('gives one generic answer for a refused code', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 401 } });
    render(<CredentialSetupPage />);
    fill('id.wrong', 'a long new password');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  });
});

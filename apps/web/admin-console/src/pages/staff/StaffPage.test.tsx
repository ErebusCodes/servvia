import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StaffPage, type StaffAccount } from './StaffPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const venue = { id: 'venue-1', name: 'Auckland' };
const waiter: StaffAccount = {
  id: 'staff-1',
  name: 'Wendy Waiter',
  email: 'wendy@example.test',
  role: 'cashier',
  isActive: true,
  hasTabletPin: false,
  venueIds: ['venue-1'],
  pendingCredentialSetup: false,
  lastLoginAt: null,
};

function mockLoad(staff: StaffAccount[]) {
  vi.mocked(api.get).mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/api/venues' ? [venue] : staff }),
  );
}

describe('StaffPage (Story 8.1)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoad([waiter]);
  });

  it('lists real staff accounts from the API, not mock data', async () => {
    render(<StaffPage />);
    expect(await screen.findByText('Wendy Waiter')).toBeInTheDocument();
    expect(screen.getByText('wendy@example.test')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/admin/staff');
    expect(screen.queryByText('John Carter')).not.toBeInTheDocument();
  });

  it('creates an account and shows its setup code once', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        staff: { ...waiter, id: 'staff-2', name: 'New Cook' },
        credentialSetup: { code: 'token-id.secret', expiresAt: '2026-10-04T00:00:00Z' },
      },
    });
    render(<StaffPage />);
    await screen.findByText('Wendy Waiter');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Cook' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'cook@example.test' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'kitchen' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auckland' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));

    const issued = await screen.findByTestId('issued-code');
    expect(within(issued).getByText('token-id.secret')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/admin/staff', {
      name: 'New Cook',
      email: 'cook@example.test',
      role: 'kitchen',
      venueIds: ['venue-1'],
    });
    fireEvent.click(within(issued).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('token-id.secret')).not.toBeInTheDocument();
  });

  it('shows the API’s refusal instead of pretending a change worked', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 403, data: { message: 'You may not administer a staff member with this role' } },
    });
    render(<StaffPage />);
    const row = await screen.findByTestId('staff-staff-1');
    fireEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You may not administer a staff member with this role',
    );
  });

  it('changes roles, venue access and status through the API', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    render(<StaffPage />);
    const row = await screen.findByTestId('staff-staff-1');
    fireEvent.change(within(row).getByLabelText('Role of Wendy Waiter'), { target: { value: 'manager' } });
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/admin/staff/staff-1', { role: 'manager' }),
    );
    fireEvent.click(within(row).getByLabelText('Auckland access for Wendy Waiter'));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/api/admin/staff/staff-1/venues/venue-1'),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/admin/staff/staff-1/deactivate'));
  });

  it('removes only after an explicit confirmation', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    render(<StaffPage />);
    const row = await screen.findByTestId('staff-staff-1');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/admin/staff/staff-1'));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TabletDeviceGate } from './TabletDeviceGate';
import { useTabletDeviceAuthStore } from '../../store/tabletDeviceAuth.store';

function resetStore() {
  useTabletDeviceAuthStore.setState({
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
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetStore();
});

describe('TabletDeviceGate', () => {
  it('shows the enrollment screen when no device is enrolled, and never renders children', () => {
    render(
      <TabletDeviceGate>
        <div data-testid="protected-content">restricted content</div>
      </TabletDeviceGate>,
    );
    expect(screen.getByPlaceholderText('Enrollment code')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('enrolling with a valid code stores the device token and shows the unlock screen next, not children directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deviceId: 'device-1', deviceToken: 'real.device.token', venueId: 'venue-1', label: 'Tablet 1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TabletDeviceGate>
        <div data-testid="protected-content">restricted content</div>
      </TabletDeviceGate>,
    );

    fireEvent.change(screen.getByPlaceholderText('Enrollment code'), { target: { value: 'enroll-1.somecode' } });
    fireEvent.click(screen.getByRole('button', { name: /enroll this device/i }));

    await waitFor(() => expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument());
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(useTabletDeviceAuthStore.getState().deviceId).toBe('device-1');

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/api/tablet/enroll');
  });

  it('shows the unlock screen for an already-enrolled device, and rejects an incorrect PIN without unlocking', async () => {
    useTabletDeviceAuthStore.setState({ deviceToken: 'real.device.token', deviceId: 'device-1', venueId: 'venue-1', deviceLabel: 'Tablet 1' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Invalid venue PIN' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TabletDeviceGate>
        <div data-testid="protected-content">restricted content</div>
      </TabletDeviceGate>,
    );

    expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByText('Incorrect PIN.')).toBeInTheDocument());
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('a revoked device is forced back to the enrollment screen, not left retrying the same dead token', async () => {
    useTabletDeviceAuthStore.setState({ deviceToken: 'real.device.token', deviceId: 'device-1', venueId: 'venue-1', deviceLabel: 'Tablet 1' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'This device has been revoked or is unknown' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TabletDeviceGate>
        <div data-testid="protected-content">restricted content</div>
      </TabletDeviceGate>,
    );

    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByPlaceholderText('Enrollment code')).toBeInTheDocument());
    expect(useTabletDeviceAuthStore.getState().deviceToken).toBeNull();
  });

  it('a correct venue PIN unlocks the device and renders children (restricted mode)', async () => {
    useTabletDeviceAuthStore.setState({ deviceToken: 'real.device.token', deviceId: 'device-1', venueId: 'venue-1', deviceLabel: 'Tablet 1' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unlocked: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TabletDeviceGate>
        <div data-testid="protected-content">restricted content</div>
      </TabletDeviceGate>,
    );

    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '1088' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByTestId('protected-content')).toBeInTheDocument());

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/api/tablet/unlock');
    expect(call[1].headers.Authorization).toBe('Bearer real.device.token');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { KdsPinGate } from './KdsPinGate';
import { useKdsDeviceAuthStore } from '../../store/kdsDeviceAuth.store';

const VENUE_ID = import.meta.env.VITE_VENUE_ID || '';

function resetStore() {
  useKdsDeviceAuthStore.setState({ accessToken: null, venueId: null, expiresAt: null });
}

/** A JWT-shaped (but unsigned) token with a real future `exp` claim, so
 * kdsDeviceAuth.store's decodeJwtPayload-based expiry check treats it as
 * valid — mirrors what a real access token from POST /api/kiosk/kds/auth
 * looks like from this component's perspective (it never verifies the
 * signature client-side; only the server does). */
function fakeJwt(expSecondsFromNow: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetStore();
});

describe('KdsPinGate', () => {
  it('shows the PIN entry screen when no valid device token exists, and never renders children', () => {
    render(
      <KdsPinGate>
        <div data-testid="protected-content">kds content</div>
      </KdsPinGate>,
    );
    expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('submitting the repository-wide local-dev PIN "108" unlocks Kitchen Display and renders children', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: fakeJwt(3600), expiresIn: '12h' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KdsPinGate>
        <div data-testid="protected-content">kds content</div>
      </KdsPinGate>,
    );

    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '108' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByTestId('protected-content')).toBeInTheDocument());

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(call[0]).toContain('/api/kiosk/kds/auth');
    expect(JSON.parse(call[1].body)).toEqual({ venueId: VENUE_ID, pin: '108' });
  });

  it('rejects an incorrect PIN and never renders children', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KdsPinGate>
        <div data-testid="protected-content">kds content</div>
      </KdsPinGate>,
    );

    fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => expect(screen.getByText('Incorrect PIN.')).toBeInTheDocument());
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('an already-valid device token for this venue skips the PIN screen entirely and renders children directly', () => {
    useKdsDeviceAuthStore.setState({
      accessToken: fakeJwt(3600),
      venueId: VENUE_ID,
      expiresAt: Date.now() + 3600_000,
    });

    render(
      <KdsPinGate>
        <div data-testid="protected-content">kds content</div>
      </KdsPinGate>,
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('PIN')).not.toBeInTheDocument();
  });

  it('an expired device token for this venue is treated as no session — the PIN screen re-appears rather than granting stale access', () => {
    useKdsDeviceAuthStore.setState({
      accessToken: fakeJwt(-3600),
      venueId: VENUE_ID,
      expiresAt: Date.now() - 3600_000,
    });

    render(
      <KdsPinGate>
        <div data-testid="protected-content">kds content</div>
      </KdsPinGate>,
    );

    expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

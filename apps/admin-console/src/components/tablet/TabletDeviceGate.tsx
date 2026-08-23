import { useState, type FormEvent, type ReactNode } from 'react';
import { useTabletDeviceAuthStore } from '../../store/tabletDeviceAuth.store';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Story 15-1 / DL-081 — the standalone Order Tablet's device-identity gate.
 * Replaces KdsPinGate for `VITE_APP_MODE=tablet` only (KDS keeps its
 * existing, unchanged shared-PIN flow — see App.tsx). Three states:
 *
 *   1. No enrolled device -> one-time enrollment-code entry.
 *   2. An enrolled (but locked) device -> venue PIN "wake" screen. The PIN
 *      does not grant any authority by itself — it only unlocks an
 *      *already-trusted* device into restricted mode; the device token
 *      remains the real bearer of restricted-tier authority throughout.
 *   3. Unlocked -> renders `children` (OrderTabletPage) in restricted
 *      mode; named staff elevation and its own lock control live inside
 *      OrderTabletPage itself, scoped to standalone mode.
 *
 * Reloading always returns to state 2 (locked) even though the device
 * token itself persists — a deliberate choice so a stray reload can never
 * silently stay "unlocked" for whoever is physically at the terminal.
 */
export function TabletDeviceGate({ children }: { children: ReactNode }) {
  const device = useTabletDeviceAuthStore();
  const [unlocked, setUnlocked] = useState(false);

  const [bootstrapToken, setBootstrapToken] = useState('');
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const [pin, setPin] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const onEnroll = async (event: FormEvent) => {
    event.preventDefault();
    setEnrollError(null);
    setEnrolling(true);
    try {
      const response = await fetch(`${API_BASE}/api/tablet/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapToken: bootstrapToken.trim() }),
      });
      if (!response.ok) {
        setEnrollError(
          response.status === 429 ? 'Too many attempts — try again shortly.' : 'Invalid or expired enrollment code.',
        );
        return;
      }
      const data = (await response.json()) as { deviceId: string; deviceToken: string; venueId: string; label: string };
      device.setDevice(data.deviceToken, data.deviceId, data.venueId, data.label);
    } catch {
      setEnrollError('Could not reach the server. Check the network connection.');
    } finally {
      setEnrolling(false);
      setBootstrapToken('');
    }
  };

  const onUnlock = async (event: FormEvent) => {
    event.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      const response = await fetch(`${API_BASE}/api/tablet/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${device.deviceToken}` },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          // Could be a wrong PIN, or this device was revoked — re-fetch the
          // device's own state is not available client-side, so fail safe:
          // if the token itself is now rejected outright by a device-tier
          // endpoint, force re-enrollment rather than leave a dead token
          // cached indefinitely.
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          if (body.message?.toLowerCase().includes('revoked') || body.message?.toLowerCase().includes('unknown')) {
            device.clearDevice();
            setUnlockError('This device has been revoked. Re-enrollment is required.');
            return;
          }
          setUnlockError('Incorrect PIN.');
          return;
        }
        setUnlockError(response.status === 429 ? 'Too many attempts — try again shortly.' : 'Could not unlock.');
        return;
      }
      setUnlocked(true);
    } catch {
      setUnlockError('Could not reach the server. Check the network connection.');
    } finally {
      setUnlocking(false);
      setPin('');
    }
  };

  if (!device.deviceToken || !device.deviceId) {
    return (
      <Screen>
        <form onSubmit={(e) => void onEnroll(e)} style={formStyle}>
          <Header title="VERDURA ORDER TABLET" subtitle="Enter the device enrollment code" />
          <input
            type="text"
            autoFocus
            value={bootstrapToken}
            onChange={(e) => setBootstrapToken(e.target.value)}
            placeholder="Enrollment code"
            style={{ ...inputStyle, letterSpacing: '0.05em', fontSize: 14 }}
          />
          {enrollError && <p style={errorStyle}>{enrollError}</p>}
          <button type="submit" disabled={enrolling || bootstrapToken.trim().length === 0} style={buttonStyle(enrolling)}>
            {enrolling ? 'Enrolling…' : 'Enroll this device'}
          </button>
        </form>
      </Screen>
    );
  }

  if (!unlocked) {
    return (
      <Screen>
        <form onSubmit={(e) => void onUnlock(e)} style={formStyle}>
          <Header title={device.deviceLabel || 'VERDURA ORDER TABLET'} subtitle="Enter the venue PIN to continue" />
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            style={inputStyle}
          />
          {unlockError && <p style={errorStyle}>{unlockError}</p>}
          <button type="submit" disabled={unlocking || pin.length === 0} style={buttonStyle(unlocking)}>
            {unlocking ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </Screen>
    );
  }

  return <>{children}</>;
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#16A34A', fontWeight: 900, fontSize: 22, letterSpacing: '0.06em' }}>{title}</div>
      <p style={{ color: '#8890A8', fontSize: 13, marginTop: 6 }}>{subtitle}</p>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0D1117',
        fontFamily: "'Inter','Helvetica Neue',system-ui,sans-serif",
      }}
    >
      {children}
    </div>
  );
}

const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, width: 300 };
const inputStyle: React.CSSProperties = {
  background: '#161B27',
  border: '1px solid #252B3D',
  borderRadius: 10,
  color: '#F0F1F8',
  fontSize: 20,
  letterSpacing: '0.3em',
  textAlign: 'center',
  padding: '12px 14px',
};
const errorStyle: React.CSSProperties = { color: '#EF4444', fontSize: 13, textAlign: 'center' };
const buttonStyle = (busy: boolean): React.CSSProperties => ({
  background: '#16A34A',
  border: 'none',
  borderRadius: 10,
  color: '#fff',
  fontWeight: 800,
  padding: '12px 14px',
  cursor: busy ? 'not-allowed' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

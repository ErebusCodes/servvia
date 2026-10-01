import { useState, type FormEvent, type ReactNode } from 'react';
import { useKdsDeviceAuthStore, isKdsDeviceTokenValid } from '../../store/kdsDeviceAuth.store';

const VENUE_ID = import.meta.env.VITE_VENUE_ID || '';
const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Gates unattended kitchen-display / order-tablet terminals behind a
 * venue-scoped PIN, per docs/ux.md 3.3 ("/kds — PIN entry on first load...
 * no full staff login"). Exchanges the PIN once for a device token (stored
 * locally) and renders `children` for the rest of that terminal's session.
 */
export function KdsPinGate({ children }: { children: ReactNode }) {
  const deviceAuth = useKdsDeviceAuthStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!VENUE_ID) {
    return (
      <Screen>
        <p style={{ color: '#EF4444', fontWeight: 700 }}>VITE_VENUE_ID is not configured for this terminal.</p>
      </Screen>
    );
  }

  if (isKdsDeviceTokenValid(deviceAuth, VENUE_ID)) {
    return <>{children}</>;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/kiosk/kds/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: VENUE_ID, pin }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'Too many attempts — try again shortly.' : 'Incorrect PIN.');
        return;
      }
      const data = (await response.json()) as { accessToken: string };
      deviceAuth.setToken(data.accessToken, VENUE_ID);
    } catch {
      setError('Could not reach the server. Check the network connection.');
    } finally {
      setSubmitting(false);
      setPin('');
    }
  };

  return (
    <Screen>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#16A34A', fontWeight: 900, fontSize: 22, letterSpacing: '0.06em' }}>VERDURA KDS</div>
          <p style={{ color: '#8890A8', fontSize: 13, marginTop: 6 }}>Enter the terminal PIN to continue</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          style={{
            background: '#161B27',
            border: '1px solid #252B3D',
            borderRadius: 10,
            color: '#F0F1F8',
            fontSize: 20,
            letterSpacing: '0.3em',
            textAlign: 'center',
            padding: '12px 14px',
          }}
        />
        {error && <p style={{ color: '#EF4444', fontSize: 13, textAlign: 'center' }}>{error}</p>}
        <button
          type="submit"
          disabled={submitting || pin.length === 0}
          style={{
            background: '#16A34A',
            border: 'none',
            borderRadius: 10,
            color: '#fff',
            fontWeight: 800,
            padding: '12px 14px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting || pin.length === 0 ? 0.6 : 1,
          }}
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </Screen>
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

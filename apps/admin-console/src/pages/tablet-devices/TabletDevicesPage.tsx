import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { DEFAULT_VENUE_ID } from '../../shared/orders';

interface TabletDeviceView {
  id: string;
  label: string;
  status: 'active' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface StaffListItem {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  hasTabletPin: boolean;
}

/**
 * Story 15-1 / DL-081 — minimal, operationally-usable Admin Console surface
 * for Order Tablet device enrollment/revocation and staff tablet-PIN
 * management. Deliberately narrow: only what's needed to provision and
 * retire devices/PINs without a manual database edit — not a general
 * device or staff management redesign.
 */
export function TabletDevicesPage() {
  const [devices, setDevices] = useState<TabletDeviceView[]>([]);
  const [staff, setStaff] = useState<StaffListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newDeviceLabel, setNewDeviceLabel] = useState('');
  const [issuedCode, setIssuedCode] = useState<{ label: string; bootstrapToken: string; expiresAt: string } | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);

  const [pinTargetStaffId, setPinTargetStaffId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [settingPin, setSettingPin] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [devicesRes, staffRes] = await Promise.all([
        api.get<TabletDeviceView[]>(`/api/venues/${DEFAULT_VENUE_ID}/tablet-devices/devices`),
        api.get<StaffListItem[]>('/api/admin/staff'),
      ]);
      setDevices(devicesRes.data);
      setStaff(staffRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices/staff.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createEnrollmentCode() {
    setCreatingCode(true);
    setIssuedCode(null);
    try {
      const { data } = await api.post<{ enrollmentId: string; bootstrapToken: string; expiresAt: string }>(
        `/api/venues/${DEFAULT_VENUE_ID}/tablet-devices/enrollments`,
        { label: newDeviceLabel.trim() || undefined },
      );
      setIssuedCode({ label: newDeviceLabel.trim() || '(unlabelled)', bootstrapToken: data.bootstrapToken, expiresAt: data.expiresAt });
      setNewDeviceLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create enrollment code.');
    } finally {
      setCreatingCode(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await api.post(`/api/venues/${DEFAULT_VENUE_ID}/tablet-devices/devices/${deviceId}/revoke`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke device.');
    }
  }

  async function setTabletPin(event: React.FormEvent) {
    event.preventDefault();
    if (!pinTargetStaffId) return;
    setPinError(null);
    setSettingPin(true);
    try {
      await api.post(`/api/admin/staff/${pinTargetStaffId}/tablet-pin`, { pin: pinValue });
      setPinValue('');
      setPinTargetStaffId(null);
      await refresh();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to set PIN.');
    } finally {
      setSettingPin(false);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '860px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Order Tablet devices &amp; staff PINs</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginBottom: '24px' }}>
        Enroll or revoke physical Order Tablet devices, and set/reset the short PIN each staff member uses to elevate a
        tablet session to their own identity. See docs/decisions-log.md DL-081.
      </p>

      {error && (
        <div style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', color: 'var(--color-danger)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>Devices</h2>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            value={newDeviceLabel}
            onChange={(e) => setNewDeviceLabel(e.target.value)}
            placeholder="Device label (e.g. Patio tablet 1)"
            style={{ flex: 1, height: '38px', padding: '0 12px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
          />
          <button
            onClick={() => void createEnrollmentCode()}
            disabled={creatingCode}
            style={{ height: '38px', padding: '0 16px', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 600, cursor: creatingCode ? 'default' : 'pointer' }}
          >
            {creatingCode ? 'Creating…' : 'Create enrollment code'}
          </button>
        </div>

        {issuedCode && (
          <div style={{ background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', fontSize: '13px' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Enrollment code for &ldquo;{issuedCode.label}&rdquo; — shown once</div>
            <div style={{ fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all', background: 'var(--color-surface)', padding: '8px', borderRadius: '4px', marginBottom: '4px' }}>
              {issuedCode.bootstrapToken}
            </div>
            <div style={{ color: 'var(--color-text-secondary)' }}>
              Enter this on the standalone tablet's enrollment screen before it expires ({new Date(issuedCode.expiresAt).toLocaleTimeString()}).
              It will never be shown again — create a new code if lost.
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</p>
        ) : devices.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>No devices enrolled yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                <th style={{ padding: '6px 8px' }}>Label</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Last seen</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px' }}>{d.label}</td>
                  <td style={{ padding: '8px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: d.status === 'active' ? 'var(--color-success-bg)' : 'var(--color-danger-bg)', color: d.status === 'active' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px' }}>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}</td>
                  <td style={{ padding: '8px' }}>
                    {d.status === 'active' && (
                      <button onClick={() => void revokeDevice(d.id)} style={{ border: '1px solid var(--color-danger-border)', color: 'var(--color-danger)', background: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>Staff tablet PINs</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '12.5px', marginBottom: '12px' }}>
          A staff member's tablet PIN is separate from their login password and is used only to elevate an
          Order Tablet session to their named identity.
        </p>
        {loading ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Active</th>
                <th style={{ padding: '6px 8px' }}>Tablet PIN</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px' }}>{s.name}</td>
                  <td style={{ padding: '8px' }}>{s.role}</td>
                  <td style={{ padding: '8px' }}>{s.isActive ? 'yes' : 'no'}</td>
                  <td style={{ padding: '8px' }}>{s.hasTabletPin ? 'set' : 'not set'}</td>
                  <td style={{ padding: '8px' }}>
                    <button
                      onClick={() => {
                        setPinTargetStaffId(s.id);
                        setPinError(null);
                      }}
                      style={{ border: '1px solid var(--color-border-strong)', background: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      {s.hasTabletPin ? 'Reset PIN' : 'Set PIN'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pinTargetStaffId && (
          <form
            onSubmit={(e) => void setTabletPin(e)}
            style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--color-surface-2)', padding: '12px', borderRadius: '8px' }}
          >
            <span style={{ fontSize: '13px' }}>New PIN for {staff.find((s) => s.id === pinTargetStaffId)?.name}:</span>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              style={{ width: '120px', height: '34px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--color-border-strong)' }}
            />
            <button type="submit" disabled={settingPin || pinValue.length < 4} style={{ height: '34px', padding: '0 14px', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', fontSize: '12.5px' }}>
              {settingPin ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPinTargetStaffId(null);
                setPinValue('');
              }}
              style={{ height: '34px', padding: '0 14px', borderRadius: '6px', border: '1px solid var(--color-border-strong)', background: 'none', cursor: 'pointer', fontSize: '12.5px' }}
            >
              Cancel
            </button>
            {pinError && <span style={{ color: 'var(--color-danger)', fontSize: '12px' }}>{pinError}</span>}
          </form>
        )}
      </section>
    </div>
  );
}

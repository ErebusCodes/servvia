import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../../lib/api';

/**
 * Staff management (Story 8.1, STF-1): real staff accounts, roles, venue
 * grants and credentials, backed by /api/admin/staff. Replaces the former
 * mock workforce page. Every rule is enforced by the API (who may administer
 * whom, which roles and venues); this page only shows its answers.
 *
 * No administrator ever sets or sees a staff member's password: creating an
 * account or resetting its credential returns a single-use setup code, shown
 * once here, with which the staff member sets their own password at
 * /setup-credential.
 */

export const STAFF_ROLES = ['owner', 'admin', 'manager', 'cashier', 'kitchen', 'viewer'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffAccount {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  hasTabletPin: boolean;
  venueIds: string[];
  pendingCredentialSetup: boolean;
  lastLoginAt: string | null;
}

interface Venue {
  id: string;
  name: string;
}

interface IssuedCode {
  staffName: string;
  code: string;
  expiresAt: string;
}

function messageOf(err: unknown, fallback: string): string {
  const response = (err as { response?: { status?: number; data?: { message?: unknown } } })?.response;
  const message = response?.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  if (response?.status === 403) return 'You are not allowed to do that.';
  return fallback;
}

const cell: CSSProperties = { padding: '8px', verticalAlign: 'top' };
const button: CSSProperties = {
  border: '1px solid var(--color-border-strong)',
  background: 'none',
  borderRadius: '6px',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '12px',
  marginRight: '6px',
  marginBottom: '4px',
};
const dangerButton: CSSProperties = {
  ...button,
  borderColor: 'var(--color-danger-border)',
  color: 'var(--color-danger)',
};
const input: CSSProperties = {
  height: '36px',
  padding: '0 10px',
  borderRadius: '6px',
  border: '1px solid var(--color-border-strong)',
};

export function StaffPage() {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('cashier');
  const [newVenueIds, setNewVenueIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Only the first load shows "Loading…"; later reloads keep the table in
  // place so a row being worked on is never unmounted under the user.
  async function refresh(initial = false) {
    if (initial) setLoading(true);
    try {
      const [staffRes, venuesRes] = await Promise.all([
        api.get<StaffAccount[]>('/api/admin/staff'),
        api.get<Venue[]>('/api/venues'),
      ]);
      setStaff(staffRes.data);
      setVenues(venuesRes.data);
      setError(null);
    } catch (err) {
      setError(messageOf(err, 'Failed to load staff.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(true);
  }, []);

  /** Runs one change, then reloads; any refusal is shown as the API stated it. */
  async function act(change: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await change();
      await refresh();
    } catch (err) {
      setError(messageOf(err, fallback));
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post<{
        staff: StaffAccount;
        credentialSetup: { code: string; expiresAt: string };
      }>('/api/admin/staff', { name: name.trim(), email: email.trim(), role, venueIds: newVenueIds });
      setIssued({ staffName: data.staff.name, ...data.credentialSetup });
      setName('');
      setEmail('');
      setNewVenueIds([]);
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Failed to create the staff account.'));
    } finally {
      setCreating(false);
    }
  }

  async function resetCredential(account: StaffAccount) {
    setError(null);
    try {
      const { data } = await api.post<{ code: string; expiresAt: string }>(
        `/api/admin/staff/${account.id}/credential-reset`,
      );
      setIssued({ staffName: account.name, ...data });
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Failed to reset the credential.'));
    }
  }

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id;

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Staff</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
        Every person signs in as themselves, with only the role and venues they are given. Removing
        a role, deactivating, removing or resetting a staff member signs them out everywhere.
      </p>

      {error && (
        <div
          role="alert"
          style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', color: 'var(--color-danger)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' }}
        >
          {error}
        </div>
      )}

      {issued && (
        <div
          data-testid="issued-code"
          style={{ background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', fontSize: '13px' }}
        >
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            Setup code for {issued.staffName} — shown once
          </div>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', background: 'var(--color-surface)', padding: '8px', borderRadius: '4px', marginBottom: '4px' }}>
            {issued.code}
          </div>
          <div style={{ color: 'var(--color-text-secondary)' }}>
            Give it to {issued.staffName} in person. They set their own password at /setup-credential
            before {new Date(issued.expiresAt).toLocaleString()}. It works once and is never shown
            again; reset the credential to issue a new one.
          </div>
          <button style={{ ...button, marginTop: '8px' }} onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      <section style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>Add a staff member</h2>
        <form onSubmit={(e) => void createAccount(e)} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <label>
            <span className="sr-only">Name</span>
            <input aria-label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={input} />
          </label>
          <label>
            <span className="sr-only">Email</span>
            <input aria-label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={input} />
          </label>
          <label>
            <span className="sr-only">Role</span>
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} style={input}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {venues.map((v) => (
            <label key={v.id} style={{ fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={newVenueIds.includes(v.id)}
                onChange={(e) =>
                  setNewVenueIds((ids) => (e.target.checked ? [...ids, v.id] : ids.filter((id) => id !== v.id)))
                }
              />{' '}
              {v.name}
            </label>
          ))}
          <button
            type="submit"
            disabled={creating}
            style={{ height: '36px', padding: '0 16px', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 600, cursor: creating ? 'default' : 'pointer' }}
          >
            {creating ? 'Adding…' : 'Add staff member'}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>Staff accounts</h2>
        {loading ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading…</p>
        ) : staff.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>No staff accounts.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                <th style={cell}>Name</th>
                <th style={cell}>Role</th>
                <th style={cell}>Status</th>
                <th style={cell}>Venues</th>
                <th style={cell}>Credential</th>
                <th style={cell}></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} data-testid={`staff-${s.id}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ color: 'var(--color-text-secondary)' }}>{s.email}</div>
                  </td>
                  <td style={cell}>
                    <select
                      aria-label={`Role of ${s.name}`}
                      value={s.role}
                      onChange={(e) =>
                        void act(() => api.patch(`/api/admin/staff/${s.id}`, { role: e.target.value }), 'Failed to change the role.')
                      }
                      style={{ ...input, height: '30px' }}
                    >
                      {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={cell}>{s.isActive ? 'Active' : 'Deactivated'}</td>
                  <td style={cell}>
                    {venues.map((v) => {
                      const granted = s.venueIds.includes(v.id);
                      return (
                        <label key={v.id} style={{ display: 'block' }}>
                          <input
                            type="checkbox"
                            aria-label={`${v.name} access for ${s.name}`}
                            checked={granted}
                            onChange={() =>
                              void act(
                                () =>
                                  granted
                                    ? api.delete(`/api/admin/staff/${s.id}/venues/${v.id}`)
                                    : api.put(`/api/admin/staff/${s.id}/venues/${v.id}`),
                                'Failed to change venue access.',
                              )
                            }
                          />{' '}
                          {v.name}
                        </label>
                      );
                    })}
                    {s.venueIds
                      .filter((id) => !venues.some((v) => v.id === id))
                      .map((id) => (
                        <div key={id}>{venueName(id)}</div>
                      ))}
                  </td>
                  <td style={cell}>
                    {s.pendingCredentialSetup ? 'Setup code issued' : 'Password set'}
                    <div style={{ color: 'var(--color-text-secondary)' }}>
                      Tablet PIN {s.hasTabletPin ? 'set' : 'not set'}
                    </div>
                  </td>
                  <td style={cell}>
                    {s.isActive ? (
                      <button
                        style={button}
                        onClick={() => void act(() => api.post(`/api/admin/staff/${s.id}/deactivate`), 'Failed to deactivate.')}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        style={button}
                        onClick={() => void act(() => api.post(`/api/admin/staff/${s.id}/activate`), 'Failed to reactivate.')}
                      >
                        Reactivate
                      </button>
                    )}
                    <button style={button} onClick={() => void resetCredential(s)}>
                      Reset credential
                    </button>
                    {confirmRemove === s.id ? (
                      <>
                        <button
                          style={dangerButton}
                          onClick={() => {
                            setConfirmRemove(null);
                            void act(() => api.delete(`/api/admin/staff/${s.id}`), 'Failed to remove.');
                          }}
                        >
                          Confirm removal
                        </button>
                        <button style={button} onClick={() => setConfirmRemove(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button style={dangerButton} onClick={() => setConfirmRemove(s.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

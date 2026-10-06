import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Story 8.1: a staff member sets their own password with the single-use code
 * an owner or admin gave them. Public (the code is the credential); every
 * refusal looks the same, so the page never reveals whether a code exists.
 */
export function CredentialSetupPage() {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/auth/credential-setup', { code: code.trim(), password });
      setDone(true);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(
        status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
          : status === 401
            ? 'This setup code is invalid or has expired. Ask for a new one.'
            : 'Could not set the password. Please try again.',
      );
    } finally {
      setSubmitting(false);
      setPassword('');
      setConfirm('');
    }
  };

  const field = 'w-full box-border rounded-[10px] border border-[#252B3D] bg-[#0D1117] px-4 py-3 text-[#F0F1F8] outline-none focus:border-[#16A34A] mb-3';

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#0D1117] font-body p-4 box-border">
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-[420px] rounded-2xl border border-[#252B3D] bg-[#161B27] px-8 py-10 shadow-2xl"
      >
        <h1 className="mt-0 mb-2 text-2xl font-semibold text-[#F0F1F8]">Set your password</h1>
        {done ? (
          <p className="text-[13px] text-[#8890A8]">Your password is set. You can now sign in.</p>
        ) : (
          <>
            <p className="mt-0 mb-6 text-[13px] text-[#8890A8]">
              Enter the setup code you were given and choose a password of at least {MIN_PASSWORD_LENGTH} characters.
            </p>
            <label htmlFor="setup-code" className="sr-only">Setup code</label>
            <input id="setup-code" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Setup code" className={field} />
            <label htmlFor="new-password" className="sr-only">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" className={field} />
            <label htmlFor="confirm-password" className="sr-only">Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className={field} />
            {error && <p role="alert" className="text-[13px] text-[#F87171] mt-0">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-[10px] bg-[#16A34A] py-3 font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Set password'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

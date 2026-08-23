import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface PinLoginResponse {
  accessToken: string;
  user: { id: string; email: string; name: string; role: string };
}

export function AdminPinGate() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<PinLoginResponse>('/api/auth/admin-pin', { pin });
      setAuth(data.accessToken, data.user);
    } catch (requestError: unknown) {
      const status = (requestError as { response?: { status?: number } })?.response?.status;
      setError(
        status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
          : status === 401
            ? 'Incorrect PIN.'
            : 'Could not reach the server. Please try again.',
      );
    } finally {
      setSubmitting(false);
      setPin('');
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#0D1117] font-body p-4 box-border">
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-[380px] rounded-2xl border border-[#252B3D] bg-[#161B27] px-8 py-10 shadow-2xl"
      >
        <div className="text-center">
          <div className="text-[#16A34A] font-black text-[22px] tracking-[0.06em]">VERDURA ADMIN</div>
          <h1 className="mt-8 mb-2 text-2xl font-semibold text-[#F0F1F8]">Operations Console</h1>
          <p className="mt-0 mb-7 text-[13px] text-[#8890A8]">Enter the admin PIN to continue</p>
        </div>

        <label htmlFor="admin-pin" className="sr-only">Admin PIN</label>
        <input
          id="admin-pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
          placeholder="PIN"
          className="w-full box-border rounded-[10px] border border-[#252B3D] bg-[#0D1117] px-4 py-3 text-center text-xl tracking-[0.3em] text-[#F0F1F8] outline-none focus:border-[#16A34A]"
        />

        <div aria-live="polite" className="min-h-8 pt-2 text-center text-[13px] text-red-500">
          {error}
        </div>

        <button
          type="submit"
          disabled={submitting || pin.length < 3}
          className="w-full rounded-[10px] border-0 bg-[#16A34A] px-4 py-3 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Checking…' : 'Unlock Console'}
        </button>
      </form>
    </main>
  );
}

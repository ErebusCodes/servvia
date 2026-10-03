import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';

interface LoginResponse {
  accessToken: string;
  user: { id: string; email: string; name: string; role: string };
}

/**
 * Story 2.4: the Admin Console's only way in. Every administrator signs in as
 * themselves with their email and password, so every action is attributable
 * (there is no shared console PIN). Every refused sign-in gets the same
 * message, whatever the reason; the API decides who may enter.
 */
export function StaffSignIn() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<LoginResponse>('/api/auth/login', {
        email: email.trim(),
        password,
      });
      setAuth(data.accessToken, data.user);
    } catch (requestError: unknown) {
      const status = (requestError as { response?: { status?: number } })?.response?.status;
      setError(
        status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
          : status === 401 || status === 400
            ? 'Incorrect email or password.'
            : 'Could not reach the server. Please try again.',
      );
    } finally {
      setSubmitting(false);
      setPassword('');
    }
  };

  const field =
    'w-full box-border rounded-[10px] border border-[#252B3D] bg-[#0D1117] px-4 py-3 text-[15px] text-[#F0F1F8] outline-none focus:border-[#16A34A]';

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#0D1117] font-body p-4 box-border">
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-[380px] rounded-2xl border border-[#252B3D] bg-[#161B27] px-8 py-10 shadow-2xl"
      >
        <div className="text-center">
          <div className="text-[#16A34A] font-black text-[22px] tracking-[0.06em]">VERDURA ADMIN</div>
          <h1 className="mt-8 mb-2 text-2xl font-semibold text-[#F0F1F8]">Operations Console</h1>
          <p className="mt-0 mb-7 text-[13px] text-[#8890A8]">Sign in with your staff account</p>
        </div>

        <div className="flex flex-col gap-3">
          <label htmlFor="sign-in-email" className="sr-only">Email</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className={field}
          />
          <label htmlFor="sign-in-password" className="sr-only">Password</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className={field}
          />
        </div>

        <div aria-live="polite" className="min-h-8 pt-2 text-center text-[13px] text-red-500">
          {error}
        </div>

        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="w-full rounded-[10px] border-0 bg-[#16A34A] px-4 py-3 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-6 mb-0 text-center text-[13px] text-[#8890A8]">
          Have a setup code?{' '}
          <a href="/setup-credential" className="text-[#16A34A] underline">
            Set your password
          </a>
        </p>
      </form>
    </main>
  );
}

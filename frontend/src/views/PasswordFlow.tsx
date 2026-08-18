import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { forgotPassword, resetPassword } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';

// P1-6: two public pages in one component.
//  - /forgot-password: request a reset link (always "check your inbox")
//  - /reset-password?token=...: set a new password (single-use, 30 min)
export default function PasswordFlow() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [done, setDone] = useState(false);

  if (token) return <ResetForm token={token} onDone={() => setDone(true)} done={done} />;
  return <ForgotForm onDone={() => setDone(true)} done={done} />;
}

function ForgotForm({ onDone, done }: { onDone: () => void; done: boolean }) {
  const [email, setEmail] = useState('');
  const mutation = useMutation({
    mutationFn: (e: string) => forgotPassword(e),
    onSuccess: onDone,
  });

  if (done) {
    return (
      <div className="mx-auto mt-24 w-full max-w-md px-4">
        <div className="rounded-2xl border border-edge bg-surface p-6 text-center">
          <p className="text-lg font-semibold text-primary">Check your notifications</p>
          <p className="mt-2 text-sm text-muted">
            If an account exists for <span className="font-medium text-primary">{email}</span>, a
            reset link is now in your in-app notifications (and will be emailed once SMTP is
            configured).
          </p>
          <Link to="/login" className={`mt-6 ${'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 ledgerly:from-accent ledgerly:to-accent-strong text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97] disabled:opacity-60'}`}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 w-full max-w-md px-4">
      <div className="rounded-2xl border border-edge bg-surface p-6">
        <h1 className="text-xl font-bold text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your ITMS email and we'll send you a reset link (valid 30 minutes).
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) mutation.mutate(email.trim());
          }}
        >
          <label className={labelCls}>
            Email
            <input
              type="email"
              required
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
            />
          </label>
          <button type="submit" disabled={mutation.isPending} className={'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 ledgerly:from-accent ledgerly:to-accent-strong text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97] disabled:opacity-60'}>
            {mutation.isPending ? 'Sending…' : 'Send reset link'}
          </button>
          {mutation.isError && (
            <p className="text-sm text-red-500">Something went wrong — please try again.</p>
          )}
        </form>
        <Link to="/login" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

function ResetForm({ token, onDone, done }: { token: string; onDone: () => void; done: boolean }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (p: string) => resetPassword({ token, new_password: p }),
    onSuccess: () => {
      onDone();
      setTimeout(() => navigate('/login'), 1800);
    },
    onError: (e: unknown) => {
      const msg = (e as { message?: string })?.message || 'Reset failed';
      setErr(msg.includes('expired') ? 'This reset link has expired or already been used.' : msg);
    },
  });

  if (done) {
    return (
      <div className="mx-auto mt-24 w-full max-w-md px-4">
        <div className="rounded-2xl border border-edge bg-surface p-6 text-center">
          <p className="text-lg font-semibold text-primary">Password updated 🎉</p>
          <p className="mt-2 text-sm text-muted">Signing you in shortly…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 w-full max-w-md px-4">
      <div className="rounded-2xl border border-edge bg-surface p-6">
        <h1 className="text-xl font-bold text-primary">Set a new password</h1>
        <p className="mt-1 text-sm text-muted">At least 8 characters. Link valid 30 minutes.</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
            if (pw !== pw2) { setErr('Passwords do not match.'); return; }
            setErr('');
            mutation.mutate(pw);
          }}
        >
          <label className={labelCls}>
            New password
            <input type="password" required className={inputCls} value={pw}
              onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          <label className={labelCls}>
            Confirm new password
            <input type="password" required className={inputCls} value={pw2}
              onChange={(e) => setPw2(e.target.value)} />
          </label>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button type="submit" disabled={mutation.isPending} className={'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 ledgerly:from-accent ledgerly:to-accent-strong text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97] disabled:opacity-60'}>
            {mutation.isPending ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

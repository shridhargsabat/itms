import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { forgotPassword, resetPassword } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';
import { Button } from '@/components/Button';
import { FieldError, errProps } from '@/components/FieldError';
import AnimatedBackground from '@/components/AnimatedBackground';

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

/** Login-style backdrop mirroring LegacyLogin (bg-base + AnimatedBackground). */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-base px-4">
      <AnimatedBackground />
      <div className="relative w-full max-w-md">
        {children}
      </div>
    </div>
  );
}

function ForgotForm({ onDone, done }: { onDone: () => void; done: boolean }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (e: string) => forgotPassword(e),
    onSuccess: onDone,
  });

  if (done) {
    return (
      <AuthShell>
        <div className="rounded-2xl glass-card p-6 text-center">
          <p className="text-lg font-semibold text-primary">Check your notifications</p>
          <p className="mt-2 text-sm text-muted">
            If an account exists for <span className="font-medium text-primary">{email}</span>, a
            reset link is now in your in-app notifications (and will be emailed once SMTP is
            configured).
          </p>
          <Link to="/login" className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-on-accent transition-all hover:bg-accent/90 active:scale-[0.97] disabled:opacity-60">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="rounded-2xl glass-card p-6">
        <h1 className="text-xl font-bold text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your ITMS email and we'll send you a reset link (valid 30 minutes).
        </p>
        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            // FORM-02: submit-time inline validation — never a silent no-op.
            const v = email.trim();
            if (!v) {
              setError('Email is required');
              document.getElementById('forgot-email')?.focus();
              return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
              setError('Enter a valid email address');
              document.getElementById('forgot-email')?.focus();
              return;
            }
            setError('');
            mutation.mutate(v);
          }}
        >
          <label className={labelCls} htmlFor="forgot-email">
            Email <span aria-hidden="true">*</span>
            <input
              id="forgot-email"
              type="email"
              aria-required="true"
              {...errProps('forgot-email', error)}
              className={inputCls}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
              }}
              placeholder="you@company.com"
              autoFocus
            />
            <FieldError id="forgot-email-error" error={error} />
          </label>
          <Button type="submit" loading={mutation.isPending} variant="primary" size="lg" fullWidth>Send reset link</Button>
          {mutation.isError && (
            <p role="alert" className="text-sm text-red-500">Something went wrong — please try again.</p>
          )}
        </form>
        <Link to="/login" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function ResetForm({ token, onDone, done }: { token: string; onDone: () => void; done: boolean }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string }>({});
  const navigate = useNavigate();
  // Wave 2-C: never leave the new password in memory — cleared on success
  // and on unmount.
  useEffect(() => () => { setPw(''); setPw2(''); }, []);
  const mutation = useMutation({
    mutationFn: (p: string) => resetPassword({ token, new_password: p }),
    onSuccess: () => {
      setPw('');
      setPw2('');
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
      <AuthShell>
        <div className="rounded-2xl glass-card p-6 text-center">
          <p className="text-lg font-semibold text-primary">Password updated 🎉</p>
          <p className="mt-2 text-sm text-muted">Signing you in shortly…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="rounded-2xl glass-card p-6">
        <h1 className="text-xl font-bold text-primary">Set a new password</h1>
        <p className="mt-1 text-sm text-muted">At least 8 characters. Link valid 30 minutes.</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // FORM-02: submit-time inline validation with focus-first-invalid.
            const errs: { pw?: string; pw2?: string } = {};
            if (!pw) {
              errs.pw = 'New password is required';
            } else if (pw.length < 8) {
              errs.pw = 'Password must be at least 8 characters.';
            }
            if (!pw2) {
              errs.pw2 = 'Please confirm your new password.';
            } else if (pw !== pw2) {
              errs.pw2 = 'Passwords do not match.';
            }
            setErrors(errs);
            if (errs.pw) {
              document.getElementById('reset-pw')?.focus();
              return;
            }
            if (errs.pw2) {
              document.getElementById('reset-pw2')?.focus();
              return;
            }
            setErr('');
            mutation.mutate(pw);
          }}
        >
          <label className={labelCls} htmlFor="reset-pw">
            New password <span aria-hidden="true">*</span>
            <input
              id="reset-pw"
              type="password"
              aria-required="true"
              {...errProps('reset-pw', errors.pw)}
              className={inputCls}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                if (errors.pw) setErrors((er) => ({ ...er, pw: undefined }));
              }}
              autoFocus
            />
            <FieldError id="reset-pw-error" error={errors.pw} />
          </label>
          <label className={labelCls} htmlFor="reset-pw2">
            Confirm new password <span aria-hidden="true">*</span>
            <input
              id="reset-pw2"
              type="password"
              aria-required="true"
              {...errProps('reset-pw2', errors.pw2)}
              className={inputCls}
              value={pw2}
              onChange={(e) => {
                setPw2(e.target.value);
                if (errors.pw2) setErrors((er) => ({ ...er, pw2: undefined }));
              }}
            />
            <FieldError id="reset-pw2-error" error={errors.pw2} />
          </label>
          {err && <p role="alert" className="text-sm text-red-500">{err}</p>}
          <Button type="submit" loading={mutation.isPending} variant="primary" size="lg" fullWidth>Update password</Button>
        </form>
      </div>
    </AuthShell>
  );
}

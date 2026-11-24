import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { changePassword, getCachedUser } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';
import { Button } from '@/components/Button';
import PageHeader from '@/components/PageHeader';

// P1-6: self-service change-own-password page.
export default function Account() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const user = getCachedUser();
  // Wave 2-C: onSuccess already clears all three fields; the unmount cleanup
  // pins it for every exit path (navigation mid-typing, etc.).
  useEffect(() => () => { setCur(''); setPw(''); setPw2(''); }, []);
  const mutation = useMutation({
    mutationFn: () => changePassword({ current_password: cur, new_password: pw }),
    onSuccess: () => {
      setOk(true);
      setCur(''); setPw(''); setPw2('');
      setTimeout(() => setOk(false), 4000);
    },
    onError: (e: unknown) => {
      setErr((e as { message?: string })?.message || 'Failed to change password');
      setTimeout(() => setErr(''), 5000);
    },
  });

  const mismatch = pw2.length > 0 && pw !== pw2;

  return (
    <div className="mx-auto w-full max-w-md">
      <PageHeader
        title="Account"
        description="Update your sign-in password."
      />
      {user && (
        <div className="mb-4 rounded-xl glass-card p-4">
          <p className="text-sm font-semibold text-primary">{user.name}</p>
          <p className="mt-0.5 text-xs text-secondary">{user.email}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{user.role}</p>
        </div>
      )}
      <form
        className="space-y-4 rounded-xl glass-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
          if (pw !== pw2) { setErr('Passwords do not match.'); return; }
          setErr('');
          mutation.mutate();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="account-current">
            Current password
          </label>
          <div className="relative">
            <input
              id="account-current"
              type={showCur ? 'text' : 'password'}
              required
              className={`${inputCls} pr-10`}
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              aria-label={showCur ? 'Hide current password' : 'Show current password'}
              onClick={() => setShowCur((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-primary"
            >
              {showCur ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="account-new">
            New password
          </label>
          <div className="relative">
            <input
              id="account-new"
              type={showPw ? 'text' : 'password'}
              required
              className={`${inputCls} pr-10`}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button
              type="button"
              aria-label={showPw ? 'Hide new password' : 'Show new password'}
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-primary"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="account-confirm">
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="account-confirm"
              type={showPw2 ? 'text' : 'password'}
              required
              className={`${inputCls} pr-10`}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
            <button
              type="button"
              aria-label={showPw2 ? 'Hide confirmed password' : 'Show confirmed password'}
              onClick={() => setShowPw2((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-primary"
            >
              {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {mismatch && <p className="mt-1 text-xs text-red-400">Passwords do not match.</p>}
        </div>
        {err && <p className="text-sm text-red-500">{err}</p>}
        {ok && <p className="text-sm text-emerald-500">Password updated.</p>}
        <Button
          type="submit"
          loading={mutation.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          Change password
        </Button>
      </form>
    </div>
  );
}

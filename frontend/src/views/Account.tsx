import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { changePassword, getCachedUser } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';
import { Button } from '@/components/Button';
import { FieldError, errProps } from '@/components/FieldError';
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
  const [errors, setErrors] = useState<{ cur?: string; pw?: string; pw2?: string }>({});
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

  // FORM-02: the confirm-mismatch hint stays live while typing, now as a
  // FieldError (role=alert); submit-time errors take precedence.
  const pw2LiveMismatch = pw2.length > 0 && pw !== pw2 ? 'Passwords do not match.' : undefined;
  const pw2Error = errors.pw2 ?? pw2LiveMismatch;

  const clearError = (key: 'cur' | 'pw' | 'pw2') =>
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

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
          // FORM-02: submit-time inline validation with focus-first-invalid.
          const errs: { cur?: string; pw?: string; pw2?: string } = {};
          if (!cur) errs.cur = 'Current password is required';
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
          if (errs.cur) {
            document.getElementById('account-current')?.focus();
            return;
          }
          if (errs.pw) {
            document.getElementById('account-new')?.focus();
            return;
          }
          if (errs.pw2) {
            document.getElementById('account-confirm')?.focus();
            return;
          }
          setErr('');
          mutation.mutate();
        }}
      >
        <div>
          <label className={labelCls} htmlFor="account-current">
            Current password <span aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <input
              id="account-current"
              type={showCur ? 'text' : 'password'}
              aria-required="true"
              {...errProps('account-current', errors.cur)}
              className={`${inputCls} pr-10`}
              value={cur}
              onChange={(e) => {
                setCur(e.target.value);
                clearError('cur');
              }}
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
          <FieldError id="account-current-error" error={errors.cur} />
        </div>
        <div>
          <label className={labelCls} htmlFor="account-new">
            New password <span aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <input
              id="account-new"
              type={showPw ? 'text' : 'password'}
              aria-required="true"
              {...errProps('account-new', errors.pw)}
              className={`${inputCls} pr-10`}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                clearError('pw');
              }}
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
          <FieldError id="account-new-error" error={errors.pw} />
        </div>
        <div>
          <label className={labelCls} htmlFor="account-confirm">
            Confirm new password <span aria-hidden="true">*</span>
          </label>
          <div className="relative">
            <input
              id="account-confirm"
              type={showPw2 ? 'text' : 'password'}
              aria-required="true"
              {...errProps('account-confirm', pw2Error)}
              className={`${inputCls} pr-10`}
              value={pw2}
              onChange={(e) => {
                setPw2(e.target.value);
                clearError('pw2');
              }}
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
          <FieldError id="account-confirm-error" error={pw2Error} />
        </div>
        {err && <p role="alert" className="text-sm text-red-500">{err}</p>}
        {ok && <p role="status" className="text-sm text-emerald-500">Password updated.</p>}
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

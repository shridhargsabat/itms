import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';

// P1-6: self-service change-own-password page.
export default function Account() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
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

  return (
    <div className="mx-auto mt-8 w-full max-w-md px-4">
      <h1 className="text-xl font-bold text-primary">Account</h1>
      <p className="mt-1 text-sm text-muted">Update your sign-in password.</p>
      <form
        className="mt-6 space-y-4 rounded-2xl border border-edge bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
          if (pw !== pw2) { setErr('Passwords do not match.'); return; }
          setErr('');
          mutation.mutate();
        }}
      >
        <label className={labelCls}>
          Current password
          <input type="password" required className={inputCls} value={cur}
            onChange={(e) => setCur(e.target.value)} autoFocus />
        </label>
        <label className={labelCls}>
          New password
          <input type="password" required className={inputCls} value={pw}
            onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className={labelCls}>
          Confirm new password
          <input type="password" required className={inputCls} value={pw2}
            onChange={(e) => setPw2(e.target.value)} />
        </label>
        {err && <p className="text-sm text-red-500">{err}</p>}
        {ok && <p className="text-sm text-emerald-500">Password updated.</p>}
        <button type="submit" disabled={mutation.isPending} className={'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97] disabled:opacity-60'}>
          {mutation.isPending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

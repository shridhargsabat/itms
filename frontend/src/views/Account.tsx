import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '@/api/client';
import { inputCls, labelCls } from '@/lib/utils';
import { Button } from '@/components/Button';
import PageHeader from '@/components/PageHeader';

// P1-6: self-service change-own-password page.
export default function Account() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
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

  return (
    <div className="mx-auto w-full max-w-md">
      <PageHeader
        title="Account"
        description="Update your sign-in password."
      />
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

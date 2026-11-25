import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clearSession, exchangeOAuthCode, me, setSession } from '@/api/client';
import { syncThemeAfterLogin } from '@/lib/theme';

/**
 * #53 / wave-2a: SSO callback landing page — the backend 302s here with ONLY
 * a single-use `?code=`. This page POSTs it to /auth/oauth/exchange, stores
 * the session, strips the code from history (replace:true), then overwrites
 * the cached user with an authoritative GET /auth/me.
 */
export default function OAuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // StrictMode double-invokes effects in dev — the code is single-use, so the
  // second invocation must not re-redeem (it would 400 and bounce to login).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    if (!code) {
      void clearSession().then(() => {
        navigate('/login?error=sso_failed', { replace: true });
      });
      return;
    }
    (async () => {
      try {
        const res = await exchangeOAuthCode(code);
        setSession(res.token, res.user);
        // Strip ?code= from the URL/history BEFORE any further network hop.
        navigate('/', { replace: true });
        try {
          const fresh = await me();
          setSession(res.token, fresh);
          // Task 16: a login-screen theme choice (session flag survives the
          // SSO round-trip) wins and is pushed up; else the server pref wins.
          await syncThemeAfterLogin(fresh);
        } catch {
          await syncThemeAfterLogin(res.user);
        }
      } catch {
        await clearSession();
        navigate('/login?error=sso_failed', { replace: true });
      }
    })();
  }, [navigate, params]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base">
      <p className="text-sm text-secondary">Signing you in…</p>
    </div>
  );
}

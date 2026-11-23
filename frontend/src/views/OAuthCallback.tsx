import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clearSession, setSession } from '@/api/client';
import { hydrateThemeFromUser } from '@/lib/theme';

/**
 * #53: SSO callback landing page — the backend 302s here with the session
 * token after a successful Google exchange. Stores the session and goes home.
 */
export default function OAuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const token = params.get('token');
    const userRaw = params.get('user');
    if (token && userRaw) {
      const [role, name, department, id, email = '', theme = ''] = userRaw.split('|');
      setSession(token, { id, email, name, role, department, theme });
      hydrateThemeFromUser({ theme });
      navigate('/', { replace: true });
    } else {
      clearSession();
      navigate('/login?error=sso_failed', { replace: true });
    }
  }, [navigate, params]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base">
      <p className="text-sm text-secondary">Signing you in…</p>
    </div>
  );
}

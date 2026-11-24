import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { clearSession, getCachedUser, getToken, me } from '@/api/client';
import { hydrateThemeFromUser } from '@/lib/theme';

/**
 * Wave 2-C: true network failure = the fetch itself never got a response.
 *  - TypeError: offline / DNS / CORS ("Failed to fetch")
 *  - AbortError: request aborted (20s GET timeout in apiFetch, SW stall)
 * Anything else (ApiError incl. 401/403/5xx) is a server verdict — the
 * cached session must NOT be trusted for those.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof err === 'object' && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (name === 'AbortError') return true;
  }
  return false;
}

/** Real auth gate: token present AND valid against /auth/me.
 *  Offline (fetch TypeError/AbortError) falls back to the cached session so
 *  the SWR data cache still renders; 401 AND 403 both bounce to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = getToken();
  const cached = getCachedUser();
  const location = useLocation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['me'],
    queryFn: me,
    enabled: !!token,
    retry: false,
  });

  // Theme manager: the authenticated user's server pref is authoritative —
  // every app load re-syncs (device B picks up device A's theme change).
  useEffect(() => {
    if (data) hydrateThemeFromUser(data);
  }, [data]);

  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-base">
        <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }
  if (isError) {
    // 401 (expired/revoked) and 403 (forbidden) are both hard auth failures:
    // clear and bounce exactly alike. The cached session is ONLY trusted
    // when the request never reached the server (offline/aborted fetch).
    if (isNetworkFailure(error) && cached) {
      return <>{children}</>; // offline — cached session, cached data
    }
    clearSession();
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

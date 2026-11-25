import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { demoLogin as apiDemoLogin, getOAuthStatus, login, setSession } from '@/api/client';
import { syncThemeAfterLogin } from '@/lib/theme';

export interface UseLoginResult {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  flash: string;
  oauthEnabled: boolean;
  submit: (e: React.FormEvent) => void;
  onDemoClick: () => void;
  loginPending: boolean;
  loginError: string | null;
  demoPending: boolean;
}

/**
 * Shared login logic for all login skins (Tasks 6–11).
 * Extracted verbatim from the legacy Login page: state,
 * oauth-status query, both mutations, flash effect, and plain navigate-home.
 * No JSX — skins render from this API.
 */
export function useLogin(): UseLoginResult {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [flash, setFlash] = useState('');
  const oauth = useQuery({ queryKey: ['oauth-status'], queryFn: getOAuthStatus, retry: false });
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error');
    if (err === 'sso_failed') setFlash('SSO sign-in failed — try again or use your password.');
  }, []);

  // Wave 2-C: never leave the password in memory — cleared on unmount (the
  // component is gone after a successful login anyway, but the cleanup pins
  // it for every exit path) and in onSuccess below.
  useEffect(() => () => { setPassword(''); }, []);

  const navigateHome = () => {
    navigate('/', { replace: true });
  };

  const mutation = useMutation({
    mutationFn: ({ email: e, password: p }: { email: string; password: string }) =>
      login(e, p),
    onSuccess: async (res) => {
      setSession(res.token, res.user);
      // Task 16: an explicit login-screen theme choice wins (kept locally +
      // pushed up so it sticks); otherwise the server pref wins (cross-device sync).
      await syncThemeAfterLogin(res.user);
      setPassword(''); // Wave 2-C: drop the credential from memory on success
      navigateHome();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ email, password });
  };

  // demo uses a dedicated mutation (server-side demo account, #87 — no
  // credentials in the JS bundle)
  const demoMutation = useMutation({
    mutationFn: () => apiDemoLogin(),
    onSuccess: async (res) => {
      setSession(res.token, res.user);
      // Task 16: an explicit login-screen theme choice wins (kept locally +
      // pushed up so it sticks); otherwise the server pref wins (cross-device sync).
      await syncThemeAfterLogin(res.user);
      navigateHome();
    },
  });
  const onDemoClick = () => demoMutation.mutate();

  return {
    email,
    setEmail,
    password,
    setPassword,
    flash,
    oauthEnabled: Boolean(oauth.data?.enabled && oauth.data.client_id_set),
    submit,
    onDemoClick,
    loginPending: mutation.isPending,
    // Task 18 (UI-18): every auth failure shows the same generic sentence —
    // never leak raw server codes (invalid_credentials) or network details.
    loginError: mutation.isError ? 'Invalid email or password.' : null,
    demoPending: demoMutation.isPending,
  };
}

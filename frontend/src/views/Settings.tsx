import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getOAuthAdmin, updateOAuthAdmin } from '@/api/client';
import type { OAuthConfig } from '@/api/types';
import ThemeManager, { THEMES } from '@/components/ThemeManager';
import { Button } from '@/components/Button';
import { getThemeMode, onThemeChanged, type ThemeMode } from '@/lib/theme';

/** Icon component that never renders stale after server hydration. */
function CurrentThemeSummary() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const meta = THEMES.find((t) => t.value === mode) ?? THEMES[3];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-accent" />
      <div>
        <p className="text-sm font-semibold text-primary">{meta.label}</p>
        <p className="text-xs text-secondary">{meta.description}</p>
      </div>
    </div>
  );
}

/**
 * #53: Admin Settings — Google SSO configuration (UI-configurable).
 * Ships disabled; the admin pastes their own Google Cloud OAuth client.
 * Also hosts the Theme manager (appearance) — a user-level preference that
 * syncs across devices via PUT /auth/theme.
 */
export default function Settings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-oauth'], queryFn: getOAuthAdmin });
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [themeOpen, setThemeOpen] = useState(false);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateOAuthAdmin>[0]) => updateOAuthAdmin(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-oauth'] });
      setClientSecret('');
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <div className="p-8 text-sm text-secondary">Loading settings…</div>;

  const cfg: OAuthConfig = data ?? { provider: 'google', enabled: false, client_id: '', has_secret: false, allowed_domains: [] };
  const redirectUri = `${window.location.origin}/api/v1/auth/oauth/callback`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-primary">Settings</h1>
        <p className="mt-0.5 text-sm text-secondary">Appearance + Google SSO — configured here, no server edits needed.</p>
      </div>

      {/* Theme manager — user-level preference, synced across devices */}
      <div className="rounded-xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <CurrentThemeSummary />
          <Button
            type="button"
            onClick={() => setThemeOpen(true)}
            variant="primary"
            size="lg"
            className="shrink-0"
          >
            Change theme
          </Button>
        </div>
        <p className="mt-3 rounded-lg border border-edge bg-base p-2 text-xs text-muted">
          Your theme follows your account — change it on any device and it syncs everywhere.
        </p>
      </div>
      <ThemeManager open={themeOpen} onClose={() => setThemeOpen(false)} />

      <div className="rounded-xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <div>
              <p className="text-sm font-semibold text-primary">Sign in with Google</p>
              <p className="text-xs text-secondary">
                Users sign in with their Google account and get linked to their existing ITMS account by email.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={enabled ?? cfg.enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-11 rounded-full bg-edge2 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-5" />
          </label>
        </div>

        {enabled ?? cfg.enabled ? (
          <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
            SSO is enabled — the login page shows “Continue with Google”. Local logins stay available as fallback.
          </p>
        ) : (
          <p className="mt-3 rounded-lg border border-edge bg-base p-2 text-xs text-muted">
            Disabled — local accounts remain the only way in. (Recommended until you've added your Google client below.)
          </p>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-secondary">OAuth Client ID</label>
            <input
              value={clientId ?? cfg.client_id}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890-xxxx.apps.googleusercontent.com"
              className="h-10 w-full rounded-lg border border-edge2 bg-base px-3 font-mono text-xs outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-secondary">OAuth Client Secret</label>
            <input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={cfg.has_secret ? '•••••••• (leave blank to keep)' : 'GOCSPX-…'}
              type="password"
              className="h-10 w-full rounded-lg border border-edge2 bg-base px-3 font-mono text-xs outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-secondary">
              Allowed domains <span className="normal-case text-muted">(comma-separated; empty = any existing account)</span>
            </label>
            <input
              value={domains ?? cfg.allowed_domains.join(', ')}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="e.g. sonalapparels.in, itms.local"
              className="h-10 w-full rounded-lg border border-edge2 bg-base px-3 font-mono text-xs outline-none focus:border-accent"
            />
            <p className="mt-1 text-[11px] text-muted">
              Security default: SSO never auto-creates accounts — it only links to existing users by email. A domain
              allowlist is strongly recommended.
            </p>
          </div>

          <div className="rounded-lg border border-edge bg-base p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary">Authorized redirect URI (Google Cloud → OAuth client → add this)</p>
            <p className="mt-1 select-all break-all font-mono text-[11px] text-accent">{redirectUri}</p>
          </div>

          {error && (
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
              <TriangleAlert className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          {saved && (
            <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved.
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() =>
                save.mutate({
                  enabled: enabled ?? cfg.enabled,
                  client_id: (clientId ?? cfg.client_id).trim() || undefined,
                  client_secret: clientSecret.trim() || undefined,
                  allowed_domains: (domains ?? cfg.allowed_domains.join(', ')).split(',').map((d) => d.trim()).filter(Boolean),
                })
              }
              disabled={save.isPending}
              loading={save.isPending}
              variant="primary"
              size="lg"
            >
              Save configuration
            </Button>
          </div>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Setup: Google Cloud Console → APIs &amp; Services → Credentials → Create OAuth client ID (Web application) →
        add the redirect URI above → paste the client ID + secret here → enable SSO. First sign-in test: use a Google
        account whose email already exists in ITMS (admin creates the account first if needed).
      </p>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Copy, Eye, EyeOff, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getOAuthAdmin, updateOAuthAdmin } from '@/api/client';
import type { OAuthConfig } from '@/api/types';
import ThemeManager, { THEMES } from '@/components/ThemeManager';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { cn, inputCls, labelCls } from '@/lib/utils';
import { getThemeMode, onThemeChanged, type ThemeMode } from '@/lib/theme';

/** Icon component that never renders stale after server hydration. */
function CurrentThemeSummary() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const meta = THEMES.find((t) => t.value === mode) ?? THEMES.find((t) => t.value === 'light') ?? THEMES[0];
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
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copyRedirectUri = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(redirectUri);
      } else {
        // Fallback for non-secure contexts (plain http, older browsers).
        const ta = document.createElement('textarea');
        ta.value = redirectUri;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — leave the URI selectable instead of failing loudly.
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        description="Appearance + Google SSO — configured here, no server edits needed."
      />

      {/* Theme manager — user-level preference, synced across devices */}
      <div className="rounded-xl glass-card p-5">
        <div className="flex items-center justify-between gap-3">
          <CurrentThemeSummary />
          <Button
            type="button"
            onClick={() => setThemeOpen(true)}
            variant="secondary"
            size="lg"
            className="shrink-0"
          >
            Change theme
          </Button>
        </div>
        <p className="mt-3 rounded-lg glass-dense p-2 text-xs text-muted">
          Your theme follows your account — change it on any device and it syncs everywhere.
        </p>
      </div>
      <ThemeManager open={themeOpen} onClose={() => setThemeOpen(false)} />

      <div className="rounded-xl glass-card p-5">
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
          <p className="mt-3 rounded-lg glass-dense p-2 text-xs text-muted">
            Disabled — local accounts remain the only way in. (Recommended until you've added your Google client below.)
          </p>
        )}

        <div className="mt-5 space-y-4">
          <div>
            <label className={labelCls} htmlFor="oauth-client-id">OAuth Client ID</label>
            <input
              id="oauth-client-id"
              value={clientId ?? cfg.client_id}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890-xxxx.apps.googleusercontent.com"
              className={cn(inputCls, 'font-mono text-xs')}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="oauth-client-secret">OAuth Client Secret</label>
            <div className="relative">
              <input
                id="oauth-client-secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={cfg.has_secret ? '•••••••• (leave blank to keep)' : 'GOCSPX-…'}
                type={showSecret ? 'text' : 'password'}
                autoComplete="new-password"
                className={cn(inputCls, 'pr-11 font-mono text-xs')}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-pressed={showSecret}
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                title={showSecret ? 'Hide secret' : 'Show secret'}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="oauth-allowed-domains">
              Allowed domains <span className="normal-case text-muted">(comma-separated; empty = any existing account)</span>
            </label>
            <input
              id="oauth-allowed-domains"
              value={domains ?? cfg.allowed_domains.join(', ')}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com"
              className={cn(inputCls, 'font-mono text-xs')}
            />
            <p className="mt-1 text-[11px] text-muted">
              Security default: SSO never auto-creates accounts — it only links to existing users by email. A domain
              allowlist is strongly recommended.
            </p>
          </div>

          <div className="rounded-lg glass-dense p-3">
            <label className={labelCls} htmlFor="oauth-redirect-uri">Authorized redirect URI (Google Cloud → OAuth client → add this)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="oauth-redirect-uri"
                value={redirectUri}
                readOnly
                onFocus={(e) => e.target.select()}
                className={cn(inputCls, 'select-all break-all font-mono text-[11px] text-accent')}
              />
              <Button
                type="button"
                onClick={copyRedirectUri}
                variant="secondary"
                size="sm"
                aria-label="Copy redirect URI"
                title="Copy redirect URI"
                leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                className="shrink-0"
              >
                <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
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

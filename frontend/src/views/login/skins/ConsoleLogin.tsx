import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useLogin } from '../useLogin';

/**
 * Console login skin (console theme): dark ops-console centered card ported
 * from mockup 002-dark-console. Near-black `#09090b`, emerald `#10b981`
 * primary, JetBrains Mono micro-labels via `font-mono2`, status line, grid
 * texture. All auth behavior comes from useLogin() — this file is
 * presentation only.
 *
 * Intentional non-token colors (no var(--t-*) exists for these; task-14 sweep):
 * grid texture (rgba(255,255,255,.025)), on-accent ink (#04120c), Google G
 * brand fills (legacy verbatim). Accent glow + dot halo are token-driven
 * (var(--t-accent), pinned by the sweep test).
 */
export default function ConsoleLogin() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    flash,
    oauthEnabled,
    submit,
    onDemoClick,
    loginPending,
    loginError,
    demoPending,
  } = useLogin();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-base p-6 font-body text-primary antialiased">
      {/* grid texture */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage:
            'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
        }}
      />
      {/* emerald glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[8%] h-[300px] w-[560px] max-w-[90vw] -translate-x-1/2"
        style={{
          background:
            'radial-gradient(ellipse, color-mix(in srgb, var(--t-accent) 9%, transparent), transparent 70%)',
        }}
      />

      <div className="relative z-[1] w-full max-w-[360px]">
        <p className="mb-[22px] flex items-center justify-center gap-2 font-mono2 text-[11.5px] text-muted">
          <span
            aria-hidden
            className="h-[7px] w-[7px] animate-pulse rounded-full bg-accent shadow-[0_0_8px_var(--t-accent)]"
          />
          all systems operational · eu-west
        </p>

        <div className="rounded-[14px] border border-edge bg-surface px-7 pb-[26px] pt-[30px]">
          <div className="mb-[22px] flex items-center gap-2.5">
            <div
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg border border-accent/35 bg-accent/10 font-mono2 text-[15px] font-medium text-accent"
            >
              ▚
            </div>
            <b className="text-[15px] font-semibold tracking-[0.02em]">itms</b>
          </div>

          <h1 className="text-[19px] font-semibold tracking-[-0.01em]">
            Sign in
          </h1>
          <p className="mb-5 mt-1.5 font-mono2 text-xs text-muted">
            $ ssh operator@itms — authenticate to continue
          </p>

          {loginError && (
            <div
              role="alert"
              className="mb-3.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 font-mono2 text-[12.5px] text-red-300"
            >
              {loginError}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="mb-3.5">
              <label
                htmlFor="console-email"
                className="mb-1.5 block font-mono2 text-[11px] tracking-[0.04em] text-muted"
              >
                EMAIL
              </label>
              <input
                id="console-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.com"
                className="w-full rounded-lg border border-edge bg-input px-3 py-2.5 text-sm text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
              />
            </div>
            <div className="mb-1.5">
              <label
                htmlFor="console-password"
                className="mb-1.5 block font-mono2 text-[11px] tracking-[0.04em] text-muted"
              >
                PASSPHRASE
              </label>
              <div className="relative">
                <input
                  id="console-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-edge bg-input px-3 py-2.5 pr-16 text-sm text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1.5 font-mono2 text-[11px] text-muted transition-colors hover:text-primary"
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loginPending}
              className="mt-1.5 w-full rounded-lg bg-accent p-[11px] text-sm font-semibold text-[#04120c] transition hover:brightness-110 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {loginPending ? (
                <>
                  <LoaderCircle className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                  verifying…
                </>
              ) : (
                'Authenticate ↵'
              )}
            </button>
          </form>

          {oauthEnabled && (
            <a
              href="/api/v1/auth/oauth/start"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-transparent p-[11px] text-sm font-medium text-primary transition hover:bg-elevated"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                />
              </svg>
              Continue with Google
            </a>
          )}

          <div className="mt-3.5 flex items-center justify-between text-[12.5px]">
            <button
              type="button"
              onClick={onDemoClick}
              disabled={demoPending}
              className="text-muted transition-colors hover:text-accent disabled:cursor-wait disabled:opacity-70"
            >
              {demoPending ? 'signing in…' : '→ use demo account'}
            </button>
            <Link
              to="/forgot-password"
              className="text-muted transition-colors hover:text-accent"
            >
              forgot passphrase?
            </Link>
          </div>

          {flash && (
            <p
              role="status"
              className="mt-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 font-mono2 text-[12.5px] text-amber-300"
            >
              {flash}
            </p>
          )}
        </div>

        <p className="mt-[18px] text-center font-mono2 text-[10.5px] text-muted">
          argon2 · revocable sessions · build {__BUILD_SHA__}
        </p>
      </div>
    </div>
  );
}

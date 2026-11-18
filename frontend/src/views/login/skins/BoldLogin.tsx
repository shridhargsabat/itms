import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useLogin } from '../useLogin';

/**
 * Bold login skin (bold theme): brand-forward dark split layout ported from
 * mockup 003-bold-brand. Void base, mesh blobs, Space Grotesk mega-type via
 * `font-display`, lime CTA. Stat numbers (`1,284 / 98% / 36s`) and
 * fleet-health bar widths are static literals per the design — no live data,
 * no new API. All auth behavior comes from useLogin() — this file is
 * presentation only.
 *
 * Intentional non-token colors (no var(--t-*) exists for these; later sweep):
 * mesh-blob fills, mega-type gradient stops, fleet-bar gradients, lime ink.
 */
export default function BoldLogin() {
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
    <div className="flex min-h-dvh bg-base font-body text-primary antialiased">
      {/* mesh drift: scoped to this skin; decorative only */}
      <style>{`@keyframes bold-drift { to { transform: translate(50px, 36px) scale(1.08); } }
@media (prefers-reduced-motion: reduce) { .bold-blob { animation: none !important; } }`}</style>

      {/* hero panel */}
      <aside className="relative hidden min-[901px]:flex flex-[1.25] flex-col justify-between overflow-hidden p-12">
        <div
          aria-hidden
          className="bold-blob pointer-events-none absolute rounded-full"
          style={{
            width: 480,
            height: 480,
            top: -140,
            left: -120,
            background: '#5b21b6',
            filter: 'blur(90px)',
            opacity: 0.55,
            animation: 'bold-drift 14s ease-in-out infinite alternate',
          }}
        />
        <div
          aria-hidden
          className="bold-blob pointer-events-none absolute rounded-full"
          style={{
            width: 380,
            height: 380,
            bottom: -120,
            right: -80,
            background: '#9d174d',
            filter: 'blur(90px)',
            opacity: 0.55,
            animation: 'bold-drift 18s ease-in-out infinite alternate-reverse',
          }}
        />
        <div
          aria-hidden
          className="bold-blob pointer-events-none absolute rounded-full"
          style={{
            width: 220,
            height: 220,
            top: '40%',
            left: '45%',
            background: '#3f6212',
            filter: 'blur(90px)',
            opacity: 0.4,
            animation: 'bold-drift 11s ease-in-out infinite alternate',
          }}
        />

        <div className="relative z-[1] flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[0.02em]">
          <div
            aria-hidden
            className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-accent text-[18px] font-bold"
            style={{ color: '#131a05' }}
          >
            I
          </div>
          ITMS
        </div>

        <div className="relative z-[1]">
          <p className="font-display text-[clamp(40px,5vw,68px)] font-bold leading-[1.02] tracking-[-0.03em]">
            Run IT like <span className="text-accent">clockwork.</span>
            <br />
            <span
              style={{
                background: 'linear-gradient(92deg, #e879f9, #8b5cf6)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Assets. Tickets. Truth.
            </span>
          </p>
          <p className="mt-4 max-w-[30em] text-base leading-relaxed text-muted">
            The unified IT management system — ITAM, ITSM and CMDB in one
            fast, searchable home.
          </p>

          <div className="mt-[30px] flex flex-wrap gap-3">
            <div
              className="min-w-[130px] rounded-[14px] border px-[18px] py-[14px] backdrop-blur-lg"
              style={{
                background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
                borderColor: 'var(--t-glass-edge)',
              }}
            >
              <b className="block font-display text-[26px] text-accent">1,284</b>
              <span className="text-xs text-muted">assets tracked</span>
            </div>
            <div
              className="min-w-[130px] rounded-[14px] border px-[18px] py-[14px] backdrop-blur-lg"
              style={{
                background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
                borderColor: 'var(--t-glass-edge)',
              }}
            >
              <b className="block font-display text-[26px] text-accent">98%</b>
              <span className="text-xs text-muted">SLA hit rate</span>
            </div>
            <div
              className="min-w-[130px] rounded-[14px] border px-[18px] py-[14px] backdrop-blur-lg"
              style={{
                background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
                borderColor: 'var(--t-glass-edge)',
              }}
            >
              <b className="block font-display text-[26px] text-accent">36s</b>
              <span className="text-xs text-muted">median impact query</span>
            </div>
          </div>

          <div
            className="mt-[14px] max-w-[430px] rounded-[14px] border px-4 py-[14px] backdrop-blur-lg"
            style={{
              background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
              borderColor: 'var(--t-glass-edge)',
            }}
          >
            <div className="mb-2.5 flex justify-between text-xs text-muted">
              <span>LIVE · fleet health</span>
              <span>▲ +4.2%</span>
            </div>
            <div
              className="mb-2 h-2 overflow-hidden rounded-full"
              style={{ background: 'color-mix(in srgb, var(--t-primary) 10%, transparent)' }}
            >
              <i
                aria-hidden
                className="block h-full rounded-full"
                style={{ width: '86%', background: 'linear-gradient(90deg,#d4ff3f,#a3e635)' }}
              />
            </div>
            <div
              className="mb-2 h-2 overflow-hidden rounded-full"
              style={{ background: 'color-mix(in srgb, var(--t-primary) 10%, transparent)' }}
            >
              <i
                aria-hidden
                className="block h-full rounded-full"
                style={{ width: '64%', background: 'linear-gradient(90deg,#8b5cf6,#e879f9)' }}
              />
            </div>
            <div
              className="h-2 overflow-hidden rounded-full"
              style={{ background: 'color-mix(in srgb, var(--t-primary) 10%, transparent)' }}
            >
              <i
                aria-hidden
                className="block h-full rounded-full"
                style={{ width: '42%', background: 'linear-gradient(90deg,#22d3ee,#8b5cf6)' }}
              />
            </div>
          </div>
        </div>

        <div className="relative z-[1]" />
      </aside>

      {/* form side */}
      <main className="flex flex-1 items-center justify-center bg-black/25 p-10">
        <div className="w-full max-w-[360px]">
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">
            Let&apos;s get you in ⚡
          </h1>
          <p className="mb-6 mt-2 text-sm text-muted">
            Sign in to your IT command center.
          </p>

          {loginError && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-[13.5px] text-red-300"
            >
              {loginError}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="mb-4">
              <label
                htmlFor="bold-email"
                className="mb-[7px] block text-xs font-semibold uppercase tracking-[0.06em] text-muted"
              >
                Email
              </label>
              <input
                id="bold-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-edge bg-input px-3.5 py-3 text-[15px] text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
              />
            </div>
            <div className="mb-4">
              <label
                htmlFor="bold-password"
                className="mb-[7px] block text-xs font-semibold uppercase tracking-[0.06em] text-muted"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="bold-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-edge bg-input px-3.5 py-3 pr-16 text-[15px] text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:text-primary"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loginPending}
              className="w-full rounded-xl bg-accent p-[13px] font-display text-[15px] font-bold transition hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              style={{ color: '#131a05' }}
            >
              {loginPending ? (
                <>
                  <LoaderCircle className="mr-2 inline h-[15px] w-[15px] animate-spin" />
                  Warping in…
                </>
              ) : (
                <>Sign in →</>
              )}
            </button>
          </form>

          {oauthEnabled && (
            <a
              href="/api/v1/auth/oauth/start"
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border p-[13px] text-sm font-medium text-primary transition hover:brightness-125"
              style={{
                background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
                borderColor: 'var(--t-glass-edge)',
              }}
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

          <button
            type="button"
            onClick={onDemoClick}
            disabled={demoPending}
            className="mt-2.5 w-full rounded-xl border p-[13px] text-sm font-medium text-primary transition hover:brightness-125 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            style={{
              background: 'color-mix(in srgb, var(--t-primary) 6%, transparent)',
              borderColor: 'var(--t-glass-edge)',
            }}
          >
            {demoPending ? (
              <>
                <LoaderCircle className="mr-2 inline h-[15px] w-[15px] animate-spin" />
                Signing in…
              </>
            ) : (
              <>✨ One-click demo account</>
            )}
          </button>

          <Link
            to="/forgot-password"
            className="mt-4 block text-center text-[13px] text-muted transition-colors hover:text-accent"
          >
            Forgot password?
          </Link>

          {flash && (
            <p
              role="status"
              className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-[13.5px] text-amber-300"
            >
              {flash}
            </p>
          )}

          <p className="mt-[26px] text-center text-xs text-muted">
            argon2 · revocable sessions · build {__BUILD_SHA__}
          </p>
        </div>
      </main>
    </div>
  );
}

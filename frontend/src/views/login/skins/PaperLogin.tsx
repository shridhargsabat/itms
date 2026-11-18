import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useLogin } from '../useLogin';

/**
 * Paper login skin (default theme): warm-paper split layout ported from
 * mockup 001-warm-paper. Opaque surfaces (no glass utilities), forest
 * brand panel, Fraunces display type via `font-display`, hairline borders.
 * All auth behavior comes from useLogin() — this file is presentation only.
 */
export default function PaperLogin() {
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
      {/* brand panel */}
      <aside className="relative hidden min-[861px]:flex flex-[1.1] flex-col justify-between overflow-hidden bg-[#14301f] p-14 text-[#f2efe6]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(242,239,230,.07) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        />
        <div className="relative z-[1] flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[10px] border-[1.5px] border-[#f2efe6]/50 font-display text-[22px] font-semibold">
            I
          </div>
          <span className="text-[13px] font-semibold tracking-[0.14em]">ITMS</span>
        </div>
        <div className="relative z-[1]">
          <p className="max-w-[12em] font-display text-[clamp(34px,4vw,52px)] font-medium leading-[1.08] tracking-[-0.01em]">
            Every asset, ticket &amp; dependency,{' '}
            <em className="italic text-[#d8cfae]">finally in one ledger.</em>
          </p>
          <ul className="mt-7 grid gap-3.5">
            <li className="flex items-baseline gap-3 text-[15px] text-[#cfc9b8]">
              <span className="font-display text-sm text-[#8fae94]">01</span>
              <span>
                <b className="font-semibold text-[#f2efe6]">ITAM</b> — hardware
                inventory, assignments &amp; lifecycle
              </span>
            </li>
            <li className="flex items-baseline gap-3 text-[15px] text-[#cfc9b8]">
              <span className="font-display text-sm text-[#8fae94]">02</span>
              <span>
                <b className="font-semibold text-[#f2efe6]">ITSM</b> — incidents,
                requests &amp; priority matrices
              </span>
            </li>
            <li className="flex items-baseline gap-3 text-[15px] text-[#cfc9b8]">
              <span className="font-display text-sm text-[#8fae94]">03</span>
              <span>
                <b className="font-semibold text-[#f2efe6]">CMDB</b> — dependency
                maps with impact analysis
              </span>
            </li>
          </ul>
        </div>
        <p className="relative z-[1] max-w-[34em] border-t border-[#f2efe6]/20 pt-5 text-[13.5px] leading-relaxed text-[#b9b29e]">
          “We replaced three spreadsheets and a wiki page with ITMS. Audit
          season is boring now — in the best way.” — Demo customer, probably
        </p>
      </aside>

      {/* form side */}
      <main className="flex flex-1 items-center justify-center p-10">
        <div className="w-full max-w-[380px]">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.01em]">
            Welcome back
          </h1>
          <p className="mb-7 mt-2 text-sm text-secondary">
            Sign in to your IT workspace to continue.
          </p>

          {loginError && (
            <div
              role="alert"
              className="mb-4 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[13.5px] text-red-800"
            >
              {loginError}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="mb-[18px]">
              <label
                htmlFor="paper-email"
                className="mb-[7px] block text-xs font-semibold uppercase tracking-[0.08em] text-secondary"
              >
                Work email
              </label>
              <input
                id="paper-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-[10px] border border-edge bg-input px-3.5 py-3 text-[15px] text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20"
              />
            </div>
            <div className="mb-[18px]">
              <label
                htmlFor="paper-password"
                className="mb-[7px] block text-xs font-semibold uppercase tracking-[0.08em] text-secondary"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="paper-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-[10px] border border-edge bg-input px-3.5 py-3 pr-16 text-[15px] text-primary transition placeholder:text-muted focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-primary"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div className="mb-5 mt-1 flex items-center justify-end text-[13.5px]">
              <Link
                to="/forgot-password"
                className="font-medium text-accent hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <button
              type="submit"
              disabled={loginPending}
              className="w-full rounded-[10px] bg-[#14301f] p-[13px] text-[15px] font-semibold text-[#f2efe6] transition hover:bg-[#1d4229] active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {loginPending ? (
                <>
                  <LoaderCircle className="mr-2 inline h-[15px] w-[15px] animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {flash && (
            <p
              role="status"
              className="mt-[18px] rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13.5px] text-amber-900"
            >
              {flash}
            </p>
          )}

          <div className="mt-[22px] flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-edge" />
            {oauthEnabled ? 'or continue with' : 'or'}
            <span className="h-px flex-1 bg-edge" />
          </div>

          {oauthEnabled && (
            <a
              href="/api/v1/auth/oauth/start"
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[10px] border border-edge bg-transparent p-[13px] text-[15px] font-semibold text-primary transition hover:border-muted hover:bg-surface"
            >
              <span aria-hidden>◉</span> Continue with Google
            </a>
          )}

          <button
            type="button"
            onClick={onDemoClick}
            disabled={demoPending}
            className="mt-2.5 w-full rounded-[10px] border border-edge bg-transparent p-[13px] text-[15px] font-semibold text-primary transition hover:border-muted hover:bg-surface active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
          >
            {demoPending ? (
              <>
                <LoaderCircle className="mr-2 inline h-[15px] w-[15px] animate-spin" />
                Signing in…
              </>
            ) : (
              'Use demo account'
            )}
          </button>
          <p className="mt-2.5 text-center text-xs text-muted">
            One-click showcase account — no password needed
          </p>

          <p className="mt-[26px] text-center text-xs text-muted">
            Real auth — argon2 hashes + revocable sessions · build{' '}
            {__BUILD_SHA__}
          </p>
        </div>
      </main>
    </div>
  );
}

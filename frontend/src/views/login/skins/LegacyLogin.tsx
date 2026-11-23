import { Link } from 'react-router-dom';
import { ArrowRight, KeyRound, LoaderCircle, Network, ShieldCheck } from 'lucide-react';
import AnimatedBackground from '@/components/AnimatedBackground';
import { LiquidGlassFilterBank, LiquidGlassSurface } from '@/components/LiquidGlass';
import { useLogin } from '../useLogin';

/**
 * Real auth login (backend + DB). Any seeded user works: <email> / demo1234
 * (until #87 rotation lands — after that only the demo account uses the
 * demo button, which calls POST /auth/demo server-side: no credentials in
 * the JS bundle).
 *
 * Frozen legacy skin: JSX is verbatim the pre-themes Login page. Only the
 * state source changed (useLogin() hook instead of local state).
 */
export default function LegacyLogin() {
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

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-base px-4">
      <AnimatedBackground />
      <LiquidGlassFilterBank />

      {/* glass card */}
      <div className="animate-fade-up relative w-full max-w-md">
        <div className="animate-pulse-ring rounded-2xl p-px">
          <LiquidGlassSurface variant="card" elastic interactive className="rounded-2xl p-8">
            <div className="mb-7 flex flex-col items-center gap-3">
              <div className="relative">
                <span className="animate-ping-slow absolute inset-0 rounded-2xl bg-accent/30" />
                <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
                  <Network className="h-7 w-7 text-white" />
                </span>
              </div>
              <div className="text-center">
                <h1 className="animate-shimmer bg-gradient-to-r from-indigo-300 via-white to-indigo-300 bg-[length:200%_auto] bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                  ITMS
                </h1>
                <p className="mt-1 text-xs text-secondary">IT Management System · Prototype</p>
              </div>
            </div>

            {loginError && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                {loginError}
              </div>
            )}

            <form className="space-y-4" onSubmit={submit}>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-secondary">
                  Email
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-lg glass-dense px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-secondary">
                  Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg glass-dense px-4 py-3 text-sm text-primary placeholder:text-muted focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loginPending}
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97] disabled:opacity-60"
              >
                {loginPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            {flash && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">{flash}</p>}

            {oauthEnabled && (
              <>
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="h-px flex-1 bg-edge2" />
                  or
                  <span className="h-px flex-1 bg-edge2" />
                </div>
                <a
                  href="/api/v1/auth/oauth/start"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg glass-dense text-sm font-medium text-primary transition-colors hover:bg-elevated"
                >
                  <KeyRound className="h-4 w-4" /> Continue with Google
                </a>
              </>
            )}

            <Link
              to="/forgot-password"
              className="mt-3 block text-center text-xs text-secondary transition-colors hover:text-accent hover:underline"
            >
              Forgot password?
            </Link>

            <div className="mt-8 flex items-center gap-3 text-[11px] text-muted">
              <span className="h-px flex-1 bg-elevated" />
              demo
              <span className="h-px flex-1 bg-elevated" />
            </div>
            <button
              onClick={onDemoClick}
              disabled={demoPending}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg glass-dense text-sm font-medium text-primary transition-all hover:border-indigo-500/50 hover:bg-elevated active:scale-[0.97] disabled:opacity-60"
            >
              {demoPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                'Use demo account'
              )}
            </button>
            <p className="mt-4 text-center text-[11px] text-muted">
              One-click showcase account — no password needed
            </p>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
              Real auth — argon2 hashes + revocable sessions · build {__BUILD_SHA__}
            </p>
          </LiquidGlassSurface>
        </div>
      </div>
    </div>
  );
}

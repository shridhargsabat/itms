import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useLogin } from '../useLogin';

/**
 * Shell login skin (shell theme): blurred static app-dashboard backdrop with
 * a light scrim and a white sign-in modal, ported from mockup 005-app-shell.
 * Indigo `#4f46e5` primary via `bg-accent`. The backdrop (sidebar, stat
 * cards, asset rows) is literal fake markup — no data fetching, no live
 * state. All auth behavior comes from useLogin() — this file is
 * presentation only.
 *
 * Intentional non-token colors (no var(--t-*) exists for these; task-14 sweep):
 * active-nav ink (#fff — on-primary white), blurred-backdrop micro-grays
 * (#94a3b8, #64748b), row dividers (#f1f5f9), delta green (#16a34a),
 * status pills (tailwind green/amber/blue-100/800), Google G brand fills
 * (legacy verbatim), error/flash treatments (paper light-theme precedent:
 * red/amber-50/200).
 */
export default function ShellLogin() {
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
  const [peeking, setPeeking] = useState(false);

  return (
    <div className="relative h-dvh overflow-hidden bg-base font-body text-primary antialiased">
      {/* modal entrance: scoped to this skin; decorative only */}
      <style>{`@keyframes shell-rise { from { transform: translateY(16px) scale(.98); opacity: 0; } }
.shell-modal { animation: shell-rise .35s cubic-bezier(.2,.9,.3,1.1); }
@media (prefers-reduced-motion: reduce) { .shell-modal { animation: none !important; } }`}</style>

      {/* blurred static dashboard backdrop: literal fake rows, no data fetching */}
      <div
        data-testid="shell-backdrop"
        data-peeking={peeking ? 'true' : 'false'}
        aria-hidden
        className="pointer-events-none flex h-full w-full select-none"
        style={{
          filter: peeking ? 'none' : 'blur(7px) saturate(.85)',
          opacity: peeking ? 1 : 0.8,
          transform: 'scale(1.02)',
        }}
      >
        {/* fake sidebar */}
        <div
          className="hidden w-[220px] shrink-0 flex-col gap-1 px-3.5 py-5 min-[761px]:flex"
          style={{ background: 'var(--t-primary)', color: 'var(--t-elevated2)' }}
        >
          <p className="px-2.5 pb-4 pt-1 text-[15px] font-bold text-white">⬢ ITMS</p>
          {['Dashboard', 'Assets', 'Tickets', 'CMDB', 'Users', 'Reports', 'Settings'].map((item) => (
            <p
              key={item}
              className="rounded-lg px-2.5 py-2 text-[13.5px]"
              style={
                item === 'Dashboard'
                  ? {
                      background: 'color-mix(in srgb, var(--t-accent) 25%, transparent)',
                      color: '#fff',
                    }
                  : { color: '#94a3b8' }
              }
            >
              {item}
            </p>
          ))}
        </div>
        {/* fake main column */}
        <div className="min-w-0 flex-1 px-[26px] py-[22px]">
          <div className="mb-5 flex items-center justify-between">
            <b className="text-lg">Dashboard</b>
            <div className="w-[260px] max-w-[40vw] rounded-lg border border-edge bg-surface px-3.5 py-2 text-[13px]" style={{ color: '#94a3b8' }}>
              Search assets, tickets, people…
            </div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3.5 min-[761px]:grid-cols-4">
            {[
              ['Total assets', '1,284', '▲ 4.2%'],
              ['Open tickets', '32', '▼ 8.1%'],
              ['SLA compliance', '98%', '▲ 1.0%'],
              ['Licenses expiring', '6', 'attention'],
            ].map(([label, value, delta]) => (
              <div key={label} className="rounded-xl border border-edge bg-surface p-4">
                <small className="text-[11.5px]" style={{ color: '#64748b' }}>{label}</small>
                <b className="mt-1 block text-2xl">{value}</b>
                <span className="text-[11.5px] font-semibold" style={{ color: '#16a34a' }}>{delta}</span>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-edge bg-surface">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] bg-input px-[18px] py-3 text-[11.5px] font-semibold" style={{ color: '#64748b' }}>
              <span>ASSET</span>
              <span>ASSIGNEE</span>
              <span>STATUS</span>
              <span>UPDATED</span>
            </div>
            {[
              ['MBP-14 · Ananya Rao', 'Ananya Rao', 'In use', 'bg-green-100 text-green-800', '2h ago'],
              ['DL-5420 · Vikram S.', 'Vikram Shah', 'Maintenance', 'bg-amber-100 text-amber-800', '5h ago'],
              ['SRV-PROX-02', 'Infra team', 'In stock', 'bg-blue-100 text-blue-800', '1d ago'],
              ['LG-27UP850 · QA lab', 'QA lab', 'In use', 'bg-green-100 text-green-800', '2d ago'],
            ].map(([asset, assignee, status, pill, updated]) => (
              <div
                key={asset}
                className="grid grid-cols-[1.4fr_1fr_1fr_1fr] border-b px-[18px] py-3 text-[13px] last:border-b-0"
                style={{ borderColor: '#f1f5f9' }}
              >
                <span>{asset}</span>
                <span>{assignee}</span>
                <span>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pill}`}>
                    {status}
                  </span>
                </span>
                <span>{updated}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* light scrim + modal */}
      <div
        className="absolute inset-0 flex items-center justify-center p-6"
        style={{
          background: peeking
            ? 'color-mix(in srgb, var(--t-primary) 12%, transparent)'
            : 'color-mix(in srgb, var(--t-primary) 45%, transparent)',
        }}
      >
        <div
          className="shell-modal w-full max-w-[380px] rounded-2xl bg-surface px-[30px] pb-7 pt-8"
          style={{
            boxShadow: '0 24px 70px color-mix(in srgb, var(--t-primary) 40%, transparent)',
          }}
        >
          <div className="mb-[18px] flex items-center gap-2.5">
            <div
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent text-lg font-bold text-white"
            >
              I
            </div>
            <div>
              <b className="block text-[15px]">ITMS</b>
              <span className="block text-[11.5px] text-muted">IT Management System</span>
            </div>
          </div>

          <h1 className="text-xl font-bold tracking-[-0.01em]">
            Sign in to continue
          </h1>
          <p className="mb-5 mt-1.5 text-[13.5px] text-muted">
            Your workspace is right behind this screen.
          </p>

          {loginError && (
            <div
              role="alert"
              className="mb-3.5 flex items-center gap-2 rounded-[9px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800"
            >
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loginError}
            </div>
          )}

          <form onSubmit={submit}>
            <div className="mb-3.5">
              <label
                htmlFor="shell-email"
                className="mb-1.5 block text-[12.5px] font-semibold text-secondary"
              >
                Email
              </label>
              <input
                id="shell-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-[9px] border border-edge bg-input px-3 py-[11px] text-[14.5px] text-primary transition placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-accent/15"
              />
            </div>
            <div className="mb-1.5">
              <label
                htmlFor="shell-password"
                className="mb-1.5 block text-[12.5px] font-semibold text-secondary"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="shell-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-[9px] border border-edge bg-input px-3 py-[11px] pr-16 text-[14.5px] text-primary transition placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-accent/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:text-primary"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loginPending}
              className="mt-1.5 w-full rounded-[9px] bg-accent p-3 text-[14.5px] font-semibold text-white transition hover:brightness-[1.07] active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {loginPending ? (
                <>
                  <LoaderCircle className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>Sign in</>
              )}
            </button>
          </form>

          <div className="mt-2 flex gap-2">
            {oauthEnabled && (
              <a
                href="/api/v1/auth/oauth/start"
                className="flex flex-1 items-center justify-center gap-2 rounded-[9px] border border-edge bg-surface p-3 text-[13.5px] font-medium text-secondary transition hover:bg-input"
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
                Google
              </a>
            )}
            <button
              type="button"
              onClick={onDemoClick}
              disabled={demoPending}
              className="flex-1 rounded-[9px] border border-edge bg-surface p-3 text-[13.5px] font-medium text-secondary transition hover:bg-input active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {demoPending ? (
                <>
                  <LoaderCircle className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>✨ Demo</>
              )}
            </button>
          </div>

          <Link
            to="/forgot-password"
            className="mt-3.5 block text-center text-[13px] text-muted transition-colors hover:text-accent"
          >
            Forgot password?
          </Link>

          {flash && (
            <p
              role="status"
              className="mt-3.5 rounded-[9px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900"
            >
              {flash}
            </p>
          )}
        </div>
      </div>

      {/* hold-to-peek: clears the blur/scrim while held (pointer or keyboard focus) */}
      <button
        type="button"
        onPointerDown={() => setPeeking(true)}
        onPointerUp={() => setPeeking(false)}
        onPointerLeave={() => setPeeking(false)}
        onPointerCancel={() => setPeeking(false)}
        onFocus={() => setPeeking(true)}
        onBlur={() => setPeeking(false)}
        aria-pressed={peeking}
        className="absolute bottom-3.5 left-1/2 z-[5] -translate-x-1/2 text-nowrap rounded-full border px-4 py-[7px] font-body text-xs transition max-[639px]:hidden"
        style={{
          background: 'color-mix(in srgb, var(--t-primary) 80%, transparent)',
          color: 'var(--t-edge)',
          borderColor: 'color-mix(in srgb, var(--t-surface) 15%, transparent)',
        }}
      >
        👁 hold to peek behind the blur
      </button>
    </div>
  );
}

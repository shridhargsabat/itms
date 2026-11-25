import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useLogin } from '../useLogin';

/**
 * Terminal login skin (terminal theme): phosphor-terminal window ported from
 * mockup 006-terminal. Traffic-light title bar, boot lines, prompt-style
 * rows, JetBrains Mono throughout via `font-body`, green `#4ade80` primary
 * via `text-accent`/`bg-accent`. The boot block is static decorative markup
 * (the mockup's JS typing was not ported — same final frame, no timers),
 * with real `<label>`+`<input>` underneath per R2/C4. The mockup's `demo`
 * credential-prefill and `demo`-as-email shortcut were NOT ported: the
 * `demo` affordance calls `onDemoClick()` → server mutation directly, the
 * hint line was rewritten to match, and the demo password literal appears
 * nowhere (not even here — see the security binding). `forgot --passphrase`
 * is an addition the mockup lacks (R1 contract + binding constraint). All
 * auth behavior comes from useLogin() — this file is presentation only.
 *
 * Intentional non-token colors (no var(--t-*) exists for these; task-14 sweep):
 * traffic-light dots (#ff5f57/#febc2e/#28c840), run-button ink (#04120a),
 * Google G brand fills (legacy verbatim), warn/error/flash tailwind
 * red/amber treatments (Console dark-theme precedent).
 */
export default function TerminalLogin() {
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

  const ghost =
    'rounded-[7px] border border-edge bg-transparent px-[18px] py-[9px] text-[13px] text-muted transition-colors hover:border-accent-strong hover:text-accent active:scale-[0.97] disabled:cursor-wait disabled:opacity-70';
  const cursor = (
    <span
      aria-hidden
      className="term-cursor pointer-events-none inline-block h-[15px] w-2 bg-accent align-[-2px]"
    />
  );

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-base p-6 font-body text-primary antialiased">
      {/* cursor blink: scoped to this skin; decorative only */}
      <style>{`@keyframes term-blink { 50% { opacity: 0; } }
.term-cursor { animation: term-blink 1s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) { .term-cursor { animation: none !important; } }`}</style>

      {/* scanlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(0deg, color-mix(in srgb, var(--t-primary) 3%, transparent) 0 1px, transparent 1px 3px)',
        }}
      />

      <div
        className="relative z-[1] w-full max-w-[600px] overflow-hidden rounded-xl border border-edge bg-surface"
        style={{
          boxShadow:
            '0 0 80px color-mix(in srgb, var(--t-accent) 7%, transparent), 0 24px 60px color-mix(in srgb, black 50%, transparent)',
        }}
      >
        {/* title bar */}
        <div
          aria-hidden
          className="pointer-events-none flex items-center gap-2 border-b border-edge bg-elevated px-4 py-3"
        >
          <span className="h-3 w-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#febc2e' }} />
          <span className="h-3 w-3 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-2 text-xs text-muted">operator@itms: ~/login</span>
        </div>

        <div className="px-[22px] pb-[26px] pt-[22px] text-sm leading-[1.75]">
          {/* boot lines: static final frame, decorative */}
          <div aria-hidden className="pointer-events-none whitespace-pre-wrap text-[12.5px] text-muted">
            <p>itms login service v0.1.0</p>
            <p>
              tls ............ <span className="text-accent">ok</span>
            </p>
            <p>
              postgres:5432 .. <span className="text-accent">ok</span> (18 ms)
            </p>
            <p>
              session store .. <span className="text-accent">ok</span>
            </p>
          </div>

          <h1 className="mb-[2px] mt-[14px] text-[17px] font-bold tracking-[0.02em] text-accent">
            ▚ ITMS{' '}
            <small className="text-xs font-normal text-muted">
              — it management system · v0.1.0
            </small>
          </h1>

          <form onSubmit={submit}>
            <div className="mt-[6px] flex flex-wrap items-center gap-[10px]">
              <label htmlFor="terminal-email" className="whitespace-nowrap text-accent">
                email
              </label>
              <span aria-hidden className="pointer-events-none whitespace-nowrap text-accent">
                _____ :
              </span>
              <input
                id="terminal-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.com"
                className="min-w-[200px] flex-1 rounded-none border-0 border-b border-edge bg-transparent px-[2px] py-1 text-sm text-primary caret-accent transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div className="mt-[6px] flex flex-wrap items-center gap-[10px]">
              <label htmlFor="terminal-password" className="whitespace-nowrap text-accent">
                passphrase
              </label>
              <span aria-hidden className="pointer-events-none whitespace-nowrap text-accent">
                :
              </span>
              <input
                id="terminal-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="min-w-[200px] flex-1 rounded-none border-0 border-b border-edge bg-transparent px-[2px] py-1 text-sm text-primary caret-accent transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>

            <p className="mt-3 text-xs text-muted">
              tip: run <b className="font-medium text-amber-400">demo</b> for the
              showcase account · <b className="font-medium text-amber-400">show</b> toggles
              echo
            </p>

            <div className="mt-4 flex flex-wrap gap-[10px]">
              <button
                type="submit"
                disabled={loginPending}
                className="rounded-[7px] border border-accent bg-accent px-[18px] py-[9px] text-[13px] font-bold transition hover:brightness-110 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
                style={{ color: '#04120a' }}
              >
                {loginPending ? (
                  <>
                    <LoaderCircle className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                    verifying…
                  </>
                ) : (
                  <>./signin.sh ↵</>
                )}
              </button>
              <button
                type="button"
                onClick={onDemoClick}
                disabled={demoPending}
                className={ghost}
              >
                {demoPending ? (
                  <>
                    <LoaderCircle className="mr-2 inline h-3.5 w-3.5 animate-spin" />
                    demo…
                  </>
                ) : (
                  <>demo</>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide passphrase' : 'Show passphrase'}
                aria-pressed={showPassword}
                className={ghost}
              >
                {showPassword ? 'hide' : 'show'}
              </button>
              {oauthEnabled && (
                <a
                  href="/api/v1/auth/oauth/start"
                  className={`inline-flex items-center gap-2 ${ghost}`}
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
                  sso --google
                </a>
              )}
              <Link to="/forgot-password" className={ghost}>
                forgot --passphrase
              </Link>
            </div>
          </form>

          <div className="mt-[14px] min-h-[20px] whitespace-pre-wrap text-[12.5px]">
            {loginError ? (
              <p role="alert" className="text-red-300">
                <span aria-hidden>✖ </span>
                {loginError} {cursor}
              </p>
            ) : flash ? (
              <p role="status" className="text-amber-300">
                {flash} {cursor}
              </p>
            ) : (
              <p>
                <span className="text-muted">awaiting input </span>
                {cursor}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/Button';
import { cn, inputCls, labelCls } from '@/lib/utils';
import { useLogin } from '../useLogin';

/**
 * Clarity login skin: precision operations UI. Centered single column on
 * bg-base, small wordmark, one opaque 400px card — no glass, gradients,
 * or animated background. All auth behavior comes from useLogin(); this
 * file is presentation only.
 */
export default function ClarityLogin() {
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
    <div className="flex min-h-dvh items-center justify-center bg-base px-4 py-12">
      <div className="w-full max-w-[400px]">
        <p className="mb-6 text-center text-xs font-semibold tracking-[0.2em] text-secondary">
          ITMS
        </p>

        <div className="rounded-xl border border-edge bg-surface p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">
            Sign in to ITMS
          </h1>
          <p className="mb-6 mt-1 text-sm text-secondary">
            Manage assets, tickets, and dependencies from one workspace.
          </p>

          {loginError && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-400"
            >
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loginError}
            </div>
          )}

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="clarity-email" className={labelCls}>
                Email
              </label>
              <input
                id="clarity-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="clarity-password" className={labelCls}>
                Password
              </label>
              <div className="relative">
                <input
                  id="clarity-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={cn(inputCls, 'pr-11')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:text-primary"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-accent hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Button type="submit" fullWidth size="lg" loading={loginPending}>
              Sign in
            </Button>
          </form>

          {flash && (
            <p
              role="status"
              className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300"
            >
              {flash}
            </p>
          )}

          {oauthEnabled && (
            <>
              <div className="my-4 flex items-center gap-2 text-xs text-muted">
                <span className="h-px flex-1 bg-edge" />
                or
                <span className="h-px flex-1 bg-edge" />
              </div>
              <a
                href="/api/v1/auth/oauth/start"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-edge bg-surface px-4 text-sm font-medium text-primary transition-colors hover:bg-elevated"
              >
                Continue with Google
              </a>
            </>
          )}

          <div className="my-4 flex items-center gap-2 text-xs text-muted">
            <span className="h-px flex-1 bg-edge" />
            Demo
            <span className="h-px flex-1 bg-edge" />
          </div>
          <Button
            variant="secondary"
            fullWidth
            size="lg"
            onClick={onDemoClick}
            loading={demoPending}
          >
            Use demo account
          </Button>
        </div>
      </div>
    </div>
  );
}

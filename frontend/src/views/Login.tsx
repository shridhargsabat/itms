import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Network, ShieldCheck } from 'lucide-react';

/** Stunning animated demo login — no real auth in the prototype;
 *  any credentials (or one-tap demo entry) sets the session flag. */
export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const enter = () => {
    localStorage.setItem(
      'itms_demo',
      JSON.stringify({ user: email.trim() || 'demo@itms.local', at: Date.now() }),
    );
    navigate('/');
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-950 px-4">
      {/* aurora blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-aurora absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full bg-indigo-600/25 blur-[110px]" />
        <div className="animate-aurora-slow absolute -bottom-48 -right-24 h-[520px] w-[520px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="animate-aurora absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-blue-500/15 blur-[100px]" />
      </div>

      {/* faint grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(148,163,184,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.4)_1px,transparent_1px)] [background-size:44px_44px]" />

      {/* rising particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="animate-particle absolute bottom-[-12px] h-1.5 w-1.5 rounded-full bg-indigo-300/60"
            style={{
              left: `${(i * 7.3 + 4) % 100}%`,
              animationDelay: `${(i % 7) * 1.1}s`,
              animationDuration: `${9 + (i % 5)}s`,
            }}
          />
        ))}
      </div>

      {/* glass card */}
      <div className="animate-fade-up relative w-full max-w-md">
        <div className="animate-pulse-ring rounded-2xl p-px">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-7 flex flex-col items-center gap-3">
              <div className="relative">
                <span className="animate-ping-slow absolute inset-0 rounded-2xl bg-indigo-500/30" />
                <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
                  <Network className="h-7 w-7 text-white" />
                </span>
              </div>
              <div className="text-center">
                <h1 className="animate-shimmer bg-gradient-to-r from-indigo-300 via-white to-indigo-300 bg-[length:200%_auto] bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                  ITMS
                </h1>
                <p className="mt-1 text-xs text-slate-400">IT Management System · Prototype</p>
              </div>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                enter();
              }}
            >
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-indigo-500/40 active:scale-[0.97]"
              >
                Sign In
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </form>

            <div className="mt-5 flex items-center gap-3 text-[11px] text-slate-500">
              <span className="h-px flex-1 bg-slate-800" />
              or
              <span className="h-px flex-1 bg-slate-800" />
            </div>
            <button
              onClick={enter}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-700 text-sm font-medium text-slate-200 transition-all hover:border-indigo-500/50 hover:bg-slate-800/60 active:scale-[0.97]"
            >
              Enter demo workspace
            </button>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
              Prototype — no real credentials needed
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

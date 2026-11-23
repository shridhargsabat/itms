/**
 * Ambient animated background shared by every screen (login + app shell):
 * drifting aurora blobs, a faint grid, and rising particles.
 * Fixed, pointer-events-none, sits behind content.
 *
 * Intentional non-token colors (no var(--t-*) exists for these; task-14 sweep):
 * pastel mesh tints + slate grid (rgba(148,163,184,0.4)). Shared by every
 * theme EXCEPT paper (see below), so tokenizing would restyle legacy —
 * kept literal deliberately.
 *
 * Paper theme replaces the cool pastel aurora with a warm ambient glow
 * (see .theme-paper rules in index.css): the mesh + blobs are hidden,
 * .ab-paper-glow shows warm fields instead, and particles turn warm dust.
 */
export default function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-transparent">
      {/* pastel mesh (light Liquid Glass only): soft color fields for the
          glass to refract. Dark themes keep the deep-slate void.
          Paper hides this (see .ab-paper-glow below). */}
      <div
        className="ab-mesh absolute inset-0 dark:hidden"
        style={{
          background: [
            'radial-gradient(60% 50% at 12% 6%, rgb(199 210 254 / 0.65), transparent 70%)',
            'radial-gradient(55% 45% at 88% 10%, rgb(153 246 228 / 0.50), transparent 70%)',
            'radial-gradient(50% 55% at 88% 92%, rgb(196 181 253 / 0.55), transparent 70%)',
            'radial-gradient(45% 40% at 8% 90%, rgb(186 230 253 / 0.55), transparent 70%)',
            'radial-gradient(40% 35% at 50% 45%, rgb(254 215 170 / 0.35), transparent 70%)',
          ].join(','),
        }}
      />
      {/* warm ambient (paper theme only — hidden everywhere else): amber,
          stone, and sage fields that harmonize with warm-paper surfaces. */}
      <div
        className="ab-paper-glow absolute inset-0 hidden"
        style={{
          background: [
            'radial-gradient(60% 50% at 12% 6%, rgb(253 230 138 / 0.45), transparent 70%)',
            'radial-gradient(55% 45% at 88% 10%, rgb(214 211 209 / 0.55), transparent 70%)',
            'radial-gradient(50% 55% at 88% 92%, rgb(188 205 170 / 0.45), transparent 70%)',
            'radial-gradient(45% 40% at 8% 90%, rgb(231 220 200 / 0.55), transparent 70%)',
          ].join(','),
        }}
      />
      {/* aurora blobs — stronger pastels in light, dark: values preserve the dark look */}
      <div className="ab-blobs absolute inset-0">
        <div className="animate-aurora absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full bg-indigo-400/45 blur-[130px] dark:bg-accent/35" />
        <div className="animate-aurora-slow absolute -bottom-48 -right-24 h-[520px] w-[520px] rounded-full bg-violet-400/40 blur-[140px] dark:bg-accent/30" />
        <div className="animate-aurora absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-300/50 blur-[120px] dark:bg-accent/25" />
        <div className="animate-aurora-slow absolute right-1/4 top-1/4 h-64 w-64 rounded-full bg-teal-300/45 blur-[110px] dark:bg-teal-400/20" />
      </div>

      {/* faint grid */}
      <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(148,163,184,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.4)_1px,transparent_1px)] [background-size:44px_44px]" />

      {/* rising particles */}
      <div className="ab-particles absolute inset-0 overflow-hidden">
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
    </div>
  );
}

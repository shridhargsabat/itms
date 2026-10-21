/**
 * Ambient animated background shared by every screen (login + app shell):
 * drifting aurora blobs, a faint grid, and rising particles.
 * Fixed, pointer-events-none, sits behind content.
 */
export default function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-transparent">
      {/* aurora blobs */}
      <div className="absolute inset-0">
        <div className="animate-aurora absolute -left-32 -top-40 h-[480px] w-[480px] rounded-full bg-accent/35 blur-[130px]" />
        <div className="animate-aurora-slow absolute -bottom-48 -right-24 h-[520px] w-[520px] rounded-full bg-accent/30 blur-[140px]" />
        <div className="animate-aurora absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" />
        <div className="animate-aurora-slow absolute right-1/4 top-1/4 h-64 w-64 rounded-full bg-teal-400/20 blur-[110px]" />
      </div>

      {/* faint grid */}
      <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(148,163,184,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.4)_1px,transparent_1px)] [background-size:44px_44px]" />

      {/* rising particles */}
      <div className="absolute inset-0 overflow-hidden">
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

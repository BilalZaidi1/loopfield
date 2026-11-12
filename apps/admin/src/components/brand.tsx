/** Wordmark: the app's hexagon "map" glyph around an amber title dot. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={32} height={32} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
        <rect width="32" height="32" rx="8" className="fill-[#0E1A14]" />
        <polygon points="16,5 25.5,10.5 25.5,21.5 16,27 6.5,21.5 6.5,10.5" fill="none" stroke="#7CE0A0" strokeWidth={2.6} strokeLinejoin="round" />
        <circle cx="16" cy="16" r="3.4" fill="#F4C448" />
      </svg>
      {compact ? null : (
        <div className="leading-tight">
          <div className="type-heading">Loopfield</div>
          <div className="type-caption text-muted">Console</div>
        </div>
      )}
    </div>
  );
}

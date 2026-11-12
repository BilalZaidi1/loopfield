/**
 * The Loopfield mark from the app (apps/mobile/src/components/Brand.tsx): an open loop with a runner's dot
 * at the gap — the moment before a loop closes and claims ground. Violet ring, orange dot, Figtree
 * Black Italic wordmark.
 */
export function LoopMark({ size = 34, ring = 'var(--lf-primary-fill)', dot = 'var(--lf-orange)' }: { size?: number; ring?: string; dot?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <path d="M82.84 41.2 A34 34 0 1 1 67 20.56" stroke={ring} strokeWidth={11} strokeLinecap="round" fill="none" />
      <circle cx={67} cy={20.56} r={7.5} fill={dot} />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LoopMark size={34} />
      {compact ? null : (
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] leading-[26px] font-black italic tracking-[-0.7px]">Loopfield</span>
          <span className="type-micro uppercase tracking-[0.08em] text-muted">Console</span>
        </div>
      )}
    </div>
  );
}

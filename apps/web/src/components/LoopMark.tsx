import { mark } from '@/theme/brand';

/** The open loop with the runner's dot at the gap: the moment before a loop closes and claims ground. */
export function LoopMark({ size = 32, ring = mark.ringColor, dot = mark.dotColor, className }: { size?: number; ring?: string; dot?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox={mark.viewBox} aria-hidden="true" className={className}>
      <path d={mark.ring} stroke={ring} strokeWidth={mark.strokeWidth} strokeLinecap="round" fill="none" />
      <circle cx={mark.dot.cx} cy={mark.dot.cy} r={mark.dot.r} fill={dot} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={`font-display font-black italic tracking-[-0.03em] ${className ?? ''}`}>Loopfield</span>;
}

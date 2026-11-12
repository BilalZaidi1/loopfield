/**
 * Minimal line icons in the app's style (apps/mobile/src/components/icons.tsx): 24px grid, 2px stroke,
 * round caps and joins. The first nine are the app's own; the rest follow the same rules.
 */
export type IconName =
  | 'home' | 'map' | 'record' | 'progress' | 'clubs' | 'bell' | 'chat' | 'search' | 'plus'
  | 'pulse' | 'sliders' | 'flag' | 'shield' | 'scale' | 'route' | 'users' | 'list' | 'layers'
  | 'logout' | 'sun' | 'moon' | 'check' | 'x' | 'chevron' | 'alert' | 'refresh' | 'clock' | 'lock' | 'history';

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      {name === 'home' && <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" {...p} />}
      {name === 'map' && <polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" {...p} />}
      {name === 'record' && (<><circle cx={12} cy={12} r={9} {...p} /><circle cx={12} cy={12} r={4} fill="currentColor" /></>)}
      {name === 'progress' && <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} />}
      {name === 'clubs' && (<><circle cx={8} cy={9} r={3} {...p} /><circle cx={16} cy={9} r={3} {...p} /><path d="M2 20c0-3 3-5 6-5s6 2 6 5M12 20c0-3 2-5 4-5s6 2 6 5" {...p} /></>)}
      {name === 'bell' && <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" {...p} />}
      {name === 'chat' && <path d="M4 5h16v11H9l-5 4z" {...p} />}
      {name === 'search' && (<><circle cx={11} cy={11} r={7} {...p} /><path d="M21 21l-5-5" {...p} /></>)}
      {name === 'plus' && <path d="M12 5v14M5 12h14" {...p} />}
      {name === 'pulse' && <path d="M2 12h4l3-7 4 14 3-7h6" {...p} />}
      {name === 'sliders' && (<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" {...p} /><circle cx={16} cy={6} r={2} {...p} /><circle cx={10} cy={12} r={2} {...p} /><circle cx={18} cy={18} r={2} {...p} /></>)}
      {name === 'flag' && <path d="M5 21V4M5 4h11l-2 4 2 4H5" {...p} />}
      {name === 'shield' && <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" {...p} />}
      {name === 'scale' && <path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z" {...p} />}
      {name === 'route' && (<><circle cx={6} cy={18} r={2} {...p} /><circle cx={18} cy={6} r={2} {...p} /><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" {...p} /></>)}
      {name === 'users' && (<><circle cx={9} cy={8} r={3.5} {...p} /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3 3 3 6" {...p} /></>)}
      {name === 'list' && <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" {...p} />}
      {name === 'layers' && <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5" {...p} />}
      {name === 'logout' && <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H3" {...p} />}
      {name === 'sun' && (<><circle cx={12} cy={12} r={4} {...p} /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} /></>)}
      {name === 'moon' && <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...p} />}
      {name === 'check' && <path d="M5 12.5l4.5 4.5L19 7.5" {...p} />}
      {name === 'x' && <path d="M6 6l12 12M18 6L6 18" {...p} />}
      {name === 'chevron' && <path d="M9 5l7 7-7 7" {...p} />}
      {name === 'alert' && <path d="M12 3l10 18H2zM12 10v4M12 18h.01" {...p} />}
      {name === 'refresh' && <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" {...p} />}
      {name === 'clock' && (<><circle cx={12} cy={12} r={9} {...p} /><path d="M12 7v5l3 2" {...p} /></>)}
      {name === 'lock' && (<><rect x={5} y={11} width={14} height={10} rx={2} {...p} /><path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} /></>)}
      {name === 'history' && <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" {...p} />}
    </svg>
  );
}

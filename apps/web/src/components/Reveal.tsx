'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';

/** Marks an element as shown the first time a fifth of it enters the viewport. */
export function useShown<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, shown] as const;
}

/**
 * Display lines that rise out of a mask, one after another, when they come into view. `show` takes over from the
 * viewport check where a section reveals its own content (behind a hex iris, say).
 */
export function Lines({
  lines,
  as = 'h2',
  className,
  delay = 0,
  show,
  id
}: {
  lines: readonly string[];
  as?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
  delay?: number;
  show?: boolean;
  id?: string;
}) {
  const [ref, inView] = useShown<HTMLHeadingElement>(0.3);
  const shown = show ?? inView;
  return createElement(
    as,
    { ref, id, className, 'data-shown': shown },
    lines.map((line, i) => (
      <span key={line} className="reveal-line">
        <span style={{ transitionDelay: `${delay + i * 90}ms` }}>{line}</span>
      </span>
    ))
  );
}

/** Lines for the hero: a CSS animation that runs on first paint, no JavaScript needed. */
export function HeroLines({ lines, className }: { lines: readonly string[]; className?: string }) {
  return (
    <h1 className={`reveal-now ${className ?? ''}`}>
      {lines.map((line, i) => (
        <span key={line} className="reveal-line">
          <span style={{ animationDelay: `${120 + i * 110}ms` }}>{line}</span>
        </span>
      ))}
    </h1>
  );
}

/** Fades its children up once in view. */
export function FadeUp({ children, className, delay = 0, as = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'p' | 'ul' | 'li' }) {
  const [ref, shown] = useShown<HTMLDivElement>(0.15);
  return createElement(as, { ref, className: `fade-up ${className ?? ''}`, 'data-shown': shown, style: { transitionDelay: `${delay}ms` } }, children);
}

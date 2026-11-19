'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { smoothstep, story, type Tier } from '@/story/state';
import { beats } from '@/story/world';
import { detectTier, isCompact } from '@/three/tiers';
import { useStory } from './useStory';

const Scene = dynamic(() => import('@/three/Scene'), { ssr: false });

/** A still hex field that stands in until the 3D is ready, and for devices without WebGL 2. */
function FallbackField({ hidden }: { hidden: boolean }) {
  return (
    <div className={`absolute inset-0 transition-opacity duration-1000 ${hidden ? 'opacity-0' : 'opacity-100'}`}>
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 1000">
        <defs>
          <pattern id="hex" width="34.64" height="60" patternUnits="userSpaceOnUse" patternTransform="scale(1.4)">
            <path d="M17.32 0 34.64 10v20L17.32 40 0 30V10zM17.32 40v20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="68%" cy="52%" r="38%">
            <stop offset="0" stopColor="#6762F0" stopOpacity="0.32" />
            <stop offset="1" stopColor="#6762F0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#101114" stopOpacity="0.9" />
            <stop offset="0.45" stopColor="#101114" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="1600" height="1000" fill="#101114" />
        <rect width="1600" height="1000" fill="url(#hex)" />
        <rect width="1600" height="1000" fill="url(#glow)" />
        <rect width="1600" height="1000" fill="url(#fade)" />
      </svg>
    </div>
  );
}

/**
 * The fixed 3D layer behind the page. Picks a tier, loads three.js only once the page has painted and the browser
 * is idle, fades the canvas in over the still field, and softens it during the privacy section.
 */
export function Stage() {
  const [tier, setTier] = useState<Tier>('none');
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const [compact, setCompact] = useState(false);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Decide the tier and start loading three.js once the page has painted and the browser is idle.
    const start = () => {
      const t = detectTier();
      story.tier = t;
      setTier(t);
      setCompact(isCompact());
      setLoad(t !== 'none');
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(start, 300);
    return () => window.clearTimeout(id);
  }, []);

  useStory((T) => {
    const wrap = canvasWrap.current;
    if (wrap) {
      const blur = smoothstep(beats.privacy.blurIn[0], beats.privacy.blurIn[1], T) * (1 - smoothstep(beats.privacy.blurOut[0], beats.privacy.blurOut[1], T));
      wrap.style.filter = blur > 0.01 && story.tier !== 'low' ? `blur(${(blur * 5).toFixed(2)}px) saturate(${(1 - blur * 0.35).toFixed(2)})` : '';
    }
    if (veil.current) veil.current.style.opacity = String(smoothstep(10.1, 10.6, T) * 0.7);
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <FallbackField hidden={ready} />
      <div ref={canvasWrap} className={`absolute inset-0 transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'}`}>
        {load && tier !== 'none' ? <Scene tier={tier} compact={compact} onReady={() => setReady(true)} /> : null}
      </div>
      <div ref={veil} className="absolute inset-0 bg-bg opacity-0" />
    </div>
  );
}

'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';

type LineString = { type: 'LineString'; coordinates: [number, number][] };
type Gate = { type: string; coordinates: [number, number][] } | undefined;

/**
 * Route preview: Mapbox when a public token is configured, otherwise a dependency-free SVG trace.
 * Land green for the path, primary for the start gate, title amber for the finish (the app's colours).
 */
export function RouteMap({ path, startGate, finishGate, token, height = 260 }: { path: LineString; startGate?: Gate; finishGate?: Gate; token: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(!token);

  useEffect(() => {
    if (!token || !ref.current || path.coordinates.length < 2) return;
    let map: import('mapbox-gl').Map | undefined;
    let cancelled = false;
    (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !ref.current) return;
        const root = document.documentElement;
        const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const css = getComputedStyle(root);
        const color = (v: string) => css.getPropertyValue(v).trim();
        const xs = path.coordinates.map((c) => c[0]);
        const ys = path.coordinates.map((c) => c[1]);
        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: ref.current,
          style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/outdoors-v12',
          bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
          fitBoundsOptions: { padding: 36 },
          cooperativeGestures: true
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('error', () => setFailed(true));
        map.on('load', () => {
          if (!map) return;
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: path, properties: {} } });
          map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color('--lf-route'), 'line-width': 5 } });
          const gates = [
            { id: 'start', g: startGate, c: color('--lf-start') },
            { id: 'finish', g: finishGate, c: color('--lf-finish') }
          ];
          for (const { id, g, c } of gates) {
            if (!g?.coordinates?.length) continue;
            map.addSource(id, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: g.coordinates }, properties: {} } });
            map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': c, 'line-width': 5 } });
          }
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [token, path, startGate, finishGate]);

  if (failed || path.coordinates.length < 2) return <RouteSvg path={path} height={height} />;
  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-md" role="img" aria-label="Map of the proposed route" />;
}

function RouteSvg({ path, height }: { path: LineString; height: number }) {
  const pts = path.coordinates;
  if (pts.length < 2) return <div className="type-caption text-muted">No route geometry.</div>;
  const lat0 = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * (Math.PI / 180);
  const proj = pts.map(([x, y]) => [x * Math.cos(lat0), -y] as const);
  const xs = proj.map((p) => p[0]);
  const ys = proj.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 600;
  const H = 300;
  const pad = 24;
  const scale = Math.min((W - pad * 2) / Math.max(maxX - minX, 1e-9), (H - pad * 2) / Math.max(maxY - minY, 1e-9));
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const d = proj.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * scale).toFixed(1)},${(oy + (y - minY) * scale).toFixed(1)}`).join(' ');
  const [sx, sy] = d.split(' ')[0]!.slice(1).split(',').map(Number);
  const last = d.split(' ').at(-1)!.slice(1).split(',').map(Number);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} className="w-full rounded-md bg-sunken" role="img" aria-label="Shape of the proposed route">
      <path d={d} fill="none" stroke="var(--lf-route-casing)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="var(--lf-route)" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx} cy={sy} r={7} fill="var(--lf-start)" stroke="var(--lf-route-casing)" strokeWidth={2} />
      <circle cx={last[0]} cy={last[1]} r={6} fill="var(--lf-finish)" stroke="var(--lf-route-casing)" strokeWidth={2} />
    </svg>
  );
}

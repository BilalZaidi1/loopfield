'use client';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Line2, LineMaterial } from 'three-stdlib';
import { sampleAlong } from '@/lib/hex';
import { smoothstep, span, story } from '@/story/state';
import { beats, routeGates } from '@/story/world';
import { palette, territory } from '@/theme/brand';
import { actorById, actorFraction, actors, type ActorSpec } from './actors';
import { dimAt } from './dim';

let haloTexture: THREE.Texture | null = null;
function halo(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  return haloTexture;
}

function vertexColors(spec: ActorSpec): THREE.Color[] {
  const { cum, length } = spec.track;
  const from = new THREE.Color(spec.gradient?.[0] ?? spec.solid ?? palette.primary);
  const to = new THREE.Color(spec.gradient?.[1] ?? spec.solid ?? palette.primary);
  const closing = spec.closing ? new THREE.Color(spec.closing) : null;
  return cum.map((d) => {
    const f = d / length;
    if (closing && f > spec.openFraction + 0.002) return closing.clone();
    return from.clone().lerp(to, Math.min(1, f / spec.openFraction));
  });
}

const routeGreen = new THREE.Color(territory.route);
const routeViolet = new THREE.Color(territory.routeMine);

function ActorView({ spec }: { spec: ActorSpec }) {
  const pathRef = useRef<Line2>(null);
  const casingRef = useRef<Line2>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Sprite>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const points = useMemo(() => spec.track.pts.map(([x, z]) => new THREE.Vector3(x, spec.y, z)), [spec]);
  const colors = useMemo(() => (spec.solid && !spec.closing ? undefined : vertexColors(spec)), [spec]);
  const start = spec.track.pts[0]!;
  const isRoute = spec.id === 'route';
  // The brand orange as is: brightening it past 1 clips red first and turns it yellow. The halo carries the glow.
  const dotColor = useMemo(() => new THREE.Color(spec.dot), [spec.dot]);

  useFrame((state) => {
    const T = story.value;
    const clock = spec.clock === 'intro' ? story.intro : T;
    const f = actorFraction(spec, clock);
    const inWindow = T >= spec.visible[0] && T <= spec.visible[1] + 0.02;
    // Trails fade for the privacy section and step back with the field where the page's own content leads.
    const fadeOut = (1 - span(T, beats.privacy.fade[0], beats.privacy.fade[1])) * (1 - dimAt(T) * 0.9);
    const opacity = (f >= 1 ? spec.restOpacity : f > 0 ? 1 : 0) * fadeOut * (inWindow ? 1 : 0);
    const reveal = Math.max(0.0001, f * spec.track.length);

    for (const line of [pathRef.current, casingRef.current]) {
      if (!line) continue;
      const m = line.material as LineMaterial;
      m.dashSize = reveal;
      m.opacity = line === casingRef.current ? opacity * 0.85 : opacity;
      line.visible = opacity > 0.01;
      if (isRoute && line === pathRef.current) m.color.copy(routeGreen).lerp(routeViolet, smoothstep(beats.titles.title, beats.titles.title + 0.06, T));
    }

    const introOn = spec.clock === 'intro' ? (story.intro > 0 ? 1 : 0) : 1;
    const dotOn =
      introOn *
      smoothstep(spec.dotVisible[0], spec.dotVisible[0] + 0.04, T) *
      (1 - smoothstep(spec.dotVisible[1] - 0.06, spec.dotVisible[1], T)) *
      (f > 0 || spec.clock === 'intro' ? 1 : 0);
    const p = sampleAlong(spec.track.pts, Math.min(f, 0.9999), spec.track.cum);
    const pulse = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 5);
    if (dotRef.current) {
      dotRef.current.position.set(p.x, spec.y + 0.12, p.y);
      dotRef.current.scale.setScalar(Math.max(0.0001, dotOn));
      dotRef.current.visible = dotOn > 0.01;
    }
    if (haloRef.current) {
      haloRef.current.position.set(p.x, spec.y + 0.14, p.y);
      haloRef.current.scale.setScalar(2.6 * dotOn * pulse);
      haloRef.current.visible = dotOn > 0.01;
    }

    // The closing gap: a ring at the start pulses as the runner comes back, then bursts when the loop closes.
    const ring = ringRef.current;
    if (ring && spec.close) {
      const closing = f > spec.openFraction - 0.06 && f < 1 ? 1 : 0;
      const closeEnd = spec.close[1];
      const burst = spec.clock === 'intro' ? span(story.intro, closeEnd, closeEnd + 0.12) : span(T, closeEnd, closeEnd + 0.05);
      const bursting = burst > 0 && burst < 1;
      const m = ring.material as THREE.MeshBasicMaterial;
      if (bursting) {
        ring.scale.setScalar(1 + burst * 4);
        m.opacity = (1 - burst) * 0.9 * fadeOut;
      } else {
        ring.scale.setScalar(pulse);
        m.opacity = closing * 0.85 * fadeOut;
      }
      ring.visible = m.opacity > 0.01 && inWindow;
    }
  });

  return (
    <group>
      <Line
        ref={casingRef}
        points={points}
        color={palette.bg}
        lineWidth={spec.width + 4}
        dashed
        dashSize={0.0001}
        gapSize={1e5}
        transparent
        depthWrite={false}
        renderOrder={1}
      />
      <Line
        ref={pathRef}
        points={points}
        color={isRoute ? territory.route : colors ? '#ffffff' : spec.solid}
        vertexColors={colors}
        lineWidth={spec.width}
        dashed
        dashSize={0.0001}
        gapSize={1e5}
        transparent
        depthWrite={false}
        renderOrder={2}
      />
      <mesh ref={dotRef} renderOrder={3}>
        <sphereGeometry args={[0.38, 20, 14]} />
        <meshBasicMaterial color={dotColor} toneMapped={false} />
      </mesh>
      <sprite ref={haloRef} renderOrder={3}>
        <spriteMaterial map={halo()} color={spec.dot} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {spec.close ? (
        <mesh ref={ringRef} position={[start[0], spec.y + 0.05, start[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <ringGeometry args={[0.62, 0.86, 48]} />
          <meshBasicMaterial color={territory.closing} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

/** The approved route as a quiet line, with start, checkpoint and finish gates standing across it. */
function RouteGates() {
  const spec = actorById('route');
  const baseRef = useRef<Line2>(null);
  const gatesRef = useRef<THREE.Group>(null);
  const points = useMemo(() => spec.track.pts.map(([x, z]) => new THREE.Vector3(x, 0.08, z)), [spec]);
  const gates = useMemo(() => {
    const list: { at: number; color: string }[] = [
      { at: routeGates.start, color: territory.start },
      ...routeGates.checkpoints.map((at) => ({ at, color: territory.checkpoint })),
      { at: routeGates.finish, color: territory.finish }
    ];
    return list.map((g) => {
      const p = sampleAlong(spec.track.pts, Math.min(0.999, Math.max(0.001, g.at)), spec.track.cum);
      return { ...g, x: p.x, z: p.y, angle: Math.atan2(p.dx, p.dy) };
    });
  }, [spec]);

  useFrame(() => {
    const T = story.value;
    const show = smoothstep(4.0, 4.12, T) * (1 - smoothstep(5.05, 5.25, T));
    const line = baseRef.current;
    if (line) {
      const m = line.material as LineMaterial;
      m.opacity = 0.35 * show;
      m.color.copy(routeGreen).lerp(routeViolet, smoothstep(beats.titles.title, beats.titles.title + 0.06, T));
      line.visible = show > 0.01;
    }
    if (gatesRef.current) {
      gatesRef.current.visible = show > 0.01;
      gatesRef.current.children.forEach((child) => {
        child.scale.setScalar(Math.max(0.0001, show));
      });
    }
  });

  return (
    <group>
      <Line ref={baseRef} points={points} color={territory.route} lineWidth={2} transparent opacity={0} depthWrite={false} />
      <group ref={gatesRef}>
        {gates.map((g, i) => (
          <mesh key={i} position={[g.x, 1.25, g.z]} rotation={[0, g.angle, 0]}>
            <torusGeometry args={[1.25, 0.07, 10, 40, Math.PI]} />
            <meshBasicMaterial color={new THREE.Color(g.color).multiplyScalar(1.6)} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Actors() {
  return (
    <group>
      {actors.map((spec) => (
        <ActorView key={spec.id} spec={spec} />
      ))}
      <RouteGates />
    </group>
  );
}

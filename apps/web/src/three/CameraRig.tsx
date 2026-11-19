'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { sampleAlong } from '@/lib/hex';
import { smoothstep, story } from '@/story/state';
import { actorById, actorFraction } from './actors';

type V3 = readonly [number, number, number];
interface Key {
  t: number;
  pos: V3;
  target: V3;
  fov: number;
  /** Horizontal film offset: negative puts the subject right of centre, beside the copy. */
  film: number;
  /** Phones only: share of the screen height to raise the subject (negative lowers it), clear of the copy. */
  lift?: number;
}

/** One station per beat on the story clock; the camera flies a smooth spline through them. */
const KEYS: Key[] = [
  { t: 0, pos: [4.7, 9, 20.3], target: [0.5, 0, 0.5], fov: 42, film: -10.5, lift: 0.17 },
  { t: 0.5, pos: [4.7, 9, 20.3], target: [0.5, 0, 0.5], fov: 42, film: -10.5, lift: 0.17 },
  { t: 0.95, pos: [6, 11, 19], target: [0, 0, 0], fov: 42, film: -8, lift: 0.1 },
  { t: 1.14, pos: [-11, 10, 22], target: [-19, 0, 9], fov: 44, film: -5 },
  { t: 1.7, pos: [-19.5, 36, 14.5], target: [-19, 0, 7.2], fov: 40, film: -8.5 },
  { t: 1.92, pos: [-19.5, 36, 14.5], target: [-19, 0, 7.2], fov: 40, film: -8.5 },
  { t: 2.3, pos: [0, 33, 35], target: [0, 0, 2], fov: 44, film: 0 },
  { t: 2.75, pos: [4, 31, 33], target: [0, 0, 0], fov: 44, film: 0 },
  { t: 3.1, pos: [6.5, 17.5, 21.5], target: [-5.5, 0, 2], fov: 42, film: -9.5, lift: 0.05 },
  { t: 3.85, pos: [3.5, 19.5, 19.5], target: [-5.5, 0, 2], fov: 42, film: -9.5, lift: 0.05 },
  { t: 4.12, pos: [-27, 8, -6], target: [-33, 0, -19], fov: 44, film: -9, lift: -0.2 },
  { t: 4.86, pos: [37, 11, -5], target: [26, 0, -18], fov: 44, film: -9, lift: -0.2 },
  { t: 5.1, pos: [33, 21, 35], target: [24, 0, 12], fov: 42, film: -9, lift: 0.06 },
  { t: 5.85, pos: [30, 24, 33], target: [24, 0, 12], fov: 42, film: -9, lift: 0.06 },
  { t: 6.3, pos: [0, 36, 42], target: [0, 0, 6], fov: 44, film: 0 },
  { t: 7.15, pos: [0, 48, 15], target: [0, 0, 3], fov: 40, film: 0 },
  { t: 7.9, pos: [2, 50, 13], target: [0, 0, 2], fov: 40, film: 0 },
  { t: 8.3, pos: [-12, 30, 38], target: [0, 0, 0], fov: 44, film: 0 },
  { t: 8.9, pos: [12, 30, 38], target: [0, 0, 0], fov: 44, film: 0 },
  { t: 9.05, pos: [0, 38, 50], target: [0, 0, 0], fov: 44, film: 0 },
  { t: 9.45, pos: [0, 74, 70], target: [0, 0, -4], fov: 46, film: 0 },
  { t: 11.5, pos: [0, 82, 76], target: [0, 0, -6], fov: 46, film: 0 }
];

const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  film: number;
  lift: number;
}

/** Camera pose on the spline at story time T. */
export function keyPose(T: number, out: Pose): Pose {
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1]!.t <= T) k++;
  const k0 = KEYS[Math.max(0, k - 1)]!;
  const k1 = KEYS[k]!;
  const k2 = KEYS[Math.min(KEYS.length - 1, k + 1)]!;
  const k3 = KEYS[Math.min(KEYS.length - 1, k + 2)]!;
  const u = Math.max(0, Math.min(1, (T - k1.t) / (k2.t - k1.t || 1)));
  const e = u * u * (3 - 2 * u);
  out.pos.set(cr(k0.pos[0], k1.pos[0], k2.pos[0], k3.pos[0], e), cr(k0.pos[1], k1.pos[1], k2.pos[1], k3.pos[1], e), cr(k0.pos[2], k1.pos[2], k2.pos[2], k3.pos[2], e));
  out.target.set(
    cr(k0.target[0], k1.target[0], k2.target[0], k3.target[0], e),
    cr(k0.target[1], k1.target[1], k2.target[1], k3.target[1], e),
    cr(k0.target[2], k1.target[2], k2.target[2], k3.target[2], e)
  );
  out.fov = k1.fov + (k2.fov - k1.fov) * e;
  out.film = k1.film + (k2.film - k1.film) * e;
  out.lift = (k1.lift ?? 0) + ((k2.lift ?? 0) - (k1.lift ?? 0)) * e;
  return out;
}

const loopA = actorById('loopA');
const routeActor = actorById('route');

/** A shot that rides behind a runner: `back` behind, `up` above, `side` to the left of travel. */
function chase(spec: typeof loopA, T: number, back: number, up: number, side: number, ahead: number, pos: THREE.Vector3, target: THREE.Vector3) {
  const f = Math.min(0.999, actorFraction(spec, T));
  const p = sampleAlong(spec.track.pts, f, spec.track.cum);
  const lx = -p.dy;
  const lz = p.dx;
  pos.set(p.x - p.dx * back + lx * side, up, p.y - p.dy * back + lz * side);
  target.set(p.x + p.dx * ahead, 0.4, p.y + p.dy * ahead);
}

export function CameraRig({ compact }: { compact: boolean }) {
  const { camera, size } = useThree();
  const pose = useMemo<Pose>(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42, film: 0, lift: 0 }), []);
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), parallax: new THREE.Vector2() }), []);

  useFrame((_, dt) => {
    const T = story.value;
    keyPose(T, pose);

    const wA = smoothstep(1.12, 1.24, T) * (1 - smoothstep(1.52, 1.66, T));
    if (wA > 0) {
      chase(loopA, T, 7, 5.5, 1.6, 4, tmp.pos, tmp.target);
      pose.pos.lerp(tmp.pos, wA);
      pose.target.lerp(tmp.target, wA);
    }
    const wR = smoothstep(4.12, 4.24, T) * (1 - smoothstep(4.68, 4.84, T));
    if (wR > 0) {
      chase(routeActor, T, 9, 4.6, 5, 6, tmp.pos, tmp.target);
      pose.pos.lerp(tmp.pos, wR);
      pose.target.lerp(tmp.target, wR);
    }

    const portrait = size.width / Math.max(1, size.height) < 0.9;
    let fov = pose.fov;
    let film = pose.film;
    if (portrait || compact) {
      const pull = portrait ? 1.22 : 1.08;
      pose.pos.sub(pose.target).multiplyScalar(pull).add(pose.target);
      fov += portrait ? 10 : 2;
      film = portrait ? 0 : film * 0.6;
    }

    // A little parallax from the pointer on desktop, eased.
    const k = 1 - Math.exp(-dt * 3);
    tmp.parallax.x += (story.pointer.x - tmp.parallax.x) * k;
    tmp.parallax.y += (story.pointer.y - tmp.parallax.y) * k;
    if (story.motion && !portrait) {
      pose.pos.x += tmp.parallax.x * 0.9;
      pose.pos.y += tmp.parallax.y * 0.5;
    }

    const cam = camera as THREE.PerspectiveCamera;
    cam.position.copy(pose.pos);
    cam.lookAt(pose.target);
    // On phones the copy sits above or below the scene, so the picture slides up or down instead of sideways.
    const lift = portrait ? Math.round(pose.lift * size.height) : 0;
    const liftNow = cam.view?.enabled ? cam.view.offsetY : 0;
    if (Math.abs(cam.fov - fov) > 0.001 || Math.abs(cam.filmOffset - film) > 0.001 || lift !== liftNow) {
      cam.fov = fov;
      cam.filmOffset = film;
      if (lift !== 0) cam.setViewOffset(size.width, size.height, 0, lift, size.width, size.height);
      else if (cam.view?.enabled) cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
  });

  return null;
}

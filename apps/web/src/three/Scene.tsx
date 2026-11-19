'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { smoothstep, story, type Tier } from '@/story/state';
import { beats, buildField, FIELD_RADIUS, INTRO_SECONDS } from '@/story/world';
import { palette } from '@/theme/brand';
import { Actors } from './Actors';
import { dimAt } from './dim';
import { CameraRig } from './CameraRig';
import { createFieldGeometry, createFieldMaterial, createFieldUniforms } from './fieldMaterial';

const Effects = lazy(() => import('./Effects'));

const ZENITH = new THREE.Color('#0D0E12');
const DUSK = new THREE.Color('#1C1731');
const FIRST_LIGHT = new THREE.Color('#1B2638');

function SkyDome({ horizon }: { horizon: THREE.Color }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uZenith: { value: ZENITH }, uHorizon: { value: horizon } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          varying vec3 vDir;
          void main() {
            float t = clamp(vDir.y, 0.0, 1.0);
            gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.5)), 1.0);
            #include <colorspace_fragment>
          }`
      }),
    [horizon]
  );
  useFrame(({ camera }) => {
    // keep the dome centred on the camera so it never clips
    meshRef.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={meshRef} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[240, 32, 16]} />
    </mesh>
  );
}

function World({ compact, onReady }: { compact: boolean; onReady: () => void }) {
  const data = useMemo(() => buildField(compact ? FIELD_RADIUS.small : FIELD_RADIUS.large), [compact]);
  const uniforms = useMemo(() => createFieldUniforms(), []);
  const geometry = useMemo(() => createFieldGeometry(data), [data]);
  const material = useMemo(() => createFieldMaterial(uniforms), [uniforms]);
  const horizon = useMemo(() => DUSK.clone(), []);
  const groundColor = useMemo(() => new THREE.Color(palette.surfaceSunken), []);
  const { scene, camera } = useThree();
  const readyRef = useRef(false);
  const introDelay = useRef(0.45);
  // The intro's clock keeps running after the loop closes, so the hero's cells finish their spring and settle.
  const introClock = useRef(0);

  useEffect(() => {
    scene.fog = new THREE.Fog(horizon, 30, 95);
    return () => {
      scene.fog = null;
      geometry.dispose();
      material.dispose();
    };
  }, [scene, horizon, geometry, material]);

  useFrame((_, dt) => {
    const T = story.value;
    if (!story.motion || T > 0.92) introClock.current = Math.max(introClock.current, 4);
    else if (introDelay.current > 0) introDelay.current -= dt;
    else introClock.current = Math.min(4, introClock.current + dt / INTRO_SECONDS);
    story.intro = Math.min(1, introClock.current);

    uniforms.uT.value = T;
    uniforms.uIntro.value = introClock.current;
    uniforms.uDim.value = dimAt(T);
    const pulseX = (T - beats.final.pulse) * 9;
    uniforms.uPulse.value = Math.exp(-pulseX * pulseX);

    horizon.copy(DUSK).lerp(FIRST_LIGHT, smoothstep(0.6, 9.6, T));
    uniforms.uFog.value.copy(horizon);
    const h = camera.position.y;
    const near = 22 + h * 0.65;
    const far = 80 + h * 1.6;
    uniforms.uFogNear.value = near;
    uniforms.uFogFar.value = far;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(horizon);
      scene.fog.near = near;
      scene.fog.far = far;
    }

    if (!readyRef.current) {
      readyRef.current = true;
      onReady();
    }
  });

  return (
    <>
      <SkyDome horizon={horizon} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial color={groundColor} />
      </mesh>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <Actors />
      <CameraRig compact={compact} />
    </>
  );
}

export default function Scene({ tier, compact, onReady }: { tier: Exclude<Tier, 'none'>; compact: boolean; onReady: () => void }) {
  // A cap on the screen's pixel ratio, never above it: a plain monitor renders at 1.
  const [dpr, setDpr] = useState(tier === 'high' ? 1.75 : tier === 'mid' ? 1.4 : 1);
  const [effects, setEffects] = useState(tier === 'high');

  return (
    <Canvas
      flat
      dpr={[1, dpr]}
      gl={{ antialias: !effects && tier !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: 42, near: 0.5, far: 400, position: [4, 7.5, 17] }}
      onCreated={({ gl }) => gl.setClearColor(palette.bg)}
    >
      <PerformanceMonitor
        onDecline={() => {
          if (effects) setEffects(false);
          else setDpr((d) => Math.max(1, Math.round((d - 0.25) * 100) / 100));
        }}
      />
      <World compact={compact || tier === 'low'} onReady={onReady} />
      {effects ? (
        <Suspense fallback={null}>
          <Effects />
        </Suspense>
      ) : null}
    </Canvas>
  );
}

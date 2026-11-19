'use client';

import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/** High tier only: violet land, edges and the runner's dot glow; a soft vignette frames the field. */
export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={1.05} luminanceThreshold={0.62} luminanceSmoothing={0.25} radius={0.72} />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  );
}

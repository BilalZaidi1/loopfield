import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    // React Three Fiber mutates three.js objects (uniforms, camera, fog) in its frame loop by design, outside
    // React's render; the compiler's immutability rule can't tell those from React state.
    files: ['src/three/**/*.{ts,tsx}'],
    rules: { 'react-hooks/immutability': 'off' }
  },
  { ignores: ['.next/**', 'next-env.d.ts', 'node_modules/**'] }
];

export default config;

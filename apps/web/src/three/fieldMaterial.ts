import * as THREE from 'three';
import { springParams } from '@/lib/springs';
import { CELL_INSET, INTRO_SECONDS, SECONDS_PER_T, type FieldData } from '@/story/world';
import { palette, springs, territory } from '@/theme/brand';

/**
 * The field is one instanced draw: a hexagonal prism per cell, with every claim, loss and reclaim worked out on
 * the GPU from the story clock. Heights rise on the app's pop spring, colours keep the app's meanings, lost ground
 * gets the app's dashed outline in your colour, and grey zones keep their dashed grey edge.
 */
export function createFieldGeometry(data: FieldData): THREE.InstancedBufferGeometry {
  const prism = new THREE.CylinderGeometry(CELL_INSET, CELL_INSET, 1, 6, 1, false).toNonIndexed();
  prism.translate(0, 0.5, 0);
  prism.computeVertexNormals();

  // Drop the bottom cap: it is never seen.
  const pos = prism.getAttribute('position');
  const nor = prism.getAttribute('normal');
  const keepPos: number[] = [];
  const keepNor: number[] = [];
  for (let tri = 0; tri < pos.count; tri += 3) {
    if (nor.getY(tri) < -0.5) continue;
    for (let v = tri; v < tri + 3; v++) {
      keepPos.push(pos.getX(v), pos.getY(v), pos.getZ(v));
      keepNor.push(nor.getX(v), nor.getY(v), nor.getZ(v));
    }
  }
  prism.dispose();

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(keepPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(keepNor, 3));
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(data.offset, 3));
  geo.setAttribute('aA', new THREE.InstancedBufferAttribute(data.a, 4));
  geo.setAttribute('aB', new THREE.InstancedBufferAttribute(data.b, 4));
  geo.setAttribute('aC', new THREE.InstancedBufferAttribute(data.c, 2));
  geo.instanceCount = data.count;
  return geo;
}

const vertexShader = /* glsl */ `
uniform float uT;
uniform float uIntro;
uniform float uDim;
uniform float uPulse;
uniform vec3 uSpring;
uniform vec3 uBase;
uniform vec3 uMine;
uniform vec3 uMineLine;
uniform vec3 uRivals[6];
uniform vec3 uGrey;
uniform vec3 uGreyLine;
uniform vec3 uPark;
uniform vec3 uBuilding;
uniform vec3 uClub;
uniform vec3 uClubLine;
uniform vec3 uFog;

attribute vec3 aOffset;
attribute vec4 aA;
attribute vec4 aB;
attribute vec2 aC;

varying vec3 vNormal;
varying vec2 vLocal;
varying float vTop;
varying vec3 vFill;
varying vec3 vEdge;
varying float vEdgeAmt;
varying float vDash;
varying float vDepth;

const float SPT = ${SECONDS_PER_T.toFixed(1)};
const float INTRO_S = ${INTRO_SECONDS.toFixed(2)};

// The app's pop spring (damping 12, stiffness 220, mass 0.7) as a closed-form step response.
float pop(float t) {
  if (t <= 0.0) return 0.0;
  float w0 = uSpring.x;
  float z = uSpring.y;
  float wd = uSpring.z;
  float e = exp(-z * w0 * t);
  return 1.0 - e * (cos(wd * t) + (z * w0 / wd) * sin(wd * t));
}

vec3 hue(float i) {
  if (i < 0.5) return uRivals[0];
  if (i < 1.5) return uRivals[1];
  if (i < 2.5) return uRivals[2];
  if (i < 3.5) return uRivals[3];
  if (i < 4.5) return uRivals[4];
  return uRivals[5];
}

void main() {
  float base = aOffset.z;
  float kind = aC.x;
  bool grey = kind > 0.5 && kind < 1.5;

  float eHero = aA.x >= 0.0 ? (uIntro - aA.x) * INTRO_S : -1.0;
  float eMine = (uT - aA.y) * SPT;
  float eRival = aA.z < -0.5 ? 9.0 : (uT - aA.z) * SPT;
  float eReclaim = (uT - aA.w) * SPT;
  float eClub = (uT - aB.x) * SPT;
  float ePatch = (uT - aB.y) * SPT;

  bool wasMine = eHero > 0.0 || eMine > 0.0;
  float mineSince = eHero > 0.0 ? eHero : eMine;

  vec3 neutral = kind > 2.5 ? uBuilding : (kind > 1.5 ? uPark : (grey ? mix(uBase, uGrey, 0.4) : uBase));
  vec3 fill = neutral;
  vec3 edge = grey ? uGreyLine : neutral;
  float edgeAmt = grey ? 0.7 : 0.0;
  float dash = grey ? 1.0 : 0.0;
  float lift = 0.0;
  float since = 9.0;
  float glow = 0.0;

  if (eReclaim > 0.0) {
    fill = uMine; edge = uMineLine * 1.7; edgeAmt = 1.0; dash = 0.0; lift = 0.3; since = eReclaim; glow = 1.0;
  } else if (eRival > 0.0 && wasMine && aA.z > -0.5) {
    fill = mix(uBase, hue(aB.z), 0.55); edge = uMineLine * 1.5; edgeAmt = 1.0; dash = 1.0; lift = 0.18; since = eRival;
  } else if (eRival > 0.0) {
    vec3 h = hue(aB.z);
    fill = mix(uBase, h, 0.5); edge = h; edgeAmt = 0.4; dash = 0.0; lift = 0.16; since = eRival;
  } else if (wasMine) {
    fill = uMine; edge = uMineLine * 1.7; edgeAmt = 1.0; dash = 0.0; lift = 0.3; since = mineSince; glow = 1.0;
  } else if (eClub > 0.0) {
    fill = mix(uBase, uClub, 0.78); edge = uClubLine * 1.35; edgeAmt = 0.85; dash = 0.0; lift = 0.22; since = eClub;
  } else if (ePatch > 0.0) {
    vec3 h = hue(aB.w);
    fill = mix(uBase, h, 0.5); edge = h; edgeAmt = 0.4; dash = 0.0; lift = 0.14; since = ePatch;
  }

  float p = lift > 0.0 ? pop(since) : 0.0;
  float flash = lift > 0.0 ? exp(-max(since, 0.0) * 3.2) : 0.0;
  float reveal = lift > 0.0 ? smoothstep(0.0, 0.22, since) : 1.0;
  fill = mix(neutral, fill, reveal);
  fill += glow * uPulse * uMineLine * 0.55;
  edge *= 1.0 + flash * 1.4 + glow * uPulse * 1.2;
  edgeAmt *= reveal;

  float h = max(base + lift * p, 0.02);
  vec3 pos = position;
  pos.y *= h;
  vTop = normal.y > 0.5 ? 1.0 : 0.0;
  vLocal = position.xz;
  vec4 mv = viewMatrix * modelMatrix * vec4(pos + vec3(aOffset.x, 0.0, aOffset.y), 1.0);
  vDepth = -mv.z;
  vNormal = normalize(mat3(modelMatrix) * normal);
  // Step back (dim) last, so nothing a beat adds shines through where the page's own content leads.
  vFill = mix(fill + flash * 0.18 * glow * uMineLine, uFog, uDim * 0.9);
  vEdge = mix(edge, uFog, uDim * 0.8);
  vEdgeAmt = edgeAmt;
  vDash = dash;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uLight;

varying vec3 vNormal;
varying vec2 vLocal;
varying float vTop;
varying vec3 vFill;
varying vec3 vEdge;
varying float vEdgeAmt;
varying float vDash;
varying float vDepth;

// Inigo Quilez's hexagon distance (flat edges at ±y); our cells point along z, so x and y are swapped.
float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

void main() {
  vec3 col;
  if (vTop > 0.5) {
    col = vFill;
    float inside = -sdHex(vLocal.yx, ${(CELL_INSET * 0.8660254).toFixed(4)});
    float band = 1.0 - smoothstep(0.035, 0.12, inside);
    float on = 1.0;
    if (vDash > 0.5) {
      float a = atan(vLocal.y, vLocal.x);
      on = step(0.42, fract(a / 6.2831853 * 12.0));
    }
    col = mix(col, vEdge, band * vEdgeAmt * on);
  } else {
    vec3 n = normalize(vNormal);
    float diff = 0.45 + 0.4 * max(dot(n, uLight), 0.0);
    col = vFill * diff;
  }
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  col = mix(col, uFog, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export type FieldUniforms = ReturnType<typeof createFieldUniforms>;

export function createFieldUniforms() {
  const { omega0, zeta } = springParams(springs.pop);
  const c = (hex: string) => new THREE.Color(hex);
  return {
    uT: { value: 0.5 },
    uIntro: { value: 0 },
    uDim: { value: 0 },
    uPulse: { value: 0 },
    uSpring: { value: new THREE.Vector3(omega0, zeta, omega0 * Math.sqrt(1 - zeta * zeta)) },
    uBase: { value: c('#1A1B21') },
    uMine: { value: c(territory.mineFill) },
    uMineLine: { value: c(territory.mineLine) },
    uRivals: { value: territory.rivalHues.slice(0, 6).map(c) },
    uGrey: { value: c(territory.unavailableFill) },
    uGreyLine: { value: c(territory.unavailableLine) },
    uPark: { value: c(palette.greenSoft) },
    uBuilding: { value: c(territory.building) },
    uClub: { value: c(palette.blue) },
    uClubLine: { value: c(palette.blueText) },
    uFog: { value: c(palette.bg) },
    uFogNear: { value: 30 },
    uFogFar: { value: 95 },
    uLight: { value: new THREE.Vector3(0.45, 1, 0.35).normalize() }
  };
}

export function createFieldMaterial(uniforms: FieldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
}

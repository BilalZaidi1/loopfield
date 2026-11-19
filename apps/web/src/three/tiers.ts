import type { Tier } from '@/story/state';

/**
 * How much 3D a device gets. No library call and no network: WebGL 2 support, the renderer string, memory,
 * cores, screen and Save-Data decide the starting tier, and PerformanceMonitor steps down at run time.
 * `?tier=high|mid|low|none` overrides it for testing.
 */
export function detectTier(): Tier {
  if (typeof window === 'undefined') return 'none';
  const forced = new URLSearchParams(window.location.search).get('tier');
  if (forced === 'high' || forced === 'mid' || forced === 'low' || forced === 'none') return forced;

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  } catch {
    gl = null;
  }
  if (!gl) return 'none';

  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer)) return 'low';
  if (nav.connection?.saveData) return 'low';
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 8;
  if (memory <= 2 || cores <= 2) return 'low';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (coarse || small || memory <= 4) return 'mid';
  return 'high';
}

/** Phones and small windows draw a smaller field. */
export function isCompact(): boolean {
  return typeof window !== 'undefined' && (Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 760);
}

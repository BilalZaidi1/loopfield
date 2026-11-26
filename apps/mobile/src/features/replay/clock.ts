import type { CameraConfig } from '@/features/map/MapCanvas';
import { replayAt, type ReplayPlan } from '@loopfield/core';

/** Below this the phone is too busy for the flight, and the replay switches to the flat map. */
export const MIN_FPS = 30;
const FPS_WINDOW_MS = 2000;
const UI_EVERY_MS = 100;

export interface ClockEvents {
  /** The camera's next step: on each new keyframe while playing (`jump` false), or at once after a drag. */
  onCamera: (config: CameraConfig) => void;
  /** At most ten times a second, for the slider and the flat map's dot. */
  onPosition: (atMs: number) => void;
  onEnd: () => void;
  /** Fewer than `MIN_FPS` frames a second over the first two seconds of playing. */
  onSlow: () => void;
}

/**
 * The replay's clock, kept out of the screen: it advances on animation frames, steps the camera from keyframe to
 * keyframe (Mapbox animates each step natively), reports the position for the controls and measures the frame
 * rate once. Time and frame scheduling are injectable so tests can drive it.
 */
export class ReplayClock {
  private raf: number | null = null;
  private at = 0;
  private last = 0;
  private speed = 1;
  private frame = -1;
  private lastUi = -Infinity;
  private fpsFrom = 0;
  private frames = 0;
  private measured = false;

  constructor(
    private plan: ReplayPlan,
    private events: ClockEvents,
    private now: () => number = () => performance.now(),
    private schedule: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id)
  ) {}

  get playing(): boolean {
    return this.raf !== null;
  }

  get position(): number {
    return this.at;
  }

  play(speed = this.speed): void {
    if (this.raf !== null) return;
    if (this.at >= this.plan.durationMs) this.seek(0);
    this.speed = speed;
    this.last = this.now();
    if (!this.measured) {
      this.fpsFrom = this.last;
      this.frames = 0;
    }
    this.frame = -1;
    this.raf = this.schedule(this.tick);
  }

  pause(): void {
    if (this.raf !== null) this.cancel(this.raf);
    this.raf = null;
    this.events.onPosition(this.at);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.frame = -1; // the next step is re-timed for the new speed
  }

  /** Straight to a moment (dragging the slider): the camera jumps there without flying. */
  seek(atMs: number): void {
    this.at = Math.min(this.plan.durationMs, Math.max(0, atMs));
    const f = replayAt(this.plan, this.at);
    this.events.onCamera({ centerCoordinate: [f.center.lng, f.center.lat], heading: f.headingDeg, pitch: this.plan.pitch, zoomLevel: this.plan.zoom, animationDuration: 0, animationMode: 'moveTo' });
    this.frame = -1;
    this.events.onPosition(this.at);
  }

  stop(): void {
    if (this.raf !== null) this.cancel(this.raf);
    this.raf = null;
  }

  private tick = (): void => {
    const t = this.now();
    this.at = Math.min(this.plan.durationMs, this.at + (t - this.last) * this.speed);
    this.last = t;
    if (!this.measured) {
      this.frames++;
      const span = t - this.fpsFrom;
      if (span >= FPS_WINDOW_MS) {
        this.measured = true;
        if ((this.frames / span) * 1000 < MIN_FPS) this.events.onSlow();
      }
    }
    const frames = this.plan.frames;
    const k = Math.min(frames.length - 1, Math.floor(this.at / this.plan.stepMs));
    if (k !== this.frame) {
      this.frame = k;
      const next = frames[Math.min(frames.length - 1, k + 1)]!;
      this.events.onCamera({
        centerCoordinate: [next.center.lng, next.center.lat],
        heading: next.headingDeg,
        pitch: this.plan.pitch,
        zoomLevel: this.plan.zoom,
        animationDuration: Math.max(0, (next.atMs - this.at) / this.speed),
        animationMode: 'linearTo'
      });
    }
    if (t - this.lastUi >= UI_EVERY_MS || this.at >= this.plan.durationMs) {
      this.lastUi = t;
      this.events.onPosition(this.at);
    }
    if (this.at >= this.plan.durationMs) {
      this.raf = null;
      this.events.onEnd();
      return;
    }
    if (this.raf !== null) this.raf = this.schedule(this.tick);
  };
}

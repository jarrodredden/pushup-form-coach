import { FRONT_CAMERA, type Camera } from './idealPushup';
import { modelLandmarks } from './poseFixtures';
import type { PosePoint } from './types';

/**
 * Pose streams that look like a real phone run rather than the clean model: MediaPipe-style landmark
 * jitter and drift, arm joints that jump for a frame, wrists that dim or vanish at the bottom of a
 * head-on rep, the occasional frame with nobody found, and uneven frame timing with drops and stalls.
 */

export interface NoisyRep {
  /** Model depth at the bottom (0 top … 1 chest at the floor). */
  bottom: number;
  /** Model depth at the "top": a soft lockout is above 0. */
  top?: number;
  durationMs: number;
  /** Rest at the top after the rep. */
  pauseMs?: number;
  /** m of hip sag (negative: pike). */
  hipDrop?: number;
  tuck?: number;
}

export type LeadIn = { kind: 'plank'; ms: number } | { kind: 'kneel'; ms: number; depth?: number } | { kind: 'get-down'; ms: number };

export interface NoisyOptions {
  seed: number;
  /** Stream width / height; a portrait iPhone stream by default. */
  aspect?: number;
  camera?: Camera;
  leadIn?: LeadIn[];
  reps: NoisyRep[];
  /** 0 = clean, 1 = typical phone, 2 = poor light. */
  noise?: number;
}

export interface NoisyFrame {
  landmarks: PosePoint[];
  now: number;
  depth: number;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  return { next, gauss, range: (lo: number, hi: number) => lo + (hi - lo) * next() };
}

/** Kneeling or standing upright: the model pose with the hips a torso length under the shoulders. */
export function uprightLandmarks(depth: number, aspect: number, camera: Camera = FRONT_CAMERA): PosePoint[] {
  const points = modelLandmarks({ depth, aspect, camera });
  const shoulderWidth = Math.abs(points[11].x - points[12].x) * aspect;
  const shoulderY = (points[11].y + points[12].y) / 2;
  for (const index of [23, 24]) points[index] = { ...points[index], y: shoulderY + 1.4 * shoulderWidth, visibility: 0.95 };
  return points;
}

const ARM_JOINTS = [13, 14, 15, 16];
/** On-screen body size (frame heights): shoulder width head-on, torso length from the side. */
const bodySize = (p: PosePoint[], aspect: number) =>
  Math.max(Math.hypot((p[11].x - p[12].x) * aspect, p[11].y - p[12].y), Math.hypot((p[11].x - p[23].x) * aspect, p[11].y - p[23].y));
/** The head-on model's size: what the noise levels are tuned for. */
const REFERENCE_SIZE = bodySize(modelLandmarks({ depth: 0, aspect: 9 / 16 }), 9 / 16);
const WRISTS_ELBOWS = [13, 14, 15, 16];

export function noisyPushups(options: NoisyOptions): NoisyFrame[] {
  const { seed, aspect = 9 / 16, camera = FRONT_CAMERA, leadIn = [], reps, noise = 1 } = options;
  const r = rng(seed);
  const frames: NoisyFrame[] = [];
  let now = 0;
  const drift = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  const stepClock = () => {
    now += 33 + r.range(-8, 8);
    if (r.next() < 0.04 * noise) now += r.range(33, 100);
    if (r.next() < 0.004 * noise) now += r.range(150, 300);
  };

  const emit = (clean: PosePoint[], depth: number) => {
    // Pose jitter scales with how big the person is on screen.
    const scale = bodySize(clean, aspect) / REFERENCE_SIZE;
    const occluded = depth > 0.5 && r.next() < 0.4 * noise;
    const lost = r.next() < 0.03 * noise;
    const glitch = r.next() < 0.02 * noise ? ARM_JOINTS[Math.floor(r.next() * ARM_JOINTS.length)] : -1;
    const landmarks = clean.map((point, index) => {
      if (!point.visibility) return point;
      const d = drift[index];
      d.x = Math.max(-0.01 * scale, Math.min(0.01 * scale, d.x + r.gauss() * 0.0015 * noise * scale));
      d.y = Math.max(-0.01 * scale, Math.min(0.01 * scale, d.y + r.gauss() * 0.0015 * noise * scale));
      const sigma = (ARM_JOINTS.includes(index) ? 0.007 : 0.004) * noise * scale;
      let x = point.x + d.x / aspect + (r.gauss() * sigma) / aspect;
      let y = point.y + d.y + r.gauss() * sigma;
      if (index === glitch) {
        const angle = r.range(0, Math.PI * 2);
        const jump = r.range(0.04, 0.1) * scale;
        x += (Math.cos(angle) * jump) / aspect;
        y += Math.sin(angle) * jump;
      }
      let visibility = Math.min(0.99, Math.max(0.05, (point.visibility ?? 0) - r.range(0, 0.12) * noise));
      if (occluded && WRISTS_ELBOWS.includes(index)) visibility = r.range(0.2, 0.6);
      if (lost) visibility = r.range(0.05, 0.3);
      return { ...point, x, y, visibility };
    });
    frames.push({ landmarks, now, depth });
    stepClock();
  };

  const hold = (make: (depth: number) => PosePoint[], depth: number, ms: number) => {
    const end = now + ms;
    while (now < end) emit(make(depth), depth);
  };
  const plank = (rep: Partial<NoisyRep>) => (depth: number) => modelLandmarks({ depth, aspect, camera, hipDrop: rep.hipDrop ?? 0, tuckDegrees: rep.tuck ?? 45 });

  for (const step of leadIn) {
    if (step.kind === 'plank') hold(plank({}), 0, step.ms);
    else if (step.kind === 'kneel') hold((depth) => uprightLandmarks(depth, aspect, camera), step.depth ?? 0, step.ms);
    else {
      // Kneeling up with straight arms → arms bend as the hands go down → straighten into the plank.
      const start = now;
      while (now - start < step.ms) {
        const t = (now - start) / step.ms;
        const depth = t < 0.5 ? t * 2 * 0.8 : (1 - t) * 2 * 0.8;
        emit(t < 0.6 ? uprightLandmarks(depth, aspect, camera) : plank({})(depth), depth);
      }
    }
  }

  for (const rep of reps) {
    const top = rep.top ?? 0;
    const make = plank(rep);
    const start = now;
    while (now - start < rep.durationMs) {
      const t = (now - start) / rep.durationMs;
      const depth = top + ((rep.bottom - top) * (1 - Math.cos(t * Math.PI * 2))) / 2;
      emit(make(depth), depth);
    }
    hold(make, top, rep.pauseMs ?? 400);
  }
  return frames;
}

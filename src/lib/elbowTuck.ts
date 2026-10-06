import type { PosePoint } from './types';

/**
 * Elbow tuck is graded on the upper-arm-to-torso angle seen from above (abduction in the plank
 * plane): 0° = arm pinned along the ribs, 90° = the "T" flare. Arm, chest, and lat mass keep real
 * elbows off the ribs, so good push-ups sit around 30–50°. Anything at or below the ideal max is a
 * full 100 — elbows are never penalized for being too tucked.
 */
export interface ElbowIdealRange {
  min: number;
  max: number;
}

export const DEFAULT_ELBOW_IDEAL_RANGE: ElbowIdealRange = { min: 30, max: 50 };

/** Score by degrees past the ideal max: gentle for the first 10–20°, low by the 75–90° "T". */
const FLARE_RAMP: Array<[number, number]> = [
  [0, 100],
  [10, 85],
  [20, 60],
  [25, 45],
  [30, 30],
  [40, 10],
  [50, 0],
];

/**
 * Upper-arm length in shoulder widths as the front camera sees it at the bottom of a rep: the true
 * ratio (~0.8) shrunk by the arm angling up and by perspective. Calibrated on the 3D model so a true
 * 55–90° flare reads within ~10° (slightly low), and anything tucked reads well under 50°.
 */
export const UPPER_ARM_TO_SHOULDER_WIDTH = 0.75;
/** Below this share of the upper arm lying in the plank plane (arms near vertical) the angle is unreadable. */
const MIN_PLANE_SHARE = 0.35;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function normalizeElbowRange(range: Partial<ElbowIdealRange> | null | undefined): ElbowIdealRange {
  const rawMax = Number.isFinite(range?.max) ? Number(range?.max) : DEFAULT_ELBOW_IDEAL_RANGE.max;
  const rawMin = Number.isFinite(range?.min) ? Number(range?.min) : DEFAULT_ELBOW_IDEAL_RANGE.min;
  const max = clamp(Math.round(rawMax), 20, 85);
  const min = clamp(Math.round(rawMin), 0, max);
  return { min, max };
}

export function elbowTuckScore(abductionDegrees: number | null | undefined, range: ElbowIdealRange = DEFAULT_ELBOW_IDEAL_RANGE) {
  if (abductionDegrees === null || abductionDegrees === undefined || Number.isNaN(abductionDegrees)) return 100;
  const past = abductionDegrees - range.max;
  if (past <= 0) return 100;
  for (let index = 1; index < FLARE_RAMP.length; index += 1) {
    const [x1, y1] = FLARE_RAMP[index];
    if (past <= x1) {
      const [x0, y0] = FLARE_RAMP[index - 1];
      return Math.round(y0 + ((past - x0) / (x1 - x0)) * (y1 - y0));
    }
  }
  return 0;
}

/**
 * Head-on: the camera sees the side-to-side axis cleanly, so the elbow's outward offset past its
 * own shoulder (as a share of upper-arm length) gives sin(abduction). Elbows inside the shoulder
 * line read as 0°. Depth-axis landmark noise doesn't enter.
 */
export function headOnElbowAbduction(shoulder: PosePoint, elbow: PosePoint, otherShoulder: PosePoint, shoulderWidth: number) {
  const outward = Math.sign(shoulder.x - otherShoulder.x) || 1;
  const offset = Math.max(0, (elbow.x - shoulder.x) * outward);
  const upperArm = Math.max(shoulderWidth * UPPER_ARM_TO_SHOULDER_WIDTH, 0.001);
  return toDegrees(Math.asin(clamp(offset / upperArm, 0, 1)));
}

type Vec3 = { x: number; y: number; z: number };
const sub = (a: PosePoint, b: PosePoint): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => {
  const len = length(a);
  return len ? scale(a, 1 / len) : null;
};

/**
 * 3D (MediaPipe world landmarks): project the upper arm onto the plank plane spanned by the torso
 * axis and the shoulder line, then measure its angle from the torso axis. Used for the side view,
 * where the outward axis points at the camera and 2D can't see it.
 */
export function worldElbowAbduction(
  shoulder: PosePoint,
  elbow: PosePoint,
  otherShoulder: PosePoint,
  shoulderMid: PosePoint,
  hipMid: PosePoint,
): number | null {
  const torso = unit(sub(hipMid, shoulderMid));
  if (!torso) return null;
  const across = sub(shoulder, otherShoulder);
  const outward = unit({ x: across.x - torso.x * dot(across, torso), y: across.y - torso.y * dot(across, torso), z: across.z - torso.z * dot(across, torso) });
  if (!outward) return null;
  const arm = sub(elbow, shoulder);
  const armLength = length(arm);
  const back = dot(arm, torso);
  const lateral = dot(arm, outward);
  if (!armLength || Math.hypot(back, lateral) / armLength < MIN_PLANE_SHARE) return null;
  return toDegrees(Math.atan2(Math.max(0, lateral), Math.abs(back)));
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Rolling median for live readings, so a single jittery frame can't flip the elbow meter or cue. */
export function createRollingMedian(size = 7) {
  let window: number[] = [];
  return {
    push(value: number | null) {
      if (value === null || Number.isNaN(value)) return median(window);
      window = [...window, value].slice(-size);
      return median(window);
    },
    reset() {
      window = [];
    },
  };
}

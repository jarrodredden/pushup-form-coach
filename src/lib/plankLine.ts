import type { PosePoint } from './types';

/**
 * Plank line (hip alignment), measured the way each camera view can actually see it.
 *
 * Side view: the shoulder–hip–ankle angle (knees if the ankles are out of frame). 180° is a
 * straight body; up to 12° of bend still counts as straight.
 *
 * Front view: the body runs toward the camera, so that angle is unreadable. Instead the hips'
 * on-screen drop below the shoulders is compared with the drop a straight plank would show at the
 * current depth, predicted from the athlete's own top-of-rep plank. Modeling a phone on the floor
 * at any height or distance, a straight plank's gap shrinks by a near-constant share of how far the
 * shoulders have lowered toward the hands, so a single slope covers every setup.
 *
 * When the needed landmarks aren't visible the plank line is n/a (null) and is left out of the
 * score — it is never a 0 because of missing data.
 */
export type PlankAnchor = 'hips' | 'knees';
export type PlankMethod = 'front-hips' | 'front-knees' | 'side-ankles' | 'side-knees';

export interface PlankReferencePoint {
  /** Anchor-below-shoulder gap at the top of the rep, in shoulder widths. */
  topGap: number;
  /** Wrist-below-shoulder distance at the top, in shoulder widths. */
  topReach: number;
}

export type PlankReference = Partial<Record<PlankAnchor, PlankReferencePoint>>;

export interface PlankMeasurement {
  /** 0–100, or null when the camera can't see enough to judge. */
  score: number | null;
  /** + sag, − pike, in score points lost (0 when level or n/a). */
  bias: number;
  method: PlankMethod | null;
  /**
   * Raw reading for tuning. Front: deviation from the predicted straight-plank gap in
   * hip-equivalent shoulder widths (+ sag). Side: degrees of bend away from 180° (+ sag).
   */
  raw: number | null;
  detail: string;
}

const VISIBLE = 0.5;
const ANCHOR_INDICES: Record<PlankAnchor, [number, number]> = { hips: [23, 24], knees: [25, 26] };

const FRONT_MODEL: Record<PlankAnchor, { slope: number; sensitivity: number; deadZone: number }> = {
  // Straight-plank gap shrinks by `slope` per unit of shoulder lowering; 12 cm of sag moves the
  // hips ~0.23 and the knees ~0.085 shoulder widths, so knee readings are scaled up to match.
  hips: { slope: 0.73, sensitivity: 1, deadZone: 0.05 },
  knees: { slope: 1.14, sensitivity: 2.7, deadZone: 0.08 },
};
/** Beyond the dead zone, this much hip-equivalent deviation (≈12 cm) costs about 45 points. */
const FRONT_SCALE = 0.4;

/**
 * Used for the hips until the athlete's own top plank is captured. Phone height (floor to 0.6 m)
 * and distance alone move a straight plank's top hip gap across roughly 0.26–0.74, so the dead
 * zone is widened by UNCALIBRATED_HIP_SLACK to flag only obvious sag or pike. Knee gaps spread too
 * far (0.4–1.1) to judge without the athlete's own reference, so uncalibrated knees are n/a.
 */
export const DEFAULT_HIP_REFERENCE: PlankReferencePoint = { topGap: 0.5, topReach: 1.45 };
const UNCALIBRATED_HIP_SLACK = 0.25;

const SIDE_STRAIGHT_DEGREES = 12;
const SIDE_ZERO_AT_DEGREES = 40;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const visibility = (landmarks: PosePoint[], indices: number[]) =>
  indices.reduce((sum, index) => sum + (landmarks[index]?.visibility ?? 0), 0) / indices.length;
const mid = (landmarks: PosePoint[], [a, b]: [number, number], aspect: number) => ({
  x: ((landmarks[a].x + landmarks[b].x) / 2) * aspect,
  y: (landmarks[a].y + landmarks[b].y) / 2,
});
const na = (detail: string): PlankMeasurement => ({ score: null, bias: 0, method: null, raw: null, detail });

/** Front-view gaps in true pixel proportions (x is rescaled by the video aspect). */
export function frontPlankGeometry(landmarks: PosePoint[] | undefined, aspect: number) {
  if (!landmarks?.length || visibility(landmarks, [11, 12, 15, 16]) < VISIBLE) return null;
  const ls = landmarks[11];
  const rs = landmarks[12];
  const width = Math.max(Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y), 0.001);
  const shoulderY = (ls.y + rs.y) / 2;
  const reach = (mid(landmarks, [15, 16], 1).y - shoulderY) / width;
  const gaps: Partial<Record<PlankAnchor, number>> = {};
  for (const anchor of ['hips', 'knees'] as const) {
    if (visibility(landmarks, ANCHOR_INDICES[anchor]) >= VISIBLE) {
      gaps[anchor] = (mid(landmarks, ANCHOR_INDICES[anchor], 1).y - shoulderY) / width;
    }
  }
  return { reach, gaps };
}

/** Blends the latest locked-out (top) frame into the athlete's reference. */
export function updatePlankReference(
  reference: PlankReference,
  landmarks: PosePoint[] | undefined,
  aspect: number,
  weight = 0.25,
): PlankReference {
  const geometry = frontPlankGeometry(landmarks, aspect);
  if (!geometry || geometry.reach <= 0.3) return reference;
  const next: PlankReference = { ...reference };
  for (const anchor of ['hips', 'knees'] as const) {
    const gap = geometry.gaps[anchor];
    if (gap === undefined) continue;
    const current = reference[anchor];
    next[anchor] = current
      ? { topGap: current.topGap + (gap - current.topGap) * weight, topReach: current.topReach + (geometry.reach - current.topReach) * weight }
      : { topGap: gap, topReach: geometry.reach };
  }
  return next;
}

export function measureFrontPlank(landmarks: PosePoint[] | undefined, aspect: number, reference: PlankReference | null | undefined): PlankMeasurement {
  const geometry = frontPlankGeometry(landmarks, aspect);
  if (!geometry) return na('front: shoulders or hands not visible');
  const anchor: PlankAnchor | null = geometry.gaps.hips !== undefined ? 'hips' : geometry.gaps.knees !== undefined ? 'knees' : null;
  if (!anchor) return na('front: hips and knees not visible');
  const model = FRONT_MODEL[anchor];
  const own = reference?.[anchor];
  if (!own && anchor === 'knees') return na('front knees: waiting for a top-plank calibration');
  const ref = own ?? DEFAULT_HIP_REFERENCE;
  const deadZone = model.deadZone + (own ? 0 : UNCALIBRATED_HIP_SLACK);
  const lowered = clamp(1 - geometry.reach / Math.max(ref.topReach, 0.1), 0, 1);
  const expected = ref.topGap - model.slope * lowered;
  const gap = geometry.gaps[anchor]!;
  const deviation = (gap - expected) * model.sensitivity;
  const score = Math.round(clamp(100 - (Math.max(0, Math.abs(deviation) - deadZone) / FRONT_SCALE) * 100, 0, 100));
  return {
    score,
    bias: Math.round(Math.sign(deviation) * (100 - score)),
    method: anchor === 'hips' ? 'front-hips' : 'front-knees',
    raw: Number(deviation.toFixed(3)),
    detail: `front ${anchor}: gap ${gap.toFixed(2)} vs straight ${expected.toFixed(2)} (top ${ref.topGap.toFixed(2)}${own ? '' : ' default'}, lowered ${Math.round(lowered * 100)}%)`,
  };
}

export function measureSidePlank(landmarks: PosePoint[] | undefined, aspect: number): PlankMeasurement {
  if (!landmarks?.length) return na('side: no pose');
  if (visibility(landmarks, [11, 12]) < VISIBLE || visibility(landmarks, [23, 24]) < VISIBLE) return na('side: shoulders or hips not visible');
  const end: [number, number] | null = visibility(landmarks, [27, 28]) >= VISIBLE ? [27, 28] : visibility(landmarks, [25, 26]) >= VISIBLE ? [25, 26] : null;
  if (!end) return na('side: ankles and knees not visible');
  const shoulder = mid(landmarks, [11, 12], aspect);
  const hip = mid(landmarks, [23, 24], aspect);
  const foot = mid(landmarks, end, aspect);
  const a = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
  const b = { x: foot.x - hip.x, y: foot.y - hip.y };
  const magnitude = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!magnitude) return na('side: body landmarks overlap');
  const hipAngle = (Math.acos(clamp((a.x * b.x + a.y * b.y) / magnitude, -1, 1)) * 180) / Math.PI;
  // Which side of the shoulder→foot line the hip is on; image y grows downward, so below = sag.
  const line = { x: foot.x - shoulder.x, y: foot.y - shoulder.y };
  let normal = { x: -line.y, y: line.x };
  if (normal.y < 0) normal = { x: -normal.x, y: -normal.y };
  const below = (hip.x - shoulder.x) * normal.x + (hip.y - shoulder.y) * normal.y > 0;
  const bend = 180 - hipAngle;
  const score = Math.round(clamp(100 - (Math.max(0, bend - SIDE_STRAIGHT_DEGREES) / (SIDE_ZERO_AT_DEGREES - SIDE_STRAIGHT_DEGREES)) * 100, 0, 100));
  const signedBend = below ? bend : -bend;
  return {
    score,
    bias: Math.round(Math.sign(signedBend) * (100 - score)),
    method: end[0] === 27 ? 'side-ankles' : 'side-knees',
    raw: Number(signedBend.toFixed(1)),
    detail: `side ${end[0] === 27 ? 'ankles' : 'knees'}: shoulder–hip–${end[0] === 27 ? 'ankle' : 'knee'} ${Math.round(hipAngle)}° (${bend.toFixed(0)}° ${bend < 1 ? 'straight' : below ? 'sag' : 'pike'})`,
  };
}

export function plankMethodLabel(method: PlankMethod | null | undefined) {
  switch (method) {
    case 'front-hips':
      return 'front · hips vs own top plank';
    case 'front-knees':
      return 'front · knees vs own top plank';
    case 'side-ankles':
      return 'side · shoulder–hip–ankle angle';
    case 'side-knees':
      return 'side · shoulder–hip–knee angle';
    default:
      return 'n/a';
  }
}

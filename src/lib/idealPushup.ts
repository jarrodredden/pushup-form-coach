/**
 * A 3D model of an ideal push-up, used by the rest-screen demo figure and by scoring tests.
 * Units are meters. x = camera right (the athlete's left), y = up from the floor, z = toward
 * a camera that faces the athlete's head. The body pivots on the toes as one straight line.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PushupJoint =
  | 'head'
  | 'nose'
  | 'lShoulder'
  | 'rShoulder'
  | 'lElbow'
  | 'rElbow'
  | 'lWrist'
  | 'rWrist'
  | 'lHip'
  | 'rHip'
  | 'lKnee'
  | 'rKnee'
  | 'lAnkle'
  | 'rAnkle'
  | 'lToe'
  | 'rToe';

export type PushupSkeleton = Record<PushupJoint, Vec3>;

export const PUSHUP_BODY = {
  shoulderHalfWidth: 0.19,
  /** Hands slightly wider than the shoulders. */
  handHalfWidth: 0.26,
  hipHalfWidth: 0.12,
  kneeHalfWidth: 0.11,
  ankleHalfWidth: 0.1,
  upperArm: 0.3,
  forearm: 0.27,
  shoulderToHip: 0.5,
  hipToKnee: 0.45,
  kneeToAnkle: 0.43,
  ankleHeight: 0.1,
  /** Shoulder height at the bottom: chest a few centimeters off the floor. */
  bottomShoulderHeight: 0.13,
  headRadius: 0.1,
};

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => scale(a, 1 / (length(a) || 1));
const lerp = (a: Vec3, b: Vec3, t: number) => add(a, scale(sub(b, a), t));

const armReach = PUSHUP_BODY.upperArm + PUSHUP_BODY.forearm;
const handOffset = PUSHUP_BODY.handHalfWidth - PUSHUP_BODY.shoulderHalfWidth;
/** Top height leaves the arm a hair short of fully straight so the elbow solve stays stable. */
const topShoulderHeight = Math.sqrt((armReach - 0.005) ** 2 - handOffset ** 2);
const bodyLength = PUSHUP_BODY.shoulderToHip + PUSHUP_BODY.hipToKnee + PUSHUP_BODY.kneeToAnkle;
const horizontalSpan = (shoulderHeight: number) => Math.sqrt(bodyLength ** 2 - (shoulderHeight - PUSHUP_BODY.ankleHeight) ** 2);
/** Hands sit under the shoulders at the top; ankles are placed so that happens at z = 0. */
const ankleZ = -horizontalSpan(topShoulderHeight);

/**
 * Two-bone elbow solve. Of the elbow positions that fit both bone lengths, picks the one whose
 * top-down direction from the shoulder best matches the tuck angle, staying above the floor.
 */
function solveElbow(shoulder: Vec3, wrist: Vec3, tuckDirection: Vec3): Vec3 {
  const toWrist = sub(wrist, shoulder);
  const reach = Math.min(length(toWrist), armReach - 1e-4);
  const axis = unit(toWrist);
  const along = (PUSHUP_BODY.upperArm ** 2 - PUSHUP_BODY.forearm ** 2 + reach ** 2) / (2 * reach);
  const radius = Math.sqrt(Math.max(0, PUSHUP_BODY.upperArm ** 2 - along ** 2));
  const center = add(shoulder, scale(axis, along));
  const helper = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = unit(sub(helper, scale(axis, dot(helper, axis))));
  const v = { x: axis.y * u.z - axis.z * u.y, y: axis.z * u.x - axis.x * u.z, z: axis.x * u.y - axis.y * u.x };
  let best = center;
  let bestScore = -Infinity;
  for (let step = 0; step < 180; step += 1) {
    const angle = (step / 180) * Math.PI * 2;
    const elbow = add(center, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius)));
    const flat = { x: elbow.x - shoulder.x, y: 0, z: elbow.z - shoulder.z };
    const score = (length(flat) > 1e-6 ? dot(unit(flat), tuckDirection) : 0) + elbow.y * 2;
    if (score > bestScore) {
      bestScore = score;
      best = elbow;
    }
  }
  return best;
}

/** depth: 0 = locked out at the top, 1 = chest near the floor. */
/** hipDrop (m): + sags the hips toward the floor, − pikes them up; 0 is a straight plank. */
export function pushupSkeleton(depth: number, tuckDegrees = 45, hipDrop = 0): PushupSkeleton {
  const t = Math.min(1, Math.max(0, depth));
  const shoulderHeight = topShoulderHeight + (PUSHUP_BODY.bottomShoulderHeight - topShoulderHeight) * t;
  const shoulderZ = ankleZ + horizontalSpan(shoulderHeight);
  const ankleMid: Vec3 = { x: 0, y: PUSHUP_BODY.ankleHeight, z: ankleZ };
  const shoulderMid: Vec3 = { x: 0, y: shoulderHeight, z: shoulderZ };
  const alongBody = (fromAnkle: number) => lerp(ankleMid, shoulderMid, fromAnkle / bodyLength);
  const hipMid = add(alongBody(PUSHUP_BODY.hipToKnee + PUSHUP_BODY.kneeToAnkle), { x: 0, y: -hipDrop, z: 0 });
  const kneeMid = add(alongBody(PUSHUP_BODY.kneeToAnkle), { x: 0, y: -hipDrop * 0.45, z: 0 });
  const towardHead = unit(sub(shoulderMid, ankleMid));
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const side = (mid: Vec3, half: number, sign: 1 | -1): Vec3 => ({ ...mid, x: mid.x + sign * half });

  const tuck = (tuckDegrees * Math.PI) / 180;
  const arm = (sign: 1 | -1) => {
    const shoulder = side(shoulderMid, PUSHUP_BODY.shoulderHalfWidth, sign);
    const wrist: Vec3 = { x: sign * PUSHUP_BODY.handHalfWidth, y: 0, z: 0 };
    const tuckDirection: Vec3 = { x: sign * Math.sin(tuck), y: 0, z: -Math.cos(tuck) };
    return { shoulder, wrist, elbow: solveElbow(shoulder, wrist, add(tuckDirection, scale(up, 1.2))) };
  };
  const left = arm(1);
  const right = arm(-1);
  const head = add(add(shoulderMid, scale(towardHead, 0.24)), scale(up, 0.05));

  return {
    head,
    nose: add(add(head, scale(towardHead, 0.08)), scale(up, -0.03)),
    lShoulder: left.shoulder,
    rShoulder: right.shoulder,
    lElbow: left.elbow,
    rElbow: right.elbow,
    lWrist: left.wrist,
    rWrist: right.wrist,
    lHip: side(hipMid, PUSHUP_BODY.hipHalfWidth, 1),
    rHip: side(hipMid, PUSHUP_BODY.hipHalfWidth, -1),
    lKnee: side(kneeMid, PUSHUP_BODY.kneeHalfWidth, 1),
    rKnee: side(kneeMid, PUSHUP_BODY.kneeHalfWidth, -1),
    lAnkle: side(ankleMid, PUSHUP_BODY.ankleHalfWidth, 1),
    rAnkle: side(ankleMid, PUSHUP_BODY.ankleHalfWidth, -1),
    lToe: { x: PUSHUP_BODY.ankleHalfWidth, y: 0, z: ankleZ + 0.04 },
    rToe: { x: -PUSHUP_BODY.ankleHalfWidth, y: 0, z: ankleZ + 0.04 },
  };
}

/** Smooth 2 s loop: ~1 s down, ~1 s up, with a brief settle at the top and the bottom. */
export function pushupDepthAt(timeMs: number, periodMs = 2000) {
  const phase = (((timeMs % periodMs) + periodMs) % periodMs) / periodMs;
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

export interface Camera {
  eye: Vec3;
  target: Vec3;
  /** Focal length as a multiple of the output height. */
  focal: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance along the view axis; larger is farther. */
  depth: number;
}

/** Pinhole projection. Output x/y are in units of the image height, centered on the view axis. */
export function project(point: Vec3, camera: Camera): Projected {
  const forward = unit(sub(camera.target, camera.eye));
  const right = unit({ x: -forward.z, y: 0, z: forward.x });
  const upAxis = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const rel = sub(point, camera.eye);
  const depth = Math.max(dot(rel, forward), 0.05);
  return { x: (camera.focal * dot(rel, right)) / depth, y: (-camera.focal * dot(rel, upAxis)) / depth, depth };
}

/** Phone-on-the-floor view, a little above the hands, facing the athlete (the app's head-on setup). */
export const FRONT_CAMERA: Camera = { eye: { x: 0, y: 0.55, z: 1.55 }, target: { x: 0, y: 0.18, z: -0.55 }, focal: 1.55 };
export const SIDE_CAMERA: Camera = { eye: { x: 2.3, y: 0.45, z: -0.6 }, target: { x: 0, y: 0.25, z: -0.62 }, focal: 1.45 };

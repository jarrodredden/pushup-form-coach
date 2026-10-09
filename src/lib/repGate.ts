import { REP_BOTTOM_ANGLE, REP_TOP_ANGLE } from './scoring';
import type { CameraViewMode, PosePoint } from './types';

/**
 * Rep counting. A rep only counts after the athlete has held a real top-of-push-up plank (arms
 * straight, body roughly horizontal) once the set has started, and then goes down to depth and back
 * to lockout. Kneeling, sitting, or standing with straight arms never arms it, so getting into
 * position after "Go" can't register as a rep. Elbow angle alone used to drive this, which is how
 * "arms straight while standing → bent while getting down → straight in plank" counted as a rep.
 */

const VISIBLE = 0.5;
/** Front view: hips may sit at most this many shoulder widths below the shoulders (upright ≈ 1.3–1.5, plank ≈ 0.3–0.6). */
export const FRONT_MAX_HIP_DROP = 0.95;
/** Side view: shoulder→hip (and shoulder→ankle) line at most this far from horizontal. */
export const SIDE_MAX_TILT_DEG = 40;

export interface PlankPosture {
  /** Body roughly horizontal (a plank, at any depth). */
  horizontal: boolean;
  /** Arms straight enough for the top of a push-up. */
  armsExtended: boolean;
  /** Both: the top of a push-up. */
  atTop: boolean;
  reason: string;
}

const visible = (point: PosePoint | undefined): point is PosePoint => Boolean(point) && (point!.visibility ?? 0) >= VISIBLE;

export function plankPosture(landmarks: PosePoint[] | null | undefined, viewMode: CameraViewMode, aspect: number, elbowAngle: number): PlankPosture {
  const armsExtended = elbowAngle >= REP_TOP_ANGLE;
  const none = (reason: string): PlankPosture => ({ horizontal: false, armsExtended, atTop: false, reason });
  if (!landmarks?.length) return none('no pose');
  const [ls, rs, lw, rw, lh, rh, la, ra] = [11, 12, 15, 16, 23, 24, 27, 28].map((index) => landmarks[index]);
  if (!visible(ls) || !visible(rs)) return none('shoulders not visible');
  // Landmark x is a fraction of the width and y of the height; scale x so distances are true.
  const X = (point: PosePoint) => point.x * aspect;
  const shoulder = { x: (X(ls) + X(rs)) / 2, y: (ls.y + rs.y) / 2 };
  let horizontal: boolean;
  let reason: string;
  if (viewMode === 'head-on') {
    if (!visible(lw) || !visible(rw)) return none('hands not visible');
    const shoulderWidth = Math.max(Math.hypot(X(ls) - X(rs), ls.y - rs.y), 1e-3);
    const wristDrop = ((lw.y + rw.y) / 2 - shoulder.y) / shoulderWidth;
    if (wristDrop < 0.15) return none('hands not under the shoulders');
    // In a plank seen from the front the hips are behind the shoulders (level with them, or hidden
    // behind the torso). Upright (standing, kneeling, sitting) they sit a torso length lower.
    if (visible(lh) && visible(rh)) {
      const hipDrop = ((lh.y + rh.y) / 2 - shoulder.y) / shoulderWidth;
      horizontal = hipDrop <= FRONT_MAX_HIP_DROP;
      reason = horizontal ? 'plank' : `upright (hips ${hipDrop.toFixed(2)} shoulder widths below shoulders)`;
    } else {
      horizontal = true;
      reason = 'plank (hips hidden behind torso)';
    }
  } else {
    if (!visible(lh) && !visible(rh)) return none('hips not visible');
    const hipPoints = [lh, rh].filter(visible);
    const hip = { x: hipPoints.reduce((sum, p) => sum + X(p), 0) / hipPoints.length, y: hipPoints.reduce((sum, p) => sum + p.y, 0) / hipPoints.length };
    const tilt = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
    const tilts = [tilt(shoulder, hip)];
    const anklePoints = [la, ra].filter(visible);
    if (anklePoints.length) {
      tilts.push(tilt(shoulder, { x: anklePoints.reduce((sum, p) => sum + X(p), 0) / anklePoints.length, y: anklePoints.reduce((sum, p) => sum + p.y, 0) / anklePoints.length }));
    }
    const worst = Math.max(...tilts);
    horizontal = worst <= SIDE_MAX_TILT_DEG;
    reason = horizontal ? 'plank' : `upright (body ${Math.round(worst)}° from horizontal)`;
  }
  return { horizontal, armsExtended, atTop: horizontal && armsExtended, reason };
}

/** Held top-of-push-up before the first rep of a set can start. */
export const ARM_MS = 500;
export const ARM_FRAMES = 6;
/** Out of plank this long while waiting at the top (stood up, sat back) → must re-arm. */
export const DISARM_FRAMES = 20;
/** Faster than this from leaving the top to locking out again isn't a real push-up (pose glitch). */
export const MIN_REP_MS = 600;
/** Share of a rep's frames that must be in a plank. */
export const MIN_PLANK_SHARE = 0.6;
const STABLE_FRAMES = 3;
const MIN_GAP_MS = 550;

export interface RepMachine {
  armed: boolean;
  armFrames: number;
  armSince: number | null;
  offPlankFrames: number;
  sawTop: boolean;
  sawBottom: boolean;
  topStableFrames: number;
  bottomStableFrames: number;
  leftTopAt: number | null;
  repFrames: number;
  plankFrames: number;
  lastRepAt: number;
  /** Straightest elbow angle at the top before this rep's descent (how fully they locked out). */
  topPeak: number;
}

export function createRepMachine(): RepMachine {
  return {
    armed: false,
    armFrames: 0,
    armSince: null,
    offPlankFrames: 0,
    sawTop: false,
    sawBottom: false,
    topStableFrames: 0,
    bottomStableFrames: 0,
    leftTopAt: null,
    repFrames: 0,
    plankFrames: 0,
    lastRepAt: 0,
    topPeak: 0,
  };
}

export type RepEvent = 'none' | 'armed' | 'disarmed' | 'top' | 'rep' | 'rejected-fast' | 'rejected-posture';

export interface RepInput {
  elbowAngle: number;
  /** Body roughly horizontal this frame (plankPosture().horizontal). */
  horizontal: boolean;
  now: number;
}

/**
 * One pose frame. `accumulate` says whether this frame belongs to a rep in progress (for scoring).
 * Must be fed only after "Go" and reset (createRepMachine) at the start of every set.
 */
export function stepRep(previous: RepMachine, input: RepInput): { state: RepMachine; event: RepEvent; accumulate: boolean } {
  const state = { ...previous };
  const { elbowAngle, horizontal, now } = input;
  const atTopAngle = elbowAngle >= REP_TOP_ANGLE;

  if (!state.armed) {
    if (horizontal && atTopAngle) {
      state.armFrames += 1;
      state.armSince ??= now;
      state.topPeak = Math.max(state.topPeak, elbowAngle);
    } else {
      state.armFrames = 0;
      state.armSince = null;
      state.topPeak = 0;
    }
    if (state.armFrames >= ARM_FRAMES && state.armSince !== null && now - state.armSince >= ARM_MS) {
      return { state: { ...state, armed: true, sawTop: true, sawBottom: false, topStableFrames: STABLE_FRAMES, bottomStableFrames: 0, offPlankFrames: 0, leftTopAt: null, repFrames: 0, plankFrames: 0 }, event: 'armed', accumulate: false };
    }
    return { state, event: 'none', accumulate: false };
  }

  state.offPlankFrames = horizontal ? 0 : state.offPlankFrames + 1;
  if (!state.sawTop || state.leftTopAt === null) state.topPeak = Math.max(state.topPeak, elbowAngle);
  if (!state.sawBottom && state.offPlankFrames >= DISARM_FRAMES) {
    return { state: { ...createRepMachine(), lastRepAt: state.lastRepAt }, event: 'disarmed', accumulate: false };
  }

  if (!state.sawTop) {
    state.topStableFrames = atTopAngle ? state.topStableFrames + 1 : 0;
    if (state.topStableFrames >= STABLE_FRAMES) {
      return { state: { ...state, sawTop: true, sawBottom: false, bottomStableFrames: 0, leftTopAt: null, repFrames: 0, plankFrames: 0 }, event: 'top', accumulate: false };
    }
    return { state, event: 'none', accumulate: false };
  }

  state.repFrames += 1;
  if (horizontal) state.plankFrames += 1;
  if (!atTopAngle && state.leftTopAt === null) state.leftTopAt = now;

  if (elbowAngle <= REP_BOTTOM_ANGLE) {
    state.bottomStableFrames += 1;
    state.topStableFrames = 0;
    if (state.bottomStableFrames >= STABLE_FRAMES) state.sawBottom = true;
  } else if (atTopAngle) {
    state.topStableFrames += 1;
    state.bottomStableFrames = 0;
  } else {
    state.topStableFrames = 0;
    state.bottomStableFrames = 0;
  }

  if (state.sawBottom && state.topStableFrames >= STABLE_FRAMES && now - state.lastRepAt > MIN_GAP_MS) {
    const duration = state.leftTopAt === null ? 0 : now - state.leftTopAt;
    const plankShare = state.repFrames ? state.plankFrames / state.repFrames : 0;
    const next = { ...state, sawTop: false, sawBottom: false, topStableFrames: 0, bottomStableFrames: 0, leftTopAt: null, repFrames: 0, plankFrames: 0, topPeak: elbowAngle };
    if (duration < MIN_REP_MS) return { state: next, event: 'rejected-fast', accumulate: true };
    if (plankShare < MIN_PLANK_SHARE) return { state: next, event: 'rejected-posture', accumulate: true };
    return { state: { ...next, lastRepAt: now }, event: 'rep', accumulate: true };
  }
  return { state, event: 'none', accumulate: true };
}

/** How long the current rep has been going (leaving the top → now), for the lockout-stall cue. */
export function repInProgressMs(state: RepMachine, now: number) {
  return state.leftTopAt === null ? 0 : now - state.leftTopAt;
}

import { addRepFrame, createEmptyRepAccumulator, finalizeRep, MIN_SIGNAL, type RepControl } from './scoring';
import type { CameraViewMode, PoseAnalysis, PosePoint, RepAccumulator, SessionRep } from './types';

/**
 * Rep counting, deliberately separate from scoring: any real down-and-up cycle after "Go" counts,
 * however poor the form (form only lowers the score). Counting uses its own elbow angle, measured in
 * true 2D geometry (x scaled by the stream's aspect ratio, so a portrait phone stream doesn't
 * exaggerate sideways elbow bends) and median-smoothed over a few frames, with wide hysteresis:
 * down to REP_DOWN_ANGLE, back up to REP_UP_ANGLE (lower for arms that never read straight).
 *
 * The one protection kept: the counter arms only once the athlete is at the top of a push-up (arms
 * straight, not upright) after "Go". Kneeling or standing with straight arms, bending them to get
 * down, then straightening into the plank used to read as top → bottom → top.
 */

/** A rep has gone down by this counting angle at the latest (true 2D; about a 103° bend head-on)… */
export const REP_DOWN_ANGLE = 130;
/** …and is back up by this one at the latest. Both lines sit lower for arms that never read straight (repLines). */
export const REP_UP_ANGLE = 150;
/** Arms this straight (counting angle) are the top of a push-up for calibration and set 2's auto-start. */
export const ARMS_EXTENDED_ANGLE = 145;

const LANDMARK_VISIBLE = 0.5;
/** Counting reads an arm down to this visibility: a dim wrist at the bottom still bends. */
const ARM_VISIBLE = 0.3;
/** Front view: hips may sit at most this many shoulder widths below the shoulders (upright ≈ 1.3–1.5, plank ≈ 0.3–0.6). */
export const FRONT_MAX_HIP_DROP = 0.95;
/** Front view: hips this far below the shoulders are positive evidence of kneeling/standing upright. */
export const FRONT_UPRIGHT_HIP_DROP = 1.05;
/** Side view: shoulder→hip (and shoulder→ankle) line at most this far from horizontal. */
export const SIDE_MAX_TILT_DEG = 40;
export const SIDE_UPRIGHT_TILT_DEG = 55;

const SIDES = [
  { shoulder: 11, elbow: 13, wrist: 15 },
  { shoulder: 12, elbow: 14, wrist: 16 },
];

/** Mean elbow angle of the arms the camera can see, in true 2D geometry; null when neither arm is readable. */
export function countingElbowAngle(landmarks: PosePoint[] | null | undefined, aspect: number): number | null {
  if (!landmarks?.length) return null;
  const angles = SIDES.flatMap(({ shoulder, elbow, wrist }) => {
    const [s, e, w] = [landmarks[shoulder], landmarks[elbow], landmarks[wrist]];
    if (!s || !e || !w || Math.min(s.visibility ?? 0, e.visibility ?? 0, w.visibility ?? 0) < ARM_VISIBLE) return [];
    const a = { x: (s.x - e.x) * aspect, y: s.y - e.y };
    const b = { x: (w.x - e.x) * aspect, y: w.y - e.y };
    const mag = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    if (!mag) return [];
    return [(Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / mag))) * 180) / Math.PI];
  });
  return angles.length ? angles.reduce((sum, value) => sum + value, 0) / angles.length : null;
}

export interface PlankPosture {
  /** Body roughly horizontal (a plank, at any depth). Strict: used to start sets, not to count reps. */
  horizontal: boolean;
  /** Positive evidence of kneeling, sitting, or standing upright (not just a landmark out of view). */
  upright: boolean;
  /** Arms straight enough for the top of a push-up. */
  armsExtended: boolean;
  /** Horizontal with straight arms: the top of a push-up. */
  atTop: boolean;
  reason: string;
}

const visible = (point: PosePoint | undefined): point is PosePoint => Boolean(point) && (point!.visibility ?? 0) >= LANDMARK_VISIBLE;

/** `elbowAngle` is the counting angle (countingElbowAngle); null when the arms can't be read. */
export function plankPosture(landmarks: PosePoint[] | null | undefined, viewMode: CameraViewMode, aspect: number, elbowAngle: number | null): PlankPosture {
  const armsExtended = elbowAngle !== null && elbowAngle >= ARMS_EXTENDED_ANGLE;
  let upright = false;
  const result = (horizontal: boolean, reason: string): PlankPosture => ({ horizontal, upright, armsExtended, atTop: horizontal && armsExtended, reason });
  if (!landmarks?.length) return result(false, 'no pose');
  const [ls, rs, lw, rw, lh, rh, la, ra] = [11, 12, 15, 16, 23, 24, 27, 28].map((index) => landmarks[index]);
  if (!visible(ls) || !visible(rs)) return result(false, 'shoulders not visible');
  // Landmark x is a fraction of the width and y of the height; scale x so distances are true.
  const X = (point: PosePoint) => point.x * aspect;
  const shoulder = { x: (X(ls) + X(rs)) / 2, y: (ls.y + rs.y) / 2 };
  if (viewMode === 'head-on') {
    const shoulderWidth = Math.max(Math.hypot(X(ls) - X(rs), ls.y - rs.y), 1e-3);
    // In a plank seen from the front the hips are behind the shoulders (level with them, or hidden
    // behind the torso). Upright (standing, kneeling, sitting) they sit a torso length lower.
    const hipDrop = visible(lh) && visible(rh) ? ((lh.y + rh.y) / 2 - shoulder.y) / shoulderWidth : null;
    upright = hipDrop !== null && hipDrop >= FRONT_UPRIGHT_HIP_DROP;
    if (hipDrop !== null && hipDrop > FRONT_MAX_HIP_DROP) return result(false, `upright (hips ${hipDrop.toFixed(2)} shoulder widths below shoulders)`);
    if (!visible(lw) || !visible(rw)) return result(false, 'hands not visible');
    const wristDrop = ((lw.y + rw.y) / 2 - shoulder.y) / shoulderWidth;
    if (wristDrop < 0.15) return result(false, 'hands not under the shoulders');
    return result(true, hipDrop === null ? 'plank (hips hidden behind torso)' : 'plank');
  }
  if (!visible(lh) && !visible(rh)) return result(false, 'hips not visible');
  const hipPoints = [lh, rh].filter(visible);
  const hip = { x: hipPoints.reduce((sum, p) => sum + X(p), 0) / hipPoints.length, y: hipPoints.reduce((sum, p) => sum + p.y, 0) / hipPoints.length };
  const tilt = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
  const tilts = [tilt(shoulder, hip)];
  const anklePoints = [la, ra].filter(visible);
  if (anklePoints.length) {
    tilts.push(tilt(shoulder, { x: anklePoints.reduce((sum, p) => sum + X(p), 0) / anklePoints.length, y: anklePoints.reduce((sum, p) => sum + p.y, 0) / anklePoints.length }));
  }
  const worst = Math.max(...tilts);
  upright = worst >= SIDE_UPRIGHT_TILT_DEG;
  return result(worst <= SIDE_MAX_TILT_DEG, worst <= SIDE_MAX_TILT_DEG ? 'plank' : `upright (body ${Math.round(worst)}° from horizontal)`);
}

/** Counting angle is the median of this many recent frames: one glitched frame can't flip up/down. */
const SMOOTH_FRAMES = 3;
/** Frames past a line before it counts as reached. */
const STABLE_FRAMES = 2;
/** Arms at least this straight (and not upright) for ARM_MS after "Go" before reps count… */
export const ARM_ANGLE = 135;
export const ARM_MS = 300;
/** …tolerating this many off frames in a row (landmark jitter), and seen as a plank on at least ARM_PLANK_FRAMES of them. */
const ARM_MISS_FRAMES = 4;
const ARM_PLANK_FRAMES = 2;
/** Clearly upright (stood or knelt up) this long → re-arm before counting again. */
export const UPRIGHT_DISARM_MS = 700;
/** A full down-and-up faster than this is a pose glitch, not a push-up. */
export const MIN_REP_MS = 300;
/**
 * Lines are relative to the top this rep started from, so flared or never-quite-straight arms (which
 * read well under 150° head-on) still count: down is at least MIN_BEND_DEG below that top (and at most
 * REP_DOWN_ANGLE); up is most of the way back (UP_SHARE of the bend, within UP_MARGIN_DEG of the top,
 * at most REP_UP_ANGLE), and always MIN_RISE_DEG above the deepest point.
 */
const MIN_BEND_DEG = 30;
const UP_SHARE = 0.7;
const UP_MARGIN_DEG = 12;
const MIN_RISE_DEG = 25;
/** The rep's timing starts when the arms bend this far below the top they were holding. */
const DESCENT_START_DEG = 8;
/** A dip that bent at least this far and came back up without reaching the bottom is reported. */
const SHALLOW_REPORT_DEG = 15;

export type RepPhase = 'top' | 'bottom';

export interface RepMachine {
  armed: boolean;
  armSince: number | null;
  armMisses: number;
  armPlankFrames: number;
  recent: number[];
  phase: RepPhase;
  upFrames: number;
  downFrames: number;
  /** Straightest counting angle at the top this rep started from. */
  topAngle: number;
  /** When the arms first bent away from that top; null while holding it. */
  descentAt: number | null;
  /** Deepest counting angle since the descent began. */
  minAngle: number;
  uprightSince: number | null;
  lastRepAt: number;
  /** Straightest scoring-angle reading at the top before this rep's descent (how fully they locked out). */
  topPeak: number;
}

export function createRepMachine(): RepMachine {
  return {
    armed: false,
    armSince: null,
    armMisses: 0,
    armPlankFrames: 0,
    recent: [],
    phase: 'top',
    upFrames: 0,
    downFrames: 0,
    topAngle: 0,
    descentAt: null,
    minAngle: 180,
    uprightSince: null,
    lastRepAt: 0,
    topPeak: 0,
  };
}

export type RepEvent = 'none' | 'armed' | 'disarmed' | 'bottom' | 'rep' | 'rejected-fast' | 'shallow';

export interface RepInput {
  /** countingElbowAngle(); null when the arms can't be read this frame (the machine just waits). */
  elbowAngle: number | null;
  /** plankPosture().horizontal */
  horizontal: boolean;
  /** plankPosture().upright */
  upright: boolean;
  now: number;
  /** Angle to record as the lockout for scoring (defaults to elbowAngle). */
  lockoutAngle?: number;
}

export interface RepStep {
  state: RepMachine;
  event: RepEvent;
  /** Smoothed counting angle this frame (null when unreadable). */
  angle: number | null;
  /** For rep, rejected-fast, and shallow: how long it took and the deepest counting angle. */
  durationMs?: number;
  deepest?: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Where this rep counts as down / back up (see MIN_BEND_DEG). */
export function repLines(state: Pick<RepMachine, 'topAngle' | 'minAngle'>) {
  const down = Math.min(REP_DOWN_ANGLE, state.topAngle - MIN_BEND_DEG);
  const up = Math.max(state.minAngle + MIN_RISE_DEG, Math.min(REP_UP_ANGLE, state.topAngle - UP_MARGIN_DEG, state.minAngle + UP_SHARE * (state.topAngle - state.minAngle)));
  return { down, up };
}

/** One pose frame. Feed only after "Go", from a fresh machine (createRepMachine) every set. */
export function stepRep(previous: RepMachine, input: RepInput): RepStep {
  const { elbowAngle, horizontal, upright, now } = input;
  const state: RepMachine = { ...previous, uprightSince: upright ? previous.uprightSince ?? now : null };
  if (elbowAngle !== null) state.recent = [...previous.recent, elbowAngle].slice(-SMOOTH_FRAMES);
  const angle = elbowAngle === null ? null : median(state.recent);
  const lockout = input.lockoutAngle ?? elbowAngle ?? 0;

  if (!state.armed) {
    if (angle === null) return { state, event: 'none', angle };
    if (angle >= ARM_ANGLE && !upright) {
      state.armSince ??= now;
      state.armMisses = 0;
      if (horizontal) state.armPlankFrames += 1;
      state.topPeak = Math.max(state.topPeak, lockout);
      state.topAngle = Math.max(state.topAngle, angle);
    } else {
      state.armMisses += 1;
      if (upright || state.armMisses > ARM_MISS_FRAMES) Object.assign(state, { armSince: null, armMisses: 0, armPlankFrames: 0, topPeak: 0, topAngle: 0 });
    }
    if (state.armSince !== null && now - state.armSince >= ARM_MS && state.armPlankFrames >= ARM_PLANK_FRAMES) {
      return {
        state: { ...state, armed: true, phase: 'top', upFrames: 0, downFrames: 0, topAngle: Math.max(state.topAngle, angle), descentAt: null, minAngle: angle },
        event: 'armed',
        angle,
      };
    }
    return { state, event: 'none', angle };
  }

  if (state.uprightSince !== null && now - state.uprightSince >= UPRIGHT_DISARM_MS) {
    return { state: { ...createRepMachine(), lastRepAt: state.lastRepAt }, event: 'disarmed', angle };
  }
  if (angle === null) return { state, event: 'none', angle };

  if (state.phase === 'top') {
    if (state.descentAt === null) {
      state.topAngle = Math.max(state.topAngle, angle);
      state.topPeak = Math.max(state.topPeak, lockout);
      state.minAngle = angle;
      if (angle < state.topAngle - DESCENT_START_DEG) state.descentAt = now;
    }
    state.minAngle = Math.min(state.minAngle, angle);
    state.downFrames = angle <= repLines(state).down ? state.downFrames + 1 : 0;
    if (state.downFrames >= STABLE_FRAMES) {
      return { state: { ...state, phase: 'bottom', upFrames: 0, descentAt: state.descentAt ?? now }, event: 'bottom', angle };
    }
    state.upFrames = state.descentAt !== null && angle >= state.topAngle - DESCENT_START_DEG ? state.upFrames + 1 : 0;
    if (state.upFrames >= STABLE_FRAMES && state.descentAt !== null) {
      const dip = { durationMs: now - state.descentAt, deepest: Math.round(state.minAngle) };
      const back = { ...state, descentAt: null, upFrames: 0, minAngle: angle };
      if (state.topAngle - state.minAngle >= SHALLOW_REPORT_DEG) return { state: back, event: 'shallow', angle, ...dip };
      return { state: back, event: 'none', angle };
    }
    return { state, event: 'none', angle };
  }

  state.minAngle = Math.min(state.minAngle, angle);
  state.upFrames = angle >= repLines(state).up ? state.upFrames + 1 : 0;
  if (state.upFrames >= STABLE_FRAMES) {
    const durationMs = state.descentAt === null ? 0 : now - state.descentAt;
    const deepest = Math.round(state.minAngle);
    const next: RepMachine = { ...state, phase: 'top', upFrames: 0, downFrames: 0, topAngle: angle, descentAt: null, minAngle: angle, topPeak: lockout };
    if (durationMs < MIN_REP_MS) return { state: next, event: 'rejected-fast', angle, durationMs, deepest };
    return { state: { ...next, lastRepAt: now }, event: 'rep', angle, durationMs, deepest };
  }
  return { state, event: 'none', angle };
}

/** How long the current rep has been going (arms starting to bend → now). */
export function repInProgressMs(state: RepMachine, now: number) {
  return state.descentAt === null ? 0 : now - state.descentAt;
}

/** The counter plus the frames of the rep in progress, so every counted rep gets scored. */
export interface RepTracker {
  machine: RepMachine;
  accumulator: RepAccumulator;
}

export function createRepTracker(): RepTracker {
  return { machine: createRepMachine(), accumulator: createEmptyRepAccumulator() };
}

export interface TrackInput {
  landmarks: PosePoint[] | null | undefined;
  /** analyzePose() for this frame (may be a low-signal frame; it's kept but can't outrank readable ones). */
  analysis: PoseAnalysis;
  posture: PlankPosture;
  aspect: number;
  now: number;
}

export interface TrackStep extends RepStep {
  tracker: RepTracker;
  /** The scored rep when event is 'rep' (index 0; the caller numbers it). */
  rep: SessionRep | null;
  control: RepControl | null;
}

/** Steps the counter and collects the rep's frames. A counted rep is always returned scored, never dropped. */
export function trackRep(tracker: RepTracker, input: TrackInput): TrackStep {
  const { landmarks, analysis, posture, aspect, now } = input;
  const elbowAngle = countingElbowAngle(landmarks, aspect);
  // Lockout is scored on the scorer's own angle; a low-signal frame has none (0 never raises the peak).
  const lockoutAngle = analysis.confidence >= MIN_SIGNAL ? analysis.elbowAngle : 0;
  const step = stepRep(tracker.machine, { elbowAngle, horizontal: posture.horizontal, upright: posture.upright, now, lockoutAngle });
  let accumulator = tracker.accumulator;
  if (step.event === 'armed' || step.event === 'disarmed' || !step.state.armed) accumulator = createEmptyRepAccumulator();
  // Every frame of the rep is kept (the scorer picks the deepest); the bottom threshold is the scorer's, not the counter's.
  else accumulator = addRepFrame(accumulator, analysis, 180);
  if (step.event === 'rep' || step.event === 'rejected-fast') {
    const control: RepControl = { durationMs: step.durationMs ?? 0, lockoutAngle: tracker.machine.topPeak };
    const rep = step.event === 'rep' ? finalizeRep(accumulator, analysis, 0, control) : null;
    return { ...step, tracker: { machine: step.state, accumulator: createEmptyRepAccumulator() }, rep, control };
  }
  return { ...step, tracker: { machine: step.state, accumulator }, rep: null, control: null };
}

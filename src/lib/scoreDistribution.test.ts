import { describe, expect, it } from 'vitest';
import { SIDE_CAMERA, type Camera } from './idealPushup';
import { updatePlankReference, type PlankReference } from './plankLine';
import { modelLandmarks } from './poseFixtures';
import { createRepMachine, plankPosture, repInProgressMs, stepRep } from './repGate';
import { addRepFrame, analyzePose, createEmptyRepAccumulator, finalizeRep, REP_BOTTOM_ANGLE, REP_TOP_ANGLE } from './scoring';
import { summarizeReps } from './sessionFlow';
import type { CameraViewMode, PosePoint, SessionRep } from './types';

/**
 * Synthetic volunteers doing a 5-rep set through the real pipeline: pose analysis → rep gate →
 * rep scoring → set summary. Depth and lockout are given as the elbow angle the app measures in
 * that camera view; each rep varies around the profile, more for weaker form.
 */
interface RepForm {
  bottomAngle: number;
  topAngle: number;
  /** Upper arm to torso, degrees (30–50 is ideal). */
  tuck: number;
  /** m of hip sag. */
  hipDrop: number;
  /** Hands off their spot under the shoulders (front: sideways, in shoulder widths; side: toward the feet, in half torso lengths). */
  handShift: number;
  /** Head off line (front: sideways, in shoulder widths; side: dropped, in torso lengths). */
  headShift: number;
  durationMs: number;
}

export const PROFILES: Record<string, { base: RepForm; spread: Partial<RepForm> }> = {
  perfect: { base: { bottomAngle: 82, topAngle: 178, tuck: 40, hipDrop: 0, handShift: 0, headShift: 0, durationMs: 2000 }, spread: {} },
  good: {
    base: { bottomAngle: 95, topAngle: 170, tuck: 50, hipDrop: 0.03, handShift: 0.05, headShift: 0.04, durationMs: 1600 },
    spread: { bottomAngle: 4, hipDrop: 0.01, durationMs: 150 },
  },
  average: {
    base: { bottomAngle: 106, topAngle: 166, tuck: 58, hipDrop: 0.06, handShift: 0.09, headShift: 0.08, durationMs: 1200 },
    spread: { bottomAngle: 6, hipDrop: 0.02, handShift: 0.03, durationMs: 200 },
  },
  sloppy: {
    base: { bottomAngle: 112, topAngle: 161, tuck: 70, hipDrop: 0.11, handShift: 0.16, headShift: 0.15, durationMs: 850 },
    spread: { bottomAngle: 2, hipDrop: 0.03, handShift: 0.04, durationMs: 150 },
  },
};
/** Per-rep offsets, in units of the profile's spread. */
const JITTER = [0, 1, -1, 0.5, -0.6];
const FRAME_MS = 33;

const VIEWS: Record<CameraViewMode, { camera?: Camera; aspect: number }> = {
  'head-on': { aspect: 0.75 },
  side: { camera: SIDE_CAMERA, aspect: 16 / 9 },
};

function landmarksFor(form: RepForm, depth: number, view: CameraViewMode): PosePoint[] {
  const { camera, aspect } = VIEWS[view];
  const points = modelLandmarks({ depth, tuckDegrees: form.tuck, hipDrop: form.hipDrop, aspect, ...(camera ? { camera } : {}) });
  const move = (indices: number[], dx: number, dy: number) => indices.forEach((i) => (points[i] = { ...points[i], x: points[i].x + dx, y: points[i].y + dy }));
  const face = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (view === 'head-on') {
    const width = Math.abs(points[11].x - points[12].x);
    move([15, 16], form.handShift * width, 0);
    move(face, form.headShift * width, 0);
  } else {
    const torso = Math.hypot((points[11].x - points[23].x) * aspect, points[11].y - points[23].y);
    const towardFeet = Math.sign(points[23].x - points[11].x);
    move([15, 16], (towardFeet * form.handShift * torso) / 2 / aspect, 0);
    move(face, 0, form.headShift * torso);
  }
  return points;
}

/** Model depth (0 top … 1 chest at the floor) at which this view measures `angle` at the elbow. */
function depthForAngle(form: RepForm, angle: number, view: CameraViewMode) {
  const measured = (depth: number) => analyzePose(landmarksFor(form, depth, view), view, { aspect: VIEWS[view].aspect }).elbowAngle;
  let lo = 0;
  let hi = 1;
  if (measured(0) <= angle) return 0;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (measured(mid) > angle) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function runSet(profile: string, view: CameraViewMode): SessionRep[] {
  const { base, spread } = PROFILES[profile];
  const { aspect } = VIEWS[view];
  let machine = createRepMachine();
  let accumulator = createEmptyRepAccumulator();
  let reference: PlankReference = {};
  const reps: SessionRep[] = [];
  let now = 0;
  const frame = (form: RepForm, depth: number) => {
    const landmarks = landmarksFor(form, depth, view);
    const analysis = analyzePose(landmarks, view, { aspect, plankReference: reference });
    if (view === 'head-on' && analysis.elbowAngle >= REP_TOP_ANGLE) reference = updatePlankReference(reference, landmarks, aspect);
    const posture = plankPosture(landmarks, view, aspect, analysis.elbowAngle);
    const previous = machine;
    const step = stepRep(machine, { elbowAngle: analysis.elbowAngle, horizontal: posture.horizontal, now });
    machine = step.state;
    if (step.accumulate) accumulator = addRepFrame(accumulator, analysis, REP_BOTTOM_ANGLE);
    if (step.event === 'armed' || step.event === 'top') accumulator = createEmptyRepAccumulator();
    if (step.event === 'rep') {
      const rep = finalizeRep(accumulator, analysis, reps.length + 1, { durationMs: repInProgressMs(previous, now), lockoutAngle: previous.topPeak });
      if (rep) reps.push(rep);
      accumulator = createEmptyRepAccumulator();
    }
    now += FRAME_MS;
  };
  const hold = (form: RepForm, depth: number, ms: number) => {
    for (let t = 0; t < ms; t += FRAME_MS) frame(form, depth);
  };

  hold(base, depthForAngle(base, base.topAngle, view), 900);
  JITTER.forEach((j) => {
    const form = { ...base };
    for (const key of Object.keys(spread) as (keyof RepForm)[]) form[key] = base[key] + (spread[key] ?? 0) * j;
    const top = depthForAngle(form, form.topAngle, view);
    const bottom = depthForAngle(form, form.bottomAngle, view);
    // Down and up over the rep's duration, then a short pause at the top.
    const n = Math.max(2, Math.round(form.durationMs / FRAME_MS));
    for (let i = 0; i < n; i += 1) frame(form, top + ((bottom - top) * (1 - Math.cos((i / (n - 1)) * Math.PI * 2))) / 2);
    hold(form, top, 350);
  });
  return reps;
}

export function distribution(view: CameraViewMode) {
  return Object.keys(PROFILES).map((profile) => {
    const reps = runSet(profile, view);
    return { profile, reps: reps.map((rep) => rep.score), set: summarizeReps(reps).average, count: reps.length };
  });
}

describe('score distribution on synthetic volunteers', () => {
  for (const view of ['head-on', 'side'] as const) {
    it(`${view}: perfect 100, good about 80–90, average about 60–75, sloppy well below`, () => {
      const rows = distribution(view);
      console.log(`\n${view}\n${rows.map((row) => `${row.profile.padEnd(8)} set ${String(row.set).padStart(3)}  reps ${row.reps.join(', ')}`).join('\n')}`);
      if (process.env.SCORE_BANDS === 'off') return;
      const set = Object.fromEntries(rows.map((row) => [row.profile, row.set]));
      // The sloppy set's fastest rep (0.7 s) is too quick to count.
      rows.forEach((row) => expect(row.count).toBeGreaterThanOrEqual(row.profile === 'sloppy' ? 4 : 5));
      expect(set.perfect).toBe(100);
      expect(set.good).toBeGreaterThanOrEqual(78);
      expect(set.good).toBeLessThanOrEqual(90);
      expect(set.average).toBeGreaterThanOrEqual(55);
      expect(set.average).toBeLessThanOrEqual(75);
      expect(set.sloppy).toBeLessThan(45);
    });
  }
});

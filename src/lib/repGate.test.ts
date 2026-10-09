import { describe, expect, it } from 'vitest';
import { SIDE_CAMERA } from './idealPushup';
import { modelLandmarks } from './poseFixtures';
import { ARM_MS, createRepMachine, MIN_REP_MS, plankPosture, stepRep, type RepEvent, type RepMachine } from './repGate';
import { analyzePose } from './scoring';
import type { CameraViewMode, PosePoint } from './types';

const FRAME_MS = 33;
const ASPECT = 0.75;

/** The model push-up, but with the hips dropped a torso length under the shoulders: kneeling / sitting upright. */
function upright(depth: number): PosePoint[] {
  const points = modelLandmarks({ depth, aspect: ASPECT });
  const shoulderWidth = Math.abs(points[11].x - points[12].x) * ASPECT;
  const shoulderY = (points[11].y + points[12].y) / 2;
  for (const index of [23, 24]) points[index] = { ...points[index], y: shoulderY + 1.4 * shoulderWidth, visibility: 0.95 };
  return points;
}

interface Run {
  state: RepMachine;
  now: number;
  events: RepEvent[];
}

function feed(run: Run, frames: PosePoint[][], view: CameraViewMode = 'head-on', aspect = ASPECT) {
  for (const landmarks of frames) {
    const analysis = analyzePose(landmarks, view, { aspect });
    const posture = plankPosture(landmarks, view, aspect, analysis.elbowAngle);
    const step = stepRep(run.state, { elbowAngle: analysis.elbowAngle, horizontal: posture.horizontal, now: run.now });
    run.state = step.state;
    if (step.event !== 'none') run.events.push(step.event);
    run.now += FRAME_MS;
  }
  return run;
}

const hold = (make: (depth: number) => PosePoint[], depth: number, ms: number) => Array.from({ length: Math.ceil(ms / FRAME_MS) }, () => make(depth));
const plank = (depth: number) => modelLandmarks({ depth, aspect: ASPECT });
/** One push-up: down over `ms / 2`, up over `ms / 2`. */
const pushup = (ms = 1600, make = plank) => {
  const n = Math.ceil(ms / FRAME_MS);
  return Array.from({ length: n }, (_, i) => make(1 - Math.abs(1 - (2 * i) / (n - 1))));
};
const reps = (run: Run) => run.events.filter((event) => event === 'rep').length;

describe('plank posture', () => {
  it('reads the model plank as horizontal at the top and bottom, from the front and the side', () => {
    for (const depth of [0, 1]) {
      const front = plankPosture(plank(depth), 'head-on', ASPECT, depth ? 90 : 175);
      expect(front.horizontal).toBe(true);
      const side = plankPosture(modelLandmarks({ depth, camera: SIDE_CAMERA, aspect: 16 / 9 }), 'side', 16 / 9, depth ? 90 : 175);
      expect(side.horizontal).toBe(true);
    }
    expect(plankPosture(plank(0), 'head-on', ASPECT, 175).atTop).toBe(true);
    expect(plankPosture(plank(1), 'head-on', ASPECT, 90).atTop).toBe(false);
  });

  it('reads kneeling/sitting/standing upright as not a plank', () => {
    const posture = plankPosture(upright(0), 'head-on', ASPECT, 175);
    expect(posture.horizontal).toBe(false);
    expect(posture.reason).toMatch(/upright/);
  });

  it('hips hidden behind the torso (typical front view) still counts as a plank', () => {
    const points = plank(0).map((p, i) => (i === 23 || i === 24 ? { ...p, visibility: 0.1 } : p));
    expect(plankPosture(points, 'head-on', ASPECT, 175).horizontal).toBe(true);
  });
});

describe('rep counting gate', () => {
  it('reproduces the set 2 false rep: rest posture → getting into plank counted with elbow angle alone, not any more', () => {
    // After "Go" Connor is still kneeling up with straight arms, bends them to put his hands down,
    // then straightens into the plank. Elbow angle alone saw top → bottom → top = one rep.
    const settle = [...hold(upright, 0, 400), ...hold(upright, 1, 400), ...hold(plank, 0, 800)];
    const run = feed({ state: createRepMachine(), now: 0, events: [] }, settle);
    expect(reps(run)).toBe(0);
    expect(run.events).toEqual(['armed']);
    // Then real push-ups count.
    feed(run, [...pushup(), ...hold(plank, 0, 300), ...pushup(), ...hold(plank, 0, 300)]);
    expect(reps(run)).toBe(2);
  });

  it('a state left mid-rep at the end of set 1 would complete a rep on the return to plank, which is why every set starts from a fresh machine', () => {
    // End of set 1: armed and already past the bottom (the volunteer drops to their knees).
    const stale = feed({ state: createRepMachine(), now: 0, events: [] }, [...hold(plank, 0, 700), ...hold(plank, 1, 700)]);
    expect(stale.state.armed && stale.state.sawBottom).toBe(true);
    const carried = feed({ ...stale, events: [] }, hold(plank, 0, 300));
    expect(reps(carried)).toBe(1);
    // Fresh machine for set 2: the same return to plank only arms it.
    const fresh = feed({ state: createRepMachine(), now: carried.now, events: [] }, hold(plank, 0, 700));
    expect(fresh.events).toEqual(['armed']);
  });

  it('needs the plank top held for half a second before the first rep can start', () => {
    const run = feed({ state: createRepMachine(), now: 0, events: [] }, hold(plank, 0, ARM_MS - 150));
    expect(run.state.armed).toBe(false);
    feed(run, pushup());
    expect(reps(run)).toBe(0);
    feed(run, [...hold(plank, 0, ARM_MS + 100), ...pushup(), ...hold(plank, 0, 200)]);
    expect(reps(run)).toBe(1);
  });

  it('rejects a rep that is too fast to be real', () => {
    const run = feed({ state: createRepMachine(), now: 0, events: [] }, hold(plank, 0, 700));
    feed(run, [...pushup(MIN_REP_MS - 250), ...hold(plank, 0, 200)]);
    expect(run.events).toContain('rejected-fast');
    expect(reps(run)).toBe(0);
  });

  it('rejects a "rep" done upright (arms bending while kneeling) and disarms when they leave the plank', () => {
    const run = feed({ state: createRepMachine(), now: 0, events: [] }, hold(plank, 0, 700));
    feed(run, hold(upright, 0, 900));
    expect(run.events).toContain('disarmed');
    feed(run, [...pushup(1600, upright), ...hold(upright, 0, 200)]);
    expect(reps(run)).toBe(0);
  });

  it('counts a normal set of five', () => {
    let frames: PosePoint[][] = hold(plank, 0, 700);
    for (let i = 0; i < 5; i += 1) frames = [...frames, ...pushup(1500), ...hold(plank, 0, 250)];
    expect(reps(feed({ state: createRepMachine(), now: 0, events: [] }, frames))).toBe(5);
  });

  it('counts from the side view too', () => {
    const side = (depth: number) => modelLandmarks({ depth, camera: SIDE_CAMERA, aspect: 16 / 9 });
    const frames = [...hold(side, 0, 700), ...pushup(1500, side), ...hold(side, 0, 250)];
    expect(reps(feed({ state: createRepMachine(), now: 0, events: [] }, frames, 'side', 16 / 9))).toBe(1);
  });
});

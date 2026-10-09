import { describe, expect, it } from 'vitest';
import { SIDE_CAMERA } from './idealPushup';
import { noisyPushups, rng, uprightLandmarks, type LeadIn, type NoisyFrame, type NoisyRep } from './noisyPoseFixtures';
import { modelLandmarks } from './poseFixtures';
import {
  ARM_MS,
  countingElbowAngle,
  createRepTracker,
  MIN_REP_MS,
  plankPosture,
  REP_DOWN_ANGLE,
  REP_UP_ANGLE,
  trackRep,
  UPRIGHT_DISARM_MS,
  type RepEvent,
  type RepTracker,
} from './repGate';
import { analyzePose, LOCKOUT_NOTE, RUSHED_NOTE } from './scoring';
import type { CameraViewMode, PosePoint, SessionRep } from './types';

const FRAME_MS = 33;
const ASPECT = 0.75;

interface Run {
  tracker: RepTracker;
  now: number;
  events: RepEvent[];
  reps: SessionRep[];
  /** Counted reps that came back without a score (must never happen). */
  dropped: number;
}

const newRun = (): Run => ({ tracker: createRepTracker(), now: 0, events: [], reps: [], dropped: 0 });

/** The app's per-frame path after "Go": pose analysis → posture → counter + scorer. */
function step(run: Run, landmarks: PosePoint[], view: CameraViewMode, aspect: number, now = run.now) {
  const analysis = analyzePose(landmarks, view, { aspect });
  const posture = plankPosture(landmarks, view, aspect, countingElbowAngle(landmarks, aspect));
  const result = trackRep(run.tracker, { landmarks, analysis, posture, aspect, now });
  run.tracker = result.tracker;
  if (result.event !== 'none') run.events.push(result.event);
  if (result.event === 'rep') {
    if (result.rep) run.reps.push(result.rep);
    else run.dropped += 1;
  }
}

function feed(run: Run, frames: PosePoint[][], view: CameraViewMode = 'head-on', aspect = ASPECT) {
  for (const landmarks of frames) {
    step(run, landmarks, view, aspect);
    run.now += FRAME_MS;
  }
  return run;
}

function feedNoisy(run: Run, frames: NoisyFrame[], view: CameraViewMode, aspect: number) {
  const offset = run.now;
  for (const frame of frames) step(run, frame.landmarks, view, aspect, offset + frame.now);
  run.now = offset + (frames.at(-1)?.now ?? 0) + FRAME_MS;
  return run;
}

const hold = (make: (depth: number) => PosePoint[], depth: number, ms: number) => Array.from({ length: Math.ceil(ms / FRAME_MS) }, () => make(depth));
const plank = (depth: number) => modelLandmarks({ depth, aspect: ASPECT });
const upright = (depth: number) => uprightLandmarks(depth, ASPECT);
/** One push-up from `top` to `bottom` and back over `ms`. */
const pushup = (ms = 1600, make = plank, bottom = 1, top = 0) => {
  const n = Math.max(2, Math.ceil(ms / FRAME_MS));
  return Array.from({ length: n }, (_, i) => make(top + (bottom - top) * (1 - Math.abs(1 - (2 * i) / (n - 1)))));
};
const count = (run: Run) => run.events.filter((event) => event === 'rep').length;

describe('counting angle', () => {
  it('measures the same arm the same way on a portrait and a landscape stream', () => {
    for (const depth of [0, 0.3, 0.5]) {
      const portrait = countingElbowAngle(modelLandmarks({ depth, aspect: 9 / 16 }), 9 / 16)!;
      const landscape = countingElbowAngle(modelLandmarks({ depth, aspect: 16 / 9 }), 16 / 9)!;
      expect(Math.abs(portrait - landscape)).toBeLessThan(1);
    }
  });

  it('reads one arm when the other is hidden, and nothing when both are', () => {
    const oneArm = modelLandmarks({ depth: 0.5, hidden: [14, 16] });
    expect(countingElbowAngle(oneArm, ASPECT)).toBeCloseTo(countingElbowAngle(modelLandmarks({ depth: 0.5 }), ASPECT)!, 0);
    expect(countingElbowAngle(modelLandmarks({ depth: 0.5, hidden: [13, 14] }), ASPECT)).toBeNull();
  });
});

describe('plank posture', () => {
  it('reads the model plank as horizontal at the top and bottom, from the front and the side', () => {
    for (const depth of [0, 1]) {
      const front = plankPosture(plank(depth), 'head-on', ASPECT, depth ? 90 : 175);
      expect(front.horizontal && !front.upright).toBe(true);
      const side = plankPosture(modelLandmarks({ depth, camera: SIDE_CAMERA, aspect: 16 / 9 }), 'side', 16 / 9, depth ? 90 : 175);
      expect(side.horizontal && !side.upright).toBe(true);
    }
    expect(plankPosture(plank(0), 'head-on', ASPECT, 175).atTop).toBe(true);
    expect(plankPosture(plank(1), 'head-on', ASPECT, 90).atTop).toBe(false);
  });

  it('reads kneeling/sitting/standing upright as upright, not a plank', () => {
    const posture = plankPosture(upright(0), 'head-on', ASPECT, 175);
    expect(posture.horizontal).toBe(false);
    expect(posture.upright).toBe(true);
    expect(posture.reason).toMatch(/upright/);
  });

  it('a hidden landmark is not evidence of being upright', () => {
    const hipsHidden = plank(0).map((p, i) => (i === 23 || i === 24 ? { ...p, visibility: 0.1 } : p));
    expect(plankPosture(hipsHidden, 'head-on', ASPECT, 175)).toMatchObject({ horizontal: true, upright: false });
    const handsDim = plank(1).map((p, i) => (i === 15 || i === 16 ? { ...p, visibility: 0.35 } : p));
    expect(plankPosture(handsDim, 'head-on', ASPECT, 90)).toMatchObject({ horizontal: false, upright: false });
  });
});

describe('rep counting gate', () => {
  it('reproduces the set 2 false rep: rest posture → getting into plank is not a rep', () => {
    // After "Go" Connor is still kneeling up with straight arms, bends them to put his hands down,
    // then straightens into the plank. Elbow angle alone saw top → bottom → top = one rep.
    const run = feed(newRun(), [...hold(upright, 0, 400), ...pushup(800, upright), ...hold(plank, 0, 800)]);
    expect(count(run)).toBe(0);
    expect(run.events).toEqual(['armed']);
    feed(run, [...pushup(), ...hold(plank, 0, 300), ...pushup(), ...hold(plank, 0, 300)]);
    expect(count(run)).toBe(2);
  });

  it('a state left mid-rep at the end of set 1 would complete a rep on the return to plank, which is why every set starts fresh', () => {
    const stale = feed(newRun(), [...hold(plank, 0, 700), ...hold(plank, 1, 700)]);
    expect(stale.tracker.machine.armed && stale.tracker.machine.phase === 'bottom').toBe(true);
    const carried = feed({ ...stale, events: [] }, hold(plank, 0, 300));
    expect(count(carried)).toBe(1);
    const fresh = feed({ ...newRun(), now: carried.now }, hold(plank, 0, 700));
    expect(fresh.events).toEqual(['armed']);
  });

  it('arms after a brief moment at the top, not before', () => {
    const run = feed(newRun(), hold(plank, 0, ARM_MS - 150));
    expect(run.tracker.machine.armed).toBe(false);
    feed(run, [...hold(plank, 0, 300), ...pushup(), ...hold(plank, 0, 200)]);
    expect(count(run)).toBe(1);
  });

  it('counts poor-form reps (shallow, fast, soft lockout, sagging, flared) and scores them instead of dropping them', () => {
    const sag = (depth: number) => modelLandmarks({ depth, aspect: ASPECT, hipDrop: 0.18, tuckDegrees: 80 });
    const shallowBottom = 0.34; // about 122° counting angle: just past the down line
    const softTop = 0.08; // never fully locks out
    const frames = [
      ...hold(sag, softTop, 500),
      ...pushup(1500, sag, shallowBottom, softTop),
      ...hold(sag, softTop, 200),
      ...pushup(700, sag, 1, softTop), // fast
      ...hold(sag, softTop, 200),
      ...pushup(2500, sag, 0.6, softTop),
      ...hold(sag, softTop, 200),
    ];
    const run = feed(newRun(), frames);
    expect(count(run)).toBe(3);
    expect(run.dropped).toBe(0);
    // Form only changes the score: the soft lockout and the rush cost points, with the reasons.
    expect(run.reps.every((rep) => rep.score < 100 && rep.notes.includes(LOCKOUT_NOTE))).toBe(true);
    expect(run.reps[1].notes).toContain(RUSHED_NOTE);
  });

  it('counts when the wrists dim at the bottom (head-on occlusion) and the body no longer reads as a plank', () => {
    const dimBottom = (depth: number) => plank(depth).map((p, i) => (depth > 0.5 && (i === 15 || i === 16) ? { ...p, visibility: 0.35 } : p));
    const run = feed(newRun(), [...hold(plank, 0, 500), ...pushup(1600, dimBottom), ...hold(plank, 0, 200)]);
    expect(count(run)).toBe(1);
  });

  it('still counts and keeps the rep when the bottom frames are too dim to score', () => {
    const blind = (depth: number) => plank(depth).map((p, i) => (depth > 0.4 && [11, 12, 13, 14, 15, 16].includes(i) ? { ...p, visibility: 0.32 } : p));
    const run = feed(newRun(), [...hold(plank, 0, 500), ...pushup(1600, blind), ...hold(plank, 0, 200)]);
    expect(count(run)).toBe(1);
    expect(run.reps).toHaveLength(1);
  });

  it('a shallow dip is not a rep, and is reported', () => {
    const run = feed(newRun(), [...hold(plank, 0, 500), ...pushup(1200, plank, 0.22), ...hold(plank, 0, 300)]);
    expect(count(run)).toBe(0);
    expect(run.events).toContain('shallow');
  });

  it('a one-frame glitch is ignored; an impossibly fast full cycle is rejected and reported', () => {
    const glitch = feed(newRun(), [...hold(plank, 0, 500), plank(1), ...hold(plank, 0, 300)]);
    expect(glitch.events).toEqual(['armed']);
    const fast = feed(newRun(), [...hold(plank, 0, 500), ...pushup(MIN_REP_MS - 120), ...hold(plank, 0, 300)]);
    expect(count(fast)).toBe(0);
    expect(fast.events).toContain('rejected-fast');
  });

  it('kneeling up mid-set pauses counting; bending the arms while upright never counts', () => {
    const run = feed(newRun(), hold(plank, 0, 500));
    feed(run, hold(upright, 0, UPRIGHT_DISARM_MS + 200));
    expect(run.events).toContain('disarmed');
    feed(run, [...pushup(1600, upright), ...hold(upright, 0, 200)]);
    expect(count(run)).toBe(0);
    feed(run, [...hold(plank, 0, 500), ...pushup(), ...hold(plank, 0, 200)]);
    expect(count(run)).toBe(1);
  });

  it('a brief upright reading at the bottom of a rep (sagging hips) does not lose the rep', () => {
    const blip = pushup().map((points, i, all) => (Math.abs(i - all.length / 2) < 5 ? upright(1) : points));
    const run = feed(newRun(), [...hold(plank, 0, 500), ...blip, ...hold(plank, 0, 200)]);
    expect(count(run)).toBe(1);
  });

  it('counts a normal set of five, head-on and from the side', () => {
    let frames: PosePoint[][] = hold(plank, 0, 500);
    for (let i = 0; i < 5; i += 1) frames = [...frames, ...pushup(1500), ...hold(plank, 0, 250)];
    expect(count(feed(newRun(), frames))).toBe(5);
    const side = (depth: number) => modelLandmarks({ depth, camera: SIDE_CAMERA, aspect: 16 / 9 });
    let sideFrames: PosePoint[][] = hold(side, 0, 500);
    for (let i = 0; i < 5; i += 1) sideFrames = [...sideFrames, ...pushup(1500, side), ...hold(side, 0, 250)];
    expect(count(feed(newRun(), sideFrames, 'side', 16 / 9))).toBe(5);
  });

  it('uses wide hysteresis', () => {
    expect(REP_UP_ANGLE - REP_DOWN_ANGLE).toBeGreaterThanOrEqual(20);
  });
});

/** Five reps of varied, often poor form: depth past the down line, soft lockouts, sag/pike, flare, 0.7–2.6 s. */
function volunteerReps(seed: number): NoisyRep[] {
  const r = rng(seed * 7919);
  return Array.from({ length: 5 }, () => ({
    bottom: r.range(0.38, 0.95),
    top: r.range(0, 0.06),
    durationMs: r.range(700, 2600),
    pauseMs: r.range(150, 1200),
    hipDrop: r.range(-0.08, 0.15),
    tuck: r.range(35, 80),
  }));
}

describe('iPhone-like noisy head-on sets', () => {
  const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);
  const lead = (set: 1 | 2): LeadIn[] =>
    set === 1
      ? [{ kind: 'plank', ms: 600 }]
      : // Set 2 started by hand while still kneeling: kneel → get down → plank.
        [{ kind: 'kneel', ms: 900 }, { kind: 'get-down', ms: 1400 }, { kind: 'plank', ms: 500 }];

  for (const set of [1, 2] as const) {
    it(`set ${set}: counts exactly the five real reps in every run, and scores each one`, () => {
      const misses: string[] = [];
      for (const seed of SEEDS) {
        const frames = noisyPushups({ seed: seed + set * 1000, aspect: 9 / 16, leadIn: lead(set), reps: volunteerReps(seed) });
        const run = feedNoisy(newRun(), frames, 'head-on', 9 / 16);
        if (count(run) !== 5 || run.dropped) misses.push(`seed ${seed}: ${count(run)} reps (${run.events.join(' ')})`);
      }
      expect(misses).toEqual([]);
    });
  }

  it('poor light (more jitter, dropouts, glitches) still counts every rep', () => {
    const misses: string[] = [];
    for (const seed of SEEDS.slice(0, 15)) {
      const frames = noisyPushups({ seed: seed + 5000, aspect: 9 / 16, noise: 1.6, leadIn: [{ kind: 'plank', ms: 700 }], reps: volunteerReps(seed) });
      const run = feedNoisy(newRun(), frames, 'head-on', 9 / 16);
      if (count(run) !== 5) misses.push(`seed ${seed}: ${count(run)} reps (${run.events.join(' ')})`);
    }
    expect(misses).toEqual([]);
  });

  it('a landscape stream counts the same reps', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const frames = noisyPushups({ seed: seed + 7000, aspect: 16 / 9, leadIn: [{ kind: 'plank', ms: 600 }], reps: volunteerReps(seed) });
      expect(count(feedNoisy(newRun(), frames, 'head-on', 16 / 9))).toBe(5);
    }
  });

  it('side view with noise counts every rep', () => {
    // From the side, elbows flared toward the camera read nearly straight in 2D whatever the depth,
    // so side reps here keep the elbows within the range that view can measure.
    for (const seed of SEEDS.slice(0, 8)) {
      const reps = volunteerReps(seed).map((rep) => ({ ...rep, tuck: Math.min(rep.tuck ?? 45, 55) }));
      const frames = noisyPushups({ seed: seed + 9000, aspect: 16 / 9, camera: SIDE_CAMERA, leadIn: [{ kind: 'plank', ms: 600 }], reps });
      expect(count(feedNoisy(newRun(), frames, 'side', 16 / 9))).toBe(5);
    }
  });
});

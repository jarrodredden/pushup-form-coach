import { describe, expect, it } from 'vitest';
import { LIVE_CUES } from './coaching';
import { addRepFrame, analyzePose, BOTTOM_WINDOW_DEGREES, createEmptyRepAccumulator, finalizeRep, REP_BOTTOM_ANGLE } from './scoring';
import { PoseAnalysis, PosePoint } from './types';

function makeGoodPose(): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.42, y: 0.35, visibility: 1 };
  points[12] = { x: 0.58, y: 0.35, visibility: 1 };
  points[13] = { x: 0.38, y: 0.47, visibility: 1 };
  points[14] = { x: 0.62, y: 0.47, visibility: 1 };
  points[15] = { x: 0.34, y: 0.56, visibility: 1 };
  points[16] = { x: 0.66, y: 0.56, visibility: 1 };
  points[23] = { x: 0.42, y: 0.56, visibility: 1 };
  points[24] = { x: 0.58, y: 0.56, visibility: 1 };
  points[25] = { x: 0.42, y: 0.78, visibility: 1 };
  points[26] = { x: 0.58, y: 0.78, visibility: 1 };
  points[27] = { x: 0.42, y: 0.98, visibility: 1 };
  points[28] = { x: 0.58, y: 0.98, visibility: 1 };
  return points;
}

function makeBadPose(): PosePoint[] {
  const points = makeGoodPose();
  points[23] = { x: 0.42, y: 0.82, visibility: 1 };
  points[24] = { x: 0.58, y: 0.82, visibility: 1 };
  points[15] = { x: 0.02, y: 0.58, visibility: 1 };
  points[16] = { x: 0.88, y: 0.58, visibility: 1 };
  return points;
}

describe('push-up scoring', () => {
  it('scores a clean body line higher than a broken one', () => {
    const clean = analyzePose(makeGoodPose());
    const broken = analyzePose(makeBadPose());
    expect(clean.handStackScore).toBeGreaterThan(broken.handStackScore);
  });

  it('keeps head-on setup hints focused on hands and torso', () => {
    const points = makeGoodPose();
    points[11].visibility = 0.1;
    points[12].visibility = 0.1;
    points[15].visibility = 0.1;
    points[16].visibility = 0.1;
    const headOn = analyzePose(points, 'head-on');
    const hint = headOn.setupHint?.toLowerCase() ?? '';
    expect(hint).not.toContain('feet');
    expect(hint).toContain('hands');
  });

  it('reads low hips as sagging and high hips as piking from the head-on view', () => {
    const sagging = analyzePose(makeBadPose(), 'head-on');
    expect(sagging.hipBias).toBeGreaterThan(0);
    expect(sagging.notes).toContain(LIVE_CUES.hipSag);
    expect(sagging.notes).not.toContain(LIVE_CUES.hipPike);

    const pikedPoints = makeGoodPose();
    pikedPoints[23] = { x: 0.42, y: 0.4, visibility: 1 };
    pikedPoints[24] = { x: 0.58, y: 0.4, visibility: 1 };
    const piking = analyzePose(pikedPoints, 'head-on');
    expect(piking.hipBias).toBeLessThan(0);
    expect(piking.notes).toContain(LIVE_CUES.hipPike);
    expect(piking.notes).not.toContain(LIVE_CUES.hipSag);
    expect(piking.notes.join(' ')).not.toMatch(/hips lower/i);
  });
});

function frameAt(elbowAngle: number, overrides: Partial<PoseAnalysis> = {}): PoseAnalysis {
  const depth = Math.round(Math.max(0, Math.min(100, ((160 - elbowAngle) / 75) * 100)));
  return {
    viewMode: 'head-on',
    overallScore: 0,
    elbowAngle,
    elbowDepthScore: depth,
    bodyLineScore: 90,
    elbowFlareScore: 90,
    handStackScore: 90,
    headAlignmentScore: 90,
    framingScore: 90,
    hipSagScore: null,
    hipPikeScore: null,
    hipBias: 0,
    confidence: 0.95,
    phase: elbowAngle >= 155 ? 'top' : elbowAngle <= 95 ? 'bottom' : 'mid',
    setupHint: null,
    notes: depth < 55 ? [LIVE_CUES.depth] : ['Clean head-on rep.'],
    ...overrides,
  };
}

function scoreRep(angles: number[], overrides: (angle: number) => Partial<PoseAnalysis> = () => ({})) {
  let accumulator = createEmptyRepAccumulator();
  for (const angle of angles) accumulator = addRepFrame(accumulator, frameAt(angle, overrides(angle)));
  return finalizeRep(accumulator, frameAt(160), 1);
}

describe('bottom-of-rep scoring', () => {
  const descent = (from: number, to: number, frames: number) =>
    Array.from({ length: frames }, (_, index) => from - ((from - to) * index) / Math.max(frames - 1, 1));

  it('scores a slow coached rep the same as a quick one with the same bottom', () => {
    const bottom = [88, 86, 85, 86, 88];
    const quick = scoreRep([...descent(155, 125, 3), ...bottom, ...descent(125, 155, 3)]);
    const slow = scoreRep([...descent(157, 121, 60), ...bottom, ...descent(121, 157, 60)]);
    expect(quick).not.toBeNull();
    expect(slow?.score).toBe(quick?.score);
    expect(slow?.elbowDepthScore).toBe(quick?.elbowDepthScore);
    expect(slow?.bottomElbowAngle).toBe(85);
    expect(slow?.elbowDepthScore).toBeGreaterThanOrEqual(95);
  });

  it('only keeps frames at or below the down threshold', () => {
    let accumulator = createEmptyRepAccumulator();
    for (const angle of [155, 140, 130, 121]) accumulator = addRepFrame(accumulator, frameAt(angle));
    expect(accumulator.frames).toBe(4);
    expect(accumulator.bottomFrames).toHaveLength(0);
    expect(finalizeRep(accumulator, frameAt(160), 1)).toBeNull();
    accumulator = addRepFrame(accumulator, frameAt(REP_BOTTOM_ANGLE));
    expect(accumulator.bottomFrames).toHaveLength(1);
  });

  it('scores from the deepest window and ignores form wobble on the way through the threshold', () => {
    const rep = scoreRep([118, 116, 90, 89, 90, 116, 118], (angle) =>
      angle > 90 + BOTTOM_WINDOW_DEGREES ? { bodyLineScore: 20, hipBias: 60, notes: [LIVE_CUES.hipSag] } : {},
    );
    expect(rep?.bodyLineScore).toBe(90);
    expect(rep?.notes).not.toContain(LIVE_CUES.hipSag);
  });

  it('does not carry top-of-rep depth notes into a deep rep', () => {
    const rep = scoreRep([150, 140, 130, 88, 86, 88, 130, 150]);
    expect(rep?.notes).not.toContain(LIVE_CUES.depth);
  });

  it('keeps the signed hip bias at the bottom so the coach knows pike vs sag', () => {
    const rep = scoreRep([100, 95, 92, 95], () => ({ bodyLineScore: 60, hipBias: -40 }));
    expect(rep?.hipBias).toBe(-40);
  });
});

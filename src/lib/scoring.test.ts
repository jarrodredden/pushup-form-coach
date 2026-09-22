import { describe, expect, it } from 'vitest';
import { analyzePose, createEmptyRepAccumulator, finalizeRep } from './scoring';
import { PosePoint } from './types';

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

  it('finalizes a rep from accumulated samples', () => {
    const accumulator = createEmptyRepAccumulator();
    accumulator.samples = 4;
    accumulator.depth = 360;
    accumulator.hipSag = 340;
    accumulator.hipPike = 330;
    accumulator.handStack = 350;
    accumulator.notes = ['Keep the body in frame.'];
    const rep = finalizeRep(accumulator, analyzePose(makeGoodPose()), 1);
    expect(rep).not.toBeNull();
    expect(rep?.score).toBeGreaterThan(80);
    expect(rep?.index).toBe(1);
  });
});

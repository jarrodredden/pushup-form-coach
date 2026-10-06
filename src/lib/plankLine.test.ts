import { describe, expect, it } from 'vitest';
import { weightedRepScore } from './coaching';
import type { Camera } from './idealPushup';
import { SIDE_CAMERA } from './idealPushup';
import { measureFrontPlank, measureSidePlank, updatePlankReference, type PlankReference } from './plankLine';
import { modelLandmarks } from './poseFixtures';

const floorCameras: Camera[] = [0.05, 0.3, 0.6].flatMap((height) =>
  [1.2, 1.8].map((distance) => ({ eye: { x: 0, y: height, z: distance }, target: { x: 0, y: 0.2, z: -0.5 }, focal: 0.9 })),
);

function calibrated(camera: Camera, aspect: number): PlankReference {
  let reference: PlankReference = {};
  for (let i = 0; i < 4; i += 1) reference = updatePlankReference(reference, modelLandmarks({ camera, aspect }), aspect);
  return reference;
}

describe('front-view plank line', () => {
  it('scores a straight plank high at every depth, camera height, distance, and stream aspect', () => {
    for (const aspect of [0.75, 16 / 9]) {
      for (const camera of floorCameras) {
        const reference = calibrated(camera, aspect);
        for (const depth of [0, 0.5, 1]) {
          const plank = measureFrontPlank(modelLandmarks({ camera, aspect, depth }), aspect, reference);
          expect(plank.method).toBe('front-hips');
          expect(plank.score).toBeGreaterThanOrEqual(90);
        }
      }
    }
  });

  it('reads sagging hips as sag and raised hips as pike', () => {
    for (const camera of floorCameras) {
      const reference = calibrated(camera, 0.75);
      const sag = measureFrontPlank(modelLandmarks({ camera, depth: 1, hipDrop: 0.12 }), 0.75, reference);
      const pike = measureFrontPlank(modelLandmarks({ camera, depth: 1, hipDrop: -0.12 }), 0.75, reference);
      expect(sag.score).toBeLessThan(75);
      expect(sag.bias).toBeGreaterThan(0);
      expect(pike.score).toBeLessThan(75);
      expect(pike.bias).toBeLessThan(0);
    }
  });

  it('falls back to the knees when the hips are hidden', () => {
    const camera = floorCameras[2];
    const reference = calibrated(camera, 0.75);
    const plank = measureFrontPlank(modelLandmarks({ camera, depth: 1, hidden: [23, 24] }), 0.75, reference);
    expect(plank.method).toBe('front-knees');
    expect(plank.score).toBeGreaterThanOrEqual(85);
    const sag = measureFrontPlank(modelLandmarks({ camera, depth: 1, hipDrop: 0.15, hidden: [23, 24] }), 0.75, reference);
    expect(sag.bias).toBeGreaterThan(0);
  });

  it('is n/a, never 0, when hips and knees are out of view, and drops out of the overall score', () => {
    const plank = measureFrontPlank(modelLandmarks({ depth: 1, hidden: [23, 24, 25, 26, 27, 28] }), 0.75, {});
    expect(plank.score).toBeNull();
    expect(plank.bias).toBe(0);
    const metrics = { depth: 90, elbowFlare: 100, handStack: 90, headAlignment: 90 };
    expect(weightedRepScore('head-on', { ...metrics, bodyLine: null })).toBe(91);
    expect(weightedRepScore('head-on', { ...metrics, bodyLine: 0 })).toBeLessThan(75);
  });
});

describe('side-view plank line', () => {
  it('scores a straight body (165–180°) high and a bent one low with the right direction', () => {
    for (const depth of [0, 0.5, 1]) {
      const straight = measureSidePlank(modelLandmarks({ camera: SIDE_CAMERA, aspect: 16 / 9, depth }), 16 / 9);
      expect(straight.method).toBe('side-ankles');
      expect(straight.score).toBeGreaterThanOrEqual(95);
    }
    const sag = measureSidePlank(modelLandmarks({ camera: SIDE_CAMERA, aspect: 16 / 9, depth: 1, hipDrop: 0.15 }), 16 / 9);
    const pike = measureSidePlank(modelLandmarks({ camera: SIDE_CAMERA, aspect: 16 / 9, depth: 1, hipDrop: -0.2 }), 16 / 9);
    expect(sag.bias).toBeGreaterThan(0);
    expect(sag.score).toBeLessThan(80);
    expect(pike.bias).toBeLessThan(0);
    expect(pike.score).toBeLessThan(80);
  });

  it('uses the knees when the ankles are out of frame', () => {
    const plank = measureSidePlank(modelLandmarks({ camera: SIDE_CAMERA, aspect: 16 / 9, depth: 1, hidden: [27, 28] }), 16 / 9);
    expect(plank.method).toBe('side-knees');
    expect(plank.score).toBeGreaterThanOrEqual(95);
  });
});

import { describe, expect, it } from 'vitest';
import { createRollingMedian, DEFAULT_ELBOW_IDEAL_RANGE, elbowTuckScore, normalizeElbowRange, worldElbowAbduction } from './elbowTuck';

describe('elbow tuck score', () => {
  it('gives full credit at or below the ideal range, including fully tucked elbows', () => {
    for (const degrees of [0, 10, 25, 30, 45, 50]) expect(elbowTuckScore(degrees)).toBe(100);
    expect(elbowTuckScore(null)).toBe(100);
  });

  it('ramps gently past the max and scores the 75–90° flare low', () => {
    expect(elbowTuckScore(55)).toBeGreaterThanOrEqual(90);
    expect(elbowTuckScore(60)).toBe(85);
    expect(elbowTuckScore(75)).toBeLessThanOrEqual(45);
    expect(elbowTuckScore(90)).toBeLessThanOrEqual(10);
    let previous = 100;
    for (let degrees = 50; degrees <= 100; degrees += 1) {
      const score = elbowTuckScore(degrees);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it('follows a custom Admin range', () => {
    expect(elbowTuckScore(58, { min: 30, max: 60 })).toBe(100);
    expect(elbowTuckScore(58, { min: 20, max: 40 })).toBeLessThan(85);
  });

  it('normalizes saved or partial ranges', () => {
    expect(normalizeElbowRange(undefined)).toEqual(DEFAULT_ELBOW_IDEAL_RANGE);
    expect(normalizeElbowRange({ min: 70, max: 40 })).toEqual({ min: 40, max: 40 });
    expect(normalizeElbowRange({ min: -5, max: 200 })).toEqual({ min: 0, max: 85 });
  });
});

describe('elbow angle readings', () => {
  it('measures abduction from 3D world landmarks in the plank plane', () => {
    const shoulderMid = { x: 0, y: 0, z: 0 };
    const hipMid = { x: 0, y: 0, z: 0.5 };
    const shoulder = { x: 0.19, y: 0, z: 0 };
    const otherShoulder = { x: -0.19, y: 0, z: 0 };
    const at = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return { x: 0.19 + Math.sin(radians) * 0.3, y: -0.1, z: Math.cos(radians) * 0.3 };
    };
    for (const degrees of [10, 45, 80]) {
      expect(worldElbowAbduction(shoulder, at(degrees), otherShoulder, shoulderMid, hipMid)).toBeCloseTo(degrees, 0);
    }
    expect(worldElbowAbduction(shoulder, { x: 0.19, y: -0.3, z: 0.01 }, otherShoulder, shoulderMid, hipMid)).toBeNull();
  });

  it('ignores single-frame jitter with a rolling median', () => {
    const smoother = createRollingMedian(5);
    const readings = [40, 41, 39, 85, 40, 42].map((value) => smoother.push(value));
    expect(readings.at(-1)).toBeLessThan(45);
    expect(smoother.push(null)).toBe(readings.at(-1));
  });
});

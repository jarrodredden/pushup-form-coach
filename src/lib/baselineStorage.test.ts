import { describe, expect, it } from 'vitest';
import { createDefaultBaselineReference, elbowDegreesForDepthScore, gradingAngleForView, scoreAgainstBaseline } from './baselineStorage';

describe('100-standard scoring', () => {
  it('gives full credit for an exact match or anything inside the tolerance band', () => {
    expect(scoreAgainstBaseline(90, 90, 10)).toBe(100);
    expect(scoreAgainstBaseline(81, 90, 10)).toBe(100);
    expect(scoreAgainstBaseline(98, 90, 10)).toBe(100);
  });

  it('scales shortfalls proportionally instead of dropping to zero at the tolerance edge', () => {
    expect(scoreAgainstBaseline(40, 90, 10)).toBe(50);
    expect(scoreAgainstBaseline(0, 90, 10)).toBe(0);
  });

  it('falls back to the heuristic score when no target is set', () => {
    expect(scoreAgainstBaseline(63, null, 10)).toBe(63);
  });

  it('maps camera views to the baseline angle used for grading', () => {
    expect(gradingAngleForView('head-on')).toBe('front');
    expect(gradingAngleForView('side')).toBe('side');
  });

  it('starts new standards at a perfect 100 draft', () => {
    const draft = createDefaultBaselineReference('front');
    expect(draft.targets.elbowDepthScore).toBe(100);
    expect(draft.targets.hipPikeScore).toBeNull();
    expect(elbowDegreesForDepthScore(100)).toBe(85);
  });
});

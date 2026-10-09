import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultBaselineReference,
  elbowDegreesForDepthScore,
  elbowRangeFor,
  gradingAngleForView,
  loadBaselines,
  scoreAgainstBaseline,
} from './baselineStorage';
import { weightedRepScore } from './coaching';
import { DEFAULT_ELBOW_IDEAL_RANGE, elbowTuckScore } from './elbowTuck';
import type { BaselinePoseReference } from './types';

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
    expect(elbowDegreesForDepthScore(100)).toBe(90);
    expect(elbowDegreesForDepthScore(70)).toBe(100);
    expect(draft.elbowIdealRange).toEqual(DEFAULT_ELBOW_IDEAL_RANGE);
  });

  it('keeps a perfect 100 reachable against the default standard with tucked elbows', () => {
    const reference = createDefaultBaselineReference('front');
    const score = (key: keyof typeof reference.targets) => scoreAgainstBaseline(100, reference.targets[key], reference.tolerances[key]);
    const overall = weightedRepScore('head-on', {
      depth: score('elbowDepthScore'),
      bodyLine: score('bodyLineScore'),
      elbowFlare: elbowTuckScore(35, elbowRangeFor(reference)),
      handStack: score('handStackScore'),
      headAlignment: score('headAlignmentScore'),
    });
    expect(overall).toBe(100);
  });

  it('gives standards saved before the elbow range existed the default 30–50° range', () => {
    const store = new Map<string, string>();
    const legacy = { ...createDefaultBaselineReference('front') } as Partial<BaselinePoseReference>;
    delete legacy.elbowIdealRange;
    store.set('pushup-coach-baselines', JSON.stringify({ updatedAt: '2026-01-01', references: { front: legacy, side: null, back: null, top: null } }));
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    try {
      const loaded = loadBaselines().references.front;
      expect(loaded?.elbowIdealRange).toEqual(DEFAULT_ELBOW_IDEAL_RANGE);
      expect(loaded?.targets.elbowDepthScore).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

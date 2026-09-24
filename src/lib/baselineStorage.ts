import type { BaselineAngle, SavedBaselines, BaselinePoseReference, PoseAnalysis } from './types';

const BASELINE_STORAGE_KEY = 'pushup-coach-baselines';

const emptyBaselines = (): SavedBaselines => ({
  updatedAt: new Date(0).toISOString(),
  references: { front: null, back: null, side: null, top: null },
});

export function loadBaselines(): SavedBaselines {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return emptyBaselines();
    const parsed = JSON.parse(raw) as SavedBaselines;
    return {
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      references: {
        front: parsed.references?.front ?? null,
        back: parsed.references?.back ?? null,
        side: parsed.references?.side ?? null,
        top: parsed.references?.top ?? null,
      },
    };
  } catch {
    return emptyBaselines();
  }
}

export function saveBaselines(baselines: SavedBaselines) {
  localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselines));
}

export function createBaselineReference(angle: BaselineAngle, analysis: PoseAnalysis, label: string): BaselinePoseReference {
  return {
    angle,
    createdAt: new Date().toISOString(),
    label,
    elbowDepthScore: analysis.elbowDepthScore,
    bodyLineScore: analysis.bodyLineScore,
    elbowFlareScore: analysis.elbowFlareScore,
    handStackScore: analysis.handStackScore,
    headAlignmentScore: analysis.headAlignmentScore,
    framingScore: analysis.framingScore,
    hipSagScore: analysis.hipSagScore,
    hipPikeScore: analysis.hipPikeScore,
    confidence: analysis.confidence,
    notes: analysis.notes,
  };
}

export function blendBaselineScore(actual: number, baseline: number | null, tolerance = 12) {
  if (baseline === null) return actual;
  const delta = actual - baseline;
  const adjusted = actual + Math.max(-tolerance, Math.min(tolerance, delta)) * 0.35;
  return Math.round(Math.max(0, Math.min(100, adjusted)));
}

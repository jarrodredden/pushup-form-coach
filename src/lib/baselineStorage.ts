import type { BaselineAngle, SavedBaselines, BaselinePoseReference, PoseAnalysis } from './types';

const BASELINE_STORAGE_KEY = 'pushup-coach-baselines';

const emptyBaselines = (): SavedBaselines => ({
  updatedAt: new Date(0).toISOString(),
  references: { front: null, back: null, side: null, top: null },
});

function normalizeReference(reference: BaselinePoseReference | null): BaselinePoseReference | null {
  if (!reference) return null;
  if (reference.targets && reference.tolerances) return reference;
  return {
    ...reference,
    targets: {
      elbowDepthScore: reference.elbowDepthScore,
      bodyLineScore: reference.bodyLineScore,
      elbowFlareScore: reference.elbowFlareScore,
      handStackScore: reference.handStackScore,
      headAlignmentScore: reference.headAlignmentScore,
      framingScore: reference.framingScore,
      hipSagScore: reference.hipSagScore,
      hipPikeScore: reference.hipPikeScore,
    },
    tolerances: {
      elbowDepthScore: 12,
      bodyLineScore: 12,
      elbowFlareScore: 12,
      handStackScore: 12,
      headAlignmentScore: 12,
      framingScore: 15,
      hipSagScore: 12,
      hipPikeScore: 12,
    },
  };
}

export function loadBaselines(): SavedBaselines {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return emptyBaselines();
    const parsed = JSON.parse(raw) as SavedBaselines;
    return {
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      references: {
        front: normalizeReference(parsed.references?.front ?? null),
        back: normalizeReference(parsed.references?.back ?? null),
        side: normalizeReference(parsed.references?.side ?? null),
        top: normalizeReference(parsed.references?.top ?? null),
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
  const targets = {
    elbowDepthScore: analysis.elbowDepthScore,
    bodyLineScore: analysis.bodyLineScore,
    elbowFlareScore: analysis.elbowFlareScore,
    handStackScore: analysis.handStackScore,
    headAlignmentScore: analysis.headAlignmentScore,
    framingScore: analysis.framingScore,
    hipSagScore: analysis.hipSagScore,
    hipPikeScore: analysis.hipPikeScore,
  };
  return {
    angle,
    createdAt: new Date().toISOString(),
    label,
    targets,
    tolerances: {
      elbowDepthScore: 12,
      bodyLineScore: 12,
      elbowFlareScore: 12,
      handStackScore: 12,
      headAlignmentScore: 12,
      framingScore: 15,
      hipSagScore: 12,
      hipPikeScore: 12,
    },
    elbowDepthScore: targets.elbowDepthScore,
    bodyLineScore: targets.bodyLineScore,
    elbowFlareScore: targets.elbowFlareScore,
    handStackScore: targets.handStackScore,
    headAlignmentScore: targets.headAlignmentScore,
    framingScore: targets.framingScore,
    hipSagScore: targets.hipSagScore,
    hipPikeScore: targets.hipPikeScore,
    confidence: analysis.confidence,
    notes: analysis.notes,
  };
}

export function scoreAgainstBaseline(actual: number, target: number | null, tolerance = 12) {
  if (target === null) return actual;
  const delta = Math.abs(actual - target);
  const score = 100 - Math.min(100, (delta / Math.max(tolerance, 1)) * 100);
  return Math.round(Math.max(0, Math.min(100, score)));
}

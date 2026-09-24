import type { BaselineAngle, BaselinePoseReference, CameraViewMode, PoseAnalysis, SavedBaselines } from './types';

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

export type BaselineMetricKey = keyof BaselinePoseReference['targets'];

export const BASELINE_METRICS: Array<{ key: BaselineMetricKey; label: string; hint: string; sideOnly?: boolean }> = [
  { key: 'elbowDepthScore', label: 'Elbow depth', hint: 'How low you go. 100 = elbows bent to about 85°.' },
  { key: 'bodyLineScore', label: 'Plank line', hint: 'Shoulders, hips, and ankles in one straight line.' },
  { key: 'elbowFlareScore', label: 'Elbow tuck', hint: 'Elbows stay close instead of flaring out wide.' },
  { key: 'handStackScore', label: 'Hands under shoulders', hint: 'Wrists stacked below the shoulders.' },
  { key: 'headAlignmentScore', label: 'Head position', hint: 'Head centered, neck neutral.' },
  { key: 'framingScore', label: 'Framing', hint: 'How much of the body the camera can see.' },
  { key: 'hipSagScore', label: 'Hip sag', hint: 'Hips dropping below the plank line.', sideOnly: true },
  { key: 'hipPikeScore', label: 'Hip pike (butt up)', hint: 'Hips rising above the plank line.', sideOnly: true },
];

export const BASELINE_ANGLES: Array<{ angle: BaselineAngle; label: string; placement: string }> = [
  { angle: 'front', label: 'Front', placement: 'Phone on the floor about 1.5 m in front, lens near shoulder height. Used for Head-on grading.' },
  { angle: 'side', label: 'Side', placement: 'Phone at hip height about 2 m to the side so shoulders, hips, and ankles fit. Used for Side grading.' },
  { angle: 'back', label: 'Back', placement: 'Phone low behind the feet, pointing toward the head.' },
  { angle: 'top', label: 'Top', placement: 'Phone overhead on a mount, pointing straight down at the back.' },
];

export function gradingAngleForView(view: CameraViewMode): BaselineAngle {
  return view === 'side' ? 'side' : 'front';
}

export function elbowDegreesForDepthScore(score: number) {
  return Math.round(160 - (Math.max(0, Math.min(100, score)) * 75) / 100);
}

export function createDefaultBaselineReference(angle: BaselineAngle): BaselinePoseReference {
  return createBaselineReference(
    angle,
    {
      viewMode: angle === 'side' ? 'side' : 'head-on',
      overallScore: 100,
      elbowAngle: 85,
      elbowDepthScore: 100,
      bodyLineScore: 100,
      elbowFlareScore: 100,
      handStackScore: 100,
      headAlignmentScore: 100,
      framingScore: 100,
      hipSagScore: angle === 'side' ? 100 : null,
      hipPikeScore: angle === 'side' ? 100 : null,
      confidence: 1,
      phase: 'bottom',
      setupHint: null,
      notes: [],
    },
    `${angle} 100 standard`,
  );
}

// Scores are "higher is better", so anything at or above (target - tolerance) earns full credit
// and shortfalls scale proportionally toward zero.
export function scoreAgainstBaseline(actual: number, target: number | null, tolerance = 12) {
  if (target === null) return actual;
  const fullCreditAt = Math.max(1, target - Math.max(0, tolerance));
  const score = (actual / fullCreditAt) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

import { CameraViewMode, PoseAnalysis, PosePoint, RepAccumulator, SessionRep } from './types';

export const MIN_SIGNAL = 0.45;

const REQUIRED = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const point = (landmarks: PosePoint[] | undefined, index: number): PosePoint | null => landmarks?.[index] ?? null;
const midpoint = (a: PosePoint, b: PosePoint): PosePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
});
const distance = (a: PosePoint, b: PosePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: PosePoint, b: PosePoint, c: PosePoint) => {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!mag) return 180;
  return (Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI;
};
const averageVisibility = (landmarks: PosePoint[] | undefined, indices: readonly number[]) => {
  if (!landmarks?.length) return 0;
  const sum = indices.reduce((acc, index) => acc + (landmarks[index]?.visibility ?? 0), 0);
  return sum / indices.length;
};
const mean = (...values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const scoreLine = (offset: number, scale: number) => clamp(100 - offset * scale, 0, 100);
const bodyLineY = (shoulderMid: PosePoint, hipMid: PosePoint, ankleMid: PosePoint) =>
  shoulderMid.y + ((hipMid.x - shoulderMid.x) * (ankleMid.y - shoulderMid.y)) / Math.max(ankleMid.x - shoulderMid.x, 0.05);

function buildHeadOnNotes(metrics: {
  elbowDepthScore: number;
  bodyLineScore: number;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  setupHint: string | null;
}) {
  const notes: string[] = [];
  if (metrics.setupHint) notes.push(metrics.setupHint);
  // Front-view coaching is intentionally softer so depth and flare stay achievable on a phone camera.
  if (metrics.elbowDepthScore < 55) notes.push('Lower a little deeper at the bottom of the rep.');
  if (metrics.bodyLineScore < 74) notes.push('Keep the hips lower and the body straighter.');
  if (metrics.elbowFlareScore < 68) notes.push('Tuck the elbows in a bit more from the front view.');
  if (metrics.handStackScore < 74) notes.push('Stack the hands under the shoulders.');
  if (metrics.headAlignmentScore < 72) notes.push('Keep the head centered between the shoulders.');
  if (metrics.framingScore < 70 && !metrics.setupHint) notes.push('Back up or lower the phone until hands, torso, and head stay in frame.');
  if (!notes.length) notes.push('Clean head-on rep.');
  return notes;
}

function buildSideNotes(metrics: {
  elbowDepthScore: number;
  bodyLineScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  handStackScore: number;
  elbowFlareScore: number;
  setupHint: string | null;
}) {
  const notes: string[] = [];
  if (metrics.setupHint) notes.push(metrics.setupHint);
  if (metrics.elbowDepthScore < 58) notes.push('Lower a bit deeper.');
  if (metrics.bodyLineScore < 74) notes.push('Keep the body in a straighter plank line.');
  if ((metrics.hipSagScore ?? 100) < 74) notes.push('Keep the hips from sagging.');
  if ((metrics.hipPikeScore ?? 100) < 74) notes.push('Keep the hips level and avoid piking.');
  if (metrics.handStackScore < 74) notes.push('Keep hands stacked under the shoulders.');
  if (metrics.elbowFlareScore < 74) notes.push('Tuck the elbows a little more.');
  if (!notes.length) notes.push('Clean side-view rep.');
  return notes;
}

function framingHint(landmarks: PosePoint[] | undefined, viewMode: CameraViewMode) {
  const wristsVisible = averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]);
  const anklesVisible = averageVisibility(landmarks, [LEFT.ankle, RIGHT.ankle]);
  const shouldersVisible = averageVisibility(landmarks, [LEFT.shoulder, RIGHT.shoulder]);
  const headVisible = averageVisibility(landmarks, [0, 1, 2, 5, 7, 8]);
  if (viewMode === 'head-on') {
    if (wristsVisible < 0.35 && shouldersVisible < 0.35) return 'Move back so hands, torso, and head are visible.';
    if (wristsVisible < 0.45) return 'Move back a little so both hands stay visible.';
    if (shouldersVisible < 0.45) return 'Center the torso in frame.';
    if (headVisible < 0.35) return 'Raise the phone so the head stays visible.';
    return null;
  }
  if (wristsVisible < 0.4 && anklesVisible < 0.4) return 'Use a wider side setup so wrists, hips, and shoulders stay visible.';
  if (anklesVisible < 0.45) return 'Back the phone up a little so the body stays in frame.';
  return null;
}

export function analyzePose(landmarks: PosePoint[] | undefined, viewMode: CameraViewMode = 'head-on'): PoseAnalysis {
  const confidence = averageVisibility(landmarks, REQUIRED);
  if (!landmarks?.length || confidence < MIN_SIGNAL) {
    const setupHint = viewMode === 'head-on'
      ? 'Move back until hands, torso, and head are visible.'
      : 'Move far enough back that the full side profile stays visible.';
    return {
      viewMode,
      overallScore: 0,
      elbowAngle: 180,
      elbowDepthScore: 0,
      bodyLineScore: 0,
      elbowFlareScore: 0,
      handStackScore: 0,
      headAlignmentScore: 0,
      framingScore: 0,
      hipSagScore: null,
      hipPikeScore: null,
      confidence,
      phase: 'unknown',
      setupHint,
      notes: [setupHint],
    };
  }

  const lShoulder = point(landmarks, LEFT.shoulder)!;
  const rShoulder = point(landmarks, RIGHT.shoulder)!;
  const lElbow = point(landmarks, LEFT.elbow)!;
  const rElbow = point(landmarks, RIGHT.elbow)!;
  const lWrist = point(landmarks, LEFT.wrist)!;
  const rWrist = point(landmarks, RIGHT.wrist)!;
  const lHip = point(landmarks, LEFT.hip)!;
  const rHip = point(landmarks, RIGHT.hip)!;
  const lAnkle = point(landmarks, LEFT.ankle)!;
  const rAnkle = point(landmarks, RIGHT.ankle)!;
  const nose = point(landmarks, 0);

  const shoulderMid = midpoint(lShoulder, rShoulder);
  const hipMid = midpoint(lHip, rHip);
  const ankleMid = midpoint(lAnkle, rAnkle);
  const wristMid = midpoint(lWrist, rWrist);
  const shoulderWidth = Math.max(distance(lShoulder, rShoulder), 0.001);
  const torsoLength = Math.max(distance(shoulderMid, hipMid), 0.001);
  const headVisible = averageVisibility(landmarks, [0, 1, 2, 5, 7, 8]);

  const leftElbowAngle = angle(lShoulder, lElbow, lWrist);
  const rightElbowAngle = angle(rShoulder, rElbow, rWrist);
  const elbowAngle = mean(leftElbowAngle, rightElbowAngle);
  const elbowDepthScore = clamp(((160 - elbowAngle) / 75) * 100, 0, 100);
  const elbowFlareOffset = mean(
    Math.abs(lElbow.x - lShoulder.x) / shoulderWidth,
    Math.abs(rElbow.x - rShoulder.x) / shoulderWidth,
  );
  const elbowFlareScore = scoreLine(elbowFlareOffset, 180);
  const handStackOffset = Math.abs(wristMid.x - shoulderMid.x) / shoulderWidth;
  const handStackScore = scoreLine(handStackOffset, 220);
  const headAlignmentScore = nose && (nose.visibility ?? 0) > 0.35
    ? scoreLine(Math.abs(nose.x - shoulderMid.x) / shoulderWidth, 220)
    : 55;
  const framingHintText = framingHint(landmarks, viewMode);
  const phase = elbowAngle >= 155 ? 'top' : elbowAngle <= 95 ? 'bottom' : 'mid';
  const bodyLineProxyScore = clamp(
    100 - Math.abs((hipMid.y - shoulderMid.y) - shoulderWidth * 1.4) / Math.max(shoulderWidth * 0.7, 0.02) * 100,
    0,
    100,
  );
  const framingScore = Math.round(
    clamp(
      (averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]) * 0.55 + averageVisibility(landmarks, [LEFT.ankle, RIGHT.ankle]) * 0.45) * 100,
      0,
      100,
    ),
  );

  let hipSagScore: number | null = null;
  let hipPikeScore: number | null = null;
  let bodyLineScore = 0;
  let overallScore = 0;
  let notes: string[] = [];

  if (viewMode === 'side') {
    const lineY = bodyLineY(shoulderMid, hipMid, ankleMid);
    const hipDeviation = hipMid.y - lineY;
    hipSagScore = clamp(100 - Math.max(0, hipDeviation / torsoLength) * 240, 0, 100);
    hipPikeScore = clamp(100 - Math.max(0, -hipDeviation / torsoLength) * 240, 0, 100);
    bodyLineScore = Math.round(((hipSagScore ?? 0) + (hipPikeScore ?? 0)) / 2);
    overallScore = Math.round(
      elbowDepthScore * 0.56 +
        bodyLineScore * 0.28 +
        handStackScore * 0.1 +
        elbowFlareScore * 0.06,
    );
    notes = buildSideNotes({
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      hipSagScore,
      hipPikeScore,
      handStackScore: Math.round(handStackScore),
      elbowFlareScore: Math.round(elbowFlareScore),
      setupHint: framingHintText,
    });
  } else {
    bodyLineScore = Math.round(bodyLineProxyScore);
    const headOnFrameScore = clamp(
      averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]) * 40 +
        averageVisibility(landmarks, [LEFT.shoulder, RIGHT.shoulder]) * 35 +
        headVisible * 25,
      0,
      100,
    );
    overallScore = Math.round(
      elbowDepthScore * 0.55 +
        bodyLineScore * 0.24 +
        elbowFlareScore * 0.09 +
        handStackScore * 0.07 +
        headAlignmentScore * 0.05,
    );
    notes = buildHeadOnNotes({
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      elbowFlareScore: Math.round(elbowFlareScore),
      handStackScore: Math.round(handStackScore),
      headAlignmentScore: Math.round(headAlignmentScore),
      framingScore: Math.round(headOnFrameScore),
      setupHint: framingHintText,
    });
    return {
      viewMode,
      overallScore,
      elbowAngle,
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      elbowFlareScore: Math.round(elbowFlareScore),
      handStackScore: Math.round(handStackScore),
      headAlignmentScore: Math.round(headAlignmentScore),
      framingScore: Math.round(headOnFrameScore),
      hipSagScore,
      hipPikeScore,
      confidence: clamp(confidence, 0, 1),
      phase,
      setupHint: framingHintText,
      notes,
    };
  }

  return {
    viewMode,
    overallScore,
    elbowAngle,
    elbowDepthScore: Math.round(elbowDepthScore),
    bodyLineScore,
    elbowFlareScore: Math.round(elbowFlareScore),
    handStackScore: Math.round(handStackScore),
    headAlignmentScore: Math.round(headAlignmentScore),
    framingScore,
    hipSagScore,
    hipPikeScore,
    confidence: clamp(confidence, 0, 1),
    phase,
    setupHint: framingHintText,
    notes,
  };
}

export function createEmptyRepAccumulator(): RepAccumulator {
  return {
    samples: 0,
    depth: 0,
    bodyLine: 0,
    elbowFlare: 0,
    headAlignment: 0,
    framing: 0,
    hipSag: 0,
    hipPike: 0,
    handStack: 0,
    bestOverall: 0,
    worstOverall: 100,
    notes: [],
  };
}

export function finalizeRep(accumulator: RepAccumulator, analysis: PoseAnalysis, index: number): SessionRep | null {
  if (!accumulator.samples) return null;
  const depth = accumulator.depth / accumulator.samples;
  const bodyLine = accumulator.bodyLine / accumulator.samples;
  const elbowFlare = accumulator.elbowFlare / accumulator.samples;
  const headAlignment = accumulator.headAlignment / accumulator.samples;
  const framing = accumulator.framing / accumulator.samples;
  const hipSag = accumulator.hipSag / accumulator.samples;
  const hipPike = accumulator.hipPike / accumulator.samples;
  const handStack = accumulator.handStack / accumulator.samples;
  const analysisNotes = analysis.setupHint
    ? analysis.notes.filter((note) => note !== analysis.setupHint)
    : analysis.notes;

  const score =
    analysis.viewMode === 'side'
      ? Math.round(depth * 0.56 + bodyLine * 0.28 + handStack * 0.1 + elbowFlare * 0.06)
      : Math.round(depth * 0.55 + bodyLine * 0.24 + elbowFlare * 0.09 + handStack * 0.07 + headAlignment * 0.05);

  return {
    index,
    viewMode: analysis.viewMode,
    score,
    notes: [...new Set([...accumulator.notes, ...analysisNotes])].slice(0, 6),
    elbowDepthScore: Math.round(depth),
    bodyLineScore: Math.round(bodyLine || analysis.bodyLineScore),
    elbowFlareScore: Math.round(elbowFlare),
    handStackScore: Math.round(handStack),
    headAlignmentScore: Math.round(headAlignment),
    framingScore: Math.round(framing),
    hipSagScore: analysis.viewMode === 'side' ? Math.round(hipSag) : null,
    hipPikeScore: analysis.viewMode === 'side' ? Math.round(hipPike) : null,
    confidence: analysis.confidence,
    timestamp: Date.now(),
  };
}

import { PoseAnalysis, PosePoint, RepAccumulator, SessionRep } from './types';

export const MIN_SIGNAL = 0.45;

const REQUIRED = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const point = (landmarks: PosePoint[] | undefined, index: number): PosePoint | null => landmarks?.[index] ?? null;

const visibilityScore = (landmarks: PosePoint[] | undefined) => {
  if (!landmarks?.length) return 0;
  const sum = REQUIRED.reduce((acc, index) => acc + (landmarks[index]?.visibility ?? 0), 0);
  return sum / REQUIRED.length;
};

function buildNotes(score: number, elbow: number, hipSag: number, hipPike: number, handStack: number) {
  const notes: string[] = [];
  if (score >= 85) notes.push('Excellent rep shape.');
  if (elbow < 72) notes.push('Go a bit deeper at the bottom.');
  if (hipSag < 74) notes.push('Keep the hips from sagging.');
  if (hipPike < 74) notes.push('Flatten the body line and avoid piking.');
  if (handStack < 72) notes.push('Keep hands stacked under shoulders.');
  return notes;
}

export function analyzePose(landmarks: PosePoint[] | undefined): PoseAnalysis {
  const confidence = visibilityScore(landmarks);
  if (!landmarks?.length || confidence < MIN_SIGNAL) {
    return {
      overallScore: 0,
      elbowAngle: 180,
      elbowDepthScore: 0,
      hipSagScore: 0,
      hipPikeScore: 0,
      handStackScore: 0,
      confidence,
      phase: 'unknown',
      notes: confidence < MIN_SIGNAL ? ['Move the full body into frame.'] : ['Waiting for a clear pose.'],
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

  const shoulderMid = midpoint(lShoulder, rShoulder);
  const hipMid = midpoint(lHip, rHip);
  const ankleMid = midpoint(lAnkle, rAnkle);
  const wristMid = midpoint(lWrist, rWrist);

  const leftElbowAngle = angle(lShoulder, lElbow, lWrist);
  const rightElbowAngle = angle(rShoulder, rElbow, rWrist);
  const elbowAngle = (leftElbowAngle + rightElbowAngle) / 2;

  const torsoLength = Math.max(distance(shoulderMid, hipMid), 0.001);
  const bodyLineYAtHip = shoulderMid.y + ((hipMid.x - shoulderMid.x) * (ankleMid.y - shoulderMid.y)) / Math.max(ankleMid.x - shoulderMid.x, 0.05);
  const hipDeviation = hipMid.y - bodyLineYAtHip;

  const elbowDepthScore = clamp(((160 - elbowAngle) / 75) * 100, 0, 100);
  const hipSagScore = clamp(100 - Math.max(0, hipDeviation / torsoLength) * 240, 0, 100);
  const hipPikeScore = clamp(100 - Math.max(0, -hipDeviation / torsoLength) * 240, 0, 100);
  const wristStackOffset = Math.abs(wristMid.x - shoulderMid.x) / Math.max(distance(lShoulder, rShoulder), 0.001);
  const handStackScore = clamp(100 - wristStackOffset * 220, 0, 100);

  const overallScore = Math.round(elbowDepthScore * 0.42 + hipSagScore * 0.2 + hipPikeScore * 0.18 + handStackScore * 0.2);
  const phase = elbowAngle >= 155 ? 'top' : elbowAngle <= 95 ? 'bottom' : 'mid';
  const notes = buildNotes(overallScore, elbowDepthScore, hipSagScore, hipPikeScore, handStackScore);

  return {
    overallScore,
    elbowAngle,
    elbowDepthScore: Math.round(elbowDepthScore),
    hipSagScore: Math.round(hipSagScore),
    hipPikeScore: Math.round(hipPikeScore),
    handStackScore: Math.round(handStackScore),
    confidence: clamp(confidence, 0, 1),
    phase,
    notes,
  };
}

export function createEmptyRepAccumulator(): RepAccumulator {
  return {
    samples: 0,
    depth: 0,
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
  const hipSag = accumulator.hipSag / accumulator.samples;
  const hipPike = accumulator.hipPike / accumulator.samples;
  const handStack = accumulator.handStack / accumulator.samples;
  const score = Math.round(depth * 0.4 + hipSag * 0.2 + hipPike * 0.2 + handStack * 0.2);
  return {
    index,
    score,
    notes: [...new Set([...accumulator.notes, ...analysis.notes])].slice(0, 6),
    elbowDepthScore: Math.round(depth),
    hipSagScore: Math.round(hipSag),
    hipPikeScore: Math.round(hipPike),
    handStackScore: Math.round(handStack),
    confidence: analysis.confidence,
    timestamp: Date.now(),
  };
}

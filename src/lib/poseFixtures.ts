import { FRONT_CAMERA, project, pushupSkeleton, type Camera, type PushupJoint } from './idealPushup';
import type { PosePoint } from './types';

/** MediaPipe pose indices for the model's joints (11 = the athlete's left shoulder). */
const LANDMARK_INDEX: Partial<Record<PushupJoint, number>> = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lToe: 31,
  rToe: 32,
};

export interface FixtureOptions {
  depth?: number;
  tuckDegrees?: number;
  hipDrop?: number;
  camera?: Camera;
  /** videoWidth / videoHeight of the simulated stream. */
  aspect?: number;
  hidden?: number[];
}

/** Normalized landmarks a camera would report for the model push-up. */
export function modelLandmarks({ depth = 0, tuckDegrees = 45, hipDrop = 0, camera = FRONT_CAMERA, aspect = 0.75, hidden = [] }: FixtureOptions = {}): PosePoint[] {
  const skeleton = pushupSkeleton(depth, tuckDegrees, hipDrop);
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  for (const [joint, index] of Object.entries(LANDMARK_INDEX) as [PushupJoint, number][]) {
    const p = project(skeleton[joint], camera);
    points[index] = { x: 0.5 + p.x / aspect, y: 0.5 + p.y, visibility: hidden.includes(index) ? 0.1 : 0.98 };
  }
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) points[index] = { ...points[0] };
  return points;
}

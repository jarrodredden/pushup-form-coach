import { CameraViewMode, PosePoint } from './types';

const makePoint = (x: number, y: number, visibility = 0.96): PosePoint => ({ x, y, visibility });

export function createDemoPose(frameIndex: number, viewMode: CameraViewMode = 'head-on'): PosePoint[] {
  if (viewMode === 'head-on') {
    const cycle = (frameIndex % 180) / 180;
    const sink = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
    const elbowTighten = 0.02 + sink * 0.03;
    const elbowDrop = 0.08 + sink * 0.06;
    const headBob = Math.sin(cycle * Math.PI * 2) * 0.01;
    const shoulderY = 0.35;
    const hipY = 0.6 + sink * 0.015;
    const ankleY = 0.94;
    return [
      makePoint(0.5, 0.14 + headBob),
      makePoint(0.46, 0.15 + headBob),
      makePoint(0.54, 0.15 + headBob),
      makePoint(0.43, 0.2),
      makePoint(0.57, 0.2),
      makePoint(0.41, 0.26),
      makePoint(0.59, 0.26),
      makePoint(0.38, 0.34),
      makePoint(0.62, 0.34),
      makePoint(0.47, 0.3),
      makePoint(0.53, 0.3),
      makePoint(0.41, shoulderY),
      makePoint(0.59, shoulderY),
      makePoint(0.37 - elbowTighten, shoulderY + elbowDrop),
      makePoint(0.63 + elbowTighten, shoulderY + elbowDrop),
      makePoint(0.39 - elbowTighten, shoulderY + 0.15 + elbowDrop * 0.35),
      makePoint(0.61 + elbowTighten, shoulderY + 0.15 + elbowDrop * 0.35),
      makePoint(0.43, hipY),
      makePoint(0.57, hipY),
      makePoint(0.43, hipY + 0.17),
      makePoint(0.57, hipY + 0.17),
      makePoint(0.43, ankleY - 0.04),
      makePoint(0.57, ankleY - 0.04),
      makePoint(0.43, hipY + 0.34),
      makePoint(0.57, hipY + 0.34),
      makePoint(0.43, ankleY - 0.02),
      makePoint(0.57, ankleY - 0.02),
      makePoint(0.43, ankleY),
      makePoint(0.57, ankleY),
      makePoint(0.5, 0.98),
      makePoint(0.5, 0.98),
      makePoint(0.49, 0.99),
      makePoint(0.51, 0.99),
      makePoint(0.5, 1.0),
    ];
  }

  const cycle = (frameIndex % 180) / 180;
  const pushPhase = Math.sin(cycle * Math.PI * 2);
  const elbowDrop = 0.12 + ((1 - pushPhase) / 2) * 0.18;
  const hipDrop = 0.03 + ((1 - Math.cos(cycle * Math.PI * 2)) / 2) * 0.03;
  const hipPike = frameIndex % 360 > 240 ? 0.05 : 0;
  const handSpread = 0.08;
  const shoulderY = 0.36;
  const hipY = shoulderY + 0.18 + hipDrop - hipPike;
  const ankleY = 0.9;
  const shoulderX = 0.5;

  return [
    makePoint(0.5, 0.14),
    makePoint(0.46, 0.15),
    makePoint(0.54, 0.15),
    makePoint(0.43, 0.22),
    makePoint(0.57, 0.22),
    makePoint(0.41, 0.28),
    makePoint(0.59, 0.28),
    makePoint(0.38, 0.38),
    makePoint(0.62, 0.38),
    makePoint(0.47, 0.34),
    makePoint(0.53, 0.34),
    makePoint(shoulderX - 0.12, shoulderY),
    makePoint(shoulderX + 0.12, shoulderY),
    makePoint(shoulderX - 0.14, shoulderY + elbowDrop),
    makePoint(shoulderX + 0.14, shoulderY + elbowDrop),
    makePoint(shoulderX - 0.18 - handSpread * 0.3, shoulderY + elbowDrop + 0.18),
    makePoint(shoulderX + 0.18 + handSpread * 0.3, shoulderY + elbowDrop + 0.18),
    makePoint(shoulderX - 0.09, hipY),
    makePoint(shoulderX + 0.09, hipY),
    makePoint(shoulderX - 0.1, hipY + 0.18),
    makePoint(shoulderX + 0.1, hipY + 0.18),
    makePoint(shoulderX - 0.11, ankleY - 0.05),
    makePoint(shoulderX + 0.11, ankleY - 0.05),
    makePoint(shoulderX - 0.11, hipY + 0.36),
    makePoint(shoulderX + 0.11, hipY + 0.36),
    makePoint(shoulderX - 0.12, ankleY - 0.02),
    makePoint(shoulderX + 0.12, ankleY - 0.02),
    makePoint(shoulderX - 0.12, ankleY),
    makePoint(shoulderX + 0.12, ankleY),
    makePoint(0.47, 0.98),
    makePoint(0.53, 0.98),
    makePoint(0.46, 0.99),
    makePoint(0.54, 0.99),
    makePoint(0.5, 1.0),
  ];
}

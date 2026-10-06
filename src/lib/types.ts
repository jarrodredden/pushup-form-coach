export type FeedbackMode = 'control' | 'visual' | 'audio' | 'combined';
export type CameraFacing = 'user' | 'environment';
export type CameraViewMode = 'head-on' | 'side';

import type { PlankMethod } from './plankLine';

export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface PoseAnalysis {
  viewMode: CameraViewMode;
  overallScore: number;
  elbowAngle: number;
  elbowDepthScore: number;
  /** Plank line 0–100; null when the camera can't see enough to judge it (never 0 for missing data). */
  bodyLineScore: number | null;
  plankRaw: number | null;
  plankMethod: PlankMethod | null;
  plankDetail: string | null;
  elbowFlareScore: number;
  /** Upper-arm-to-torso angle in the plank plane (degrees); null when the camera can't read it. */
  elbowAbduction: number | null;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  /** Signed hip-line deficit: positive = hips sagging, negative = hips piking, ~0 = level. */
  hipBias: number;
  confidence: number;
  phase: 'top' | 'bottom' | 'mid' | 'unknown';
  setupHint: string | null;
  notes: string[];
}

export interface RepFrameSample {
  elbowAngle: number;
  depth: number;
  bodyLine: number | null;
  plankRaw: number | null;
  plankMethod: PlankMethod | null;
  elbowFlare: number;
  elbowAbduction: number | null;
  headAlignment: number;
  framing: number;
  hipSag: number | null;
  hipPike: number | null;
  hipBias: number;
  handStack: number;
  notes: string[];
}

export interface RepAccumulator {
  frames: number;
  bottomFrames: RepFrameSample[];
}

export interface SessionRep {
  index: number;
  attempt?: number;
  viewMode: CameraViewMode;
  score: number;
  notes: string[];
  elbowDepthScore: number;
  bodyLineScore: number | null;
  plankMethod?: PlankMethod | null;
  /** Median raw plank-line reading over the scored bottom frames (see plankLine.ts for units). */
  plankRaw?: number | null;
  plankDebug?: string;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  hipBias?: number;
  bottomElbowAngle?: number;
  elbowAbduction?: number;
  /** Feedback the volunteer received while doing this rep. */
  feedbackMode?: FeedbackMode;
  /** Real-time Up/Down tempo cues were playing during this rep. */
  tempoCues?: boolean;
  confidence: number;
  timestamp: number;
}

export interface LogEntry {
  id: string;
  at: number;
  kind: 'system' | 'rep' | 'cue' | 'info';
  message: string;
  details?: string;
}

export interface SessionEntry {
  id: string;
  name: string;
  createdAt: string;
  reps: number;
  averageScore: number;
  bestScore: number;
  beforeScore: number;
  afterScore: number;
  mode: FeedbackMode;
  cameraFacing: CameraFacing;
  cameraView: CameraViewMode;
  notes: string[];
}

export interface SessionSummary {
  id: string;
  name: string;
  dateIso: string;
  reps: number;
  averageScore: number;
  bestScore: number;
  beforeScore: number;
  afterScore: number;
  notes: string[];
}

export type BaselineAngle = 'front' | 'back' | 'side' | 'top';

export interface BaselinePoseReference {
  angle: BaselineAngle;
  createdAt: string;
  label: string;
  targets: {
    elbowDepthScore: number;
    bodyLineScore: number;
    elbowFlareScore: number;
    handStackScore: number;
    headAlignmentScore: number;
    framingScore: number;
    hipSagScore: number | null;
    hipPikeScore: number | null;
  };
  tolerances: {
    elbowDepthScore: number;
    bodyLineScore: number;
    elbowFlareScore: number;
    handStackScore: number;
    headAlignmentScore: number;
    framingScore: number;
    hipSagScore: number;
    hipPikeScore: number;
  };
  /**
   * Ideal upper-arm-to-torso angle (degrees). Elbow tuck is graded on this range instead of the
   * elbowFlareScore target/tolerance; standards saved before it existed get the default range.
   */
  elbowIdealRange?: { min: number; max: number };
  elbowDepthScore: number;
  bodyLineScore: number;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  confidence: number;
  notes: string[];
}

export interface SavedBaselines {
  updatedAt: string;
  references: Record<BaselineAngle, BaselinePoseReference | null>;
}

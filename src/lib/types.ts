export type FeedbackMode = 'control' | 'visual' | 'audio' | 'combined';
export type CameraFacing = 'user' | 'environment';
export type CameraViewMode = 'head-on' | 'side';

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
  bodyLineScore: number;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  confidence: number;
  phase: 'top' | 'bottom' | 'mid' | 'unknown';
  setupHint: string | null;
  notes: string[];
}

export interface RepAccumulator {
  samples: number;
  depth: number;
  bodyLine: number;
  elbowFlare: number;
  headAlignment: number;
  framing: number;
  hipSag: number;
  hipPike: number;
  handStack: number;
  bestOverall: number;
  worstOverall: number;
  notes: string[];
}

export interface SessionRep {
  index: number;
  viewMode: CameraViewMode;
  score: number;
  notes: string[];
  elbowDepthScore: number;
  bodyLineScore: number;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipSagScore: number | null;
  hipPikeScore: number | null;
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
  demoMode: boolean;
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

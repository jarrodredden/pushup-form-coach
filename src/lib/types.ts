export type FeedbackMode = 'control' | 'visual' | 'audio' | 'combined';
export type CameraFacing = 'user' | 'environment';

export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface PoseAnalysis {
  overallScore: number;
  elbowAngle: number;
  elbowDepthScore: number;
  hipSagScore: number;
  hipPikeScore: number;
  handStackScore: number;
  confidence: number;
  phase: 'top' | 'bottom' | 'mid' | 'unknown';
  notes: string[];
}

export interface RepAccumulator {
  samples: number;
  depth: number;
  hipSag: number;
  hipPike: number;
  handStack: number;
  bestOverall: number;
  worstOverall: number;
  notes: string[];
}

export interface SessionRep {
  index: number;
  score: number;
  notes: string[];
  elbowDepthScore: number;
  hipSagScore: number;
  hipPikeScore: number;
  handStackScore: number;
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

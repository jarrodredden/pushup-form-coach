import { FOCUS_LINES, HIP_BIAS_MIN, rankCoachingTips } from './coaching';
import type { CameraViewMode } from './types';

export const REPS_PER_SET = 5;

export type WorkflowMode = 'free' | 'coaching';
export type CoachingTrialState = 'idle' | 'attempt-1' | 'between-attempts' | 'attempt-2' | 'complete';
export type CalibrationState = 'idle' | 'checking' | 'ready' | 'countdown' | 'counting';
export type CameraStatus = 'idle' | 'loading' | 'live' | 'error';
export type JourneyPhase = 'setup' | 'calibrating' | 'countdown' | 'set' | 'break' | 'results';

export interface JourneyStep {
  key: string;
  label: string;
}

export function attemptForTrialState(state: CoachingTrialState): 0 | 1 | 2 {
  if (state === 'attempt-1') return 1;
  if (state === 'attempt-2') return 2;
  return 0;
}

export function trialStateAfterRep(state: CoachingTrialState, repsInAttempt: number): CoachingTrialState {
  if (state === 'attempt-1' && repsInAttempt >= REPS_PER_SET) return 'between-attempts';
  if (state === 'attempt-2' && repsInAttempt >= REPS_PER_SET) return 'complete';
  return state;
}

export function deriveJourneyPhase(input: {
  cameraStatus: CameraStatus;
  calibrationState: CalibrationState;
  workflowMode: WorkflowMode;
  trialState: CoachingTrialState;
  hasResults: boolean;
}): JourneyPhase {
  const { cameraStatus, calibrationState, workflowMode, trialState, hasResults } = input;
  if (workflowMode === 'coaching' && trialState === 'complete') return 'results';
  const cameraActive = cameraStatus === 'live' || cameraStatus === 'loading';
  if (!cameraActive) return hasResults ? 'results' : 'setup';
  if (workflowMode === 'coaching' && trialState === 'between-attempts') return 'break';
  if (calibrationState === 'countdown') return 'countdown';
  if (calibrationState === 'counting') return 'set';
  return 'calibrating';
}

export function journeySteps(mode: WorkflowMode): JourneyStep[] {
  if (mode === 'coaching') {
    return [
      { key: 'setup', label: 'Name' },
      { key: 'calibrating', label: 'Frame' },
      { key: 'set-1', label: 'Set 1' },
      { key: 'break', label: 'Coach' },
      { key: 'set-2', label: 'Set 2' },
      { key: 'results', label: 'Results' },
    ];
  }
  return [
    { key: 'setup', label: 'Name' },
    { key: 'calibrating', label: 'Frame' },
    { key: 'set', label: 'Practice' },
    { key: 'results', label: 'Results' },
  ];
}

export function activeStepKey(phase: JourneyPhase, mode: WorkflowMode, trialState: CoachingTrialState): string {
  if (phase === 'setup' || phase === 'results' || phase === 'break') return phase;
  const inSet = phase === 'set' || phase === 'countdown';
  if (mode === 'coaching') {
    if (trialState === 'attempt-2') return inSet ? 'set-2' : 'calibrating';
    return inSet ? 'set-1' : 'calibrating';
  }
  return inSet ? 'set' : 'calibrating';
}

export interface RepLike {
  score: number;
  elbowDepthScore: number;
  bodyLineScore: number;
  elbowFlareScore: number;
  hipBias?: number;
}

/** 'mixed' = some reps piked and others sagged; null = no usable hip direction. */
export type SetHipDirection = 'pike' | 'sag' | 'mixed' | null;

export interface SetSummary {
  count: number;
  average: number;
  best: number;
  depth: number;
  bodyLine: number;
  elbowFlare: number;
  hipDirection: SetHipDirection;
}

/** One hip direction must account for at least this share of the set's hip deficit to be named. */
const HIP_DIRECTION_SHARE = 0.7;

function summarizeHipDirection(reps: RepLike[]): SetHipDirection {
  let pike = 0;
  let sag = 0;
  for (const rep of reps) {
    if (rep.hipBias === undefined || rep.hipBias === null) continue;
    if (rep.hipBias > 0) sag += rep.hipBias;
    else pike -= rep.hipBias;
  }
  const total = pike + sag;
  if (total < HIP_BIAS_MIN) return null;
  if (pike / total >= HIP_DIRECTION_SHARE) return 'pike';
  if (sag / total >= HIP_DIRECTION_SHARE) return 'sag';
  return 'mixed';
}

export function summarizeReps(reps: RepLike[]): SetSummary {
  if (!reps.length) return { count: 0, average: 0, best: 0, depth: 0, bodyLine: 0, elbowFlare: 0, hipDirection: null };
  const avg = (pick: (rep: RepLike) => number) => Math.round(reps.reduce((sum, rep) => sum + pick(rep), 0) / reps.length);
  return {
    count: reps.length,
    average: avg((rep) => rep.score),
    best: reps.reduce((best, rep) => Math.max(best, rep.score), 0),
    depth: avg((rep) => rep.elbowDepthScore),
    bodyLine: avg((rep) => rep.bodyLineScore),
    elbowFlare: avg((rep) => rep.elbowFlareScore),
    hipDirection: summarizeHipDirection(reps),
  };
}

export const FOCUS_PASS_LINES = { depth: 70, hips: 75, elbowFlare: 72 };

function hipFocusLines(direction: SetHipDirection) {
  if (direction === 'pike') return [FOCUS_LINES.hipPike];
  if (direction === 'sag') return [FOCUS_LINES.hipSag];
  return [FOCUS_LINES.hipPike, FOCUS_LINES.hipSag];
}

export function coachingFocusLines(summary: SetSummary, viewMode: CameraViewMode = 'head-on') {
  if (!summary.count) return ['Finish a few reps to get personal coaching.'];
  const ranked = rankCoachingTips(
    [
      { key: 'depth', score: summary.depth, passLine: FOCUS_PASS_LINES.depth },
      { key: 'hips', score: summary.bodyLine, passLine: FOCUS_PASS_LINES.hips },
      { key: 'elbowFlare', score: summary.elbowFlare, passLine: FOCUS_PASS_LINES.elbowFlare },
    ],
    viewMode,
  );
  if (!ranked.length) return [FOCUS_LINES.clean];
  return ranked.flatMap((tip) => {
    if (tip.key === 'hips') return hipFocusLines(summary.hipDirection);
    if (tip.key === 'depth') return [FOCUS_LINES.depth];
    return [FOCUS_LINES.elbowFlare];
  });
}

export function improvementVerdict(delta: number) {
  if (delta >= 8) return { tone: 'great' as const, headline: 'Big improvement!', detail: 'The coaching clearly helped — that is a real jump.' };
  if (delta >= 3) return { tone: 'good' as const, headline: 'You improved', detail: 'Set 2 was cleaner than set 1.' };
  if (delta > -3) return { tone: 'steady' as const, headline: 'Held steady', detail: 'Scores stayed about the same across both sets.' };
  return { tone: 'down' as const, headline: 'Tougher second set', detail: 'Fatigue happens — rest up and try again.' };
}

import { FOCUS_LINES, HIP_BIAS_MIN, rankCoachingTips } from './coaching';
import type { CameraViewMode, FeedbackMode } from './types';

export const REPS_PER_SET = 5;
/** Mandatory rest between coaching sets so set 2 isn't skewed by fatigue. */
export const REST_BREAK_MS = 120_000;

/** Wall-clock based so a throttled or backgrounded tab can't shorten the rest. Unknown start = fully locked. */
export function restRemainingMs(startedAt: number | null, now: number, durationMs = REST_BREAK_MS) {
  if (startedAt === null) return durationMs;
  return Math.min(durationMs, Math.max(0, durationMs - (now - startedAt)));
}

export function formatRestClock(remainingMs: number) {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export type WorkflowMode = 'free' | 'coaching';
export type CoachingTrialState = 'idle' | 'attempt-1' | 'between-attempts' | 'attempt-2' | 'complete';
export type CalibrationState = 'idle' | 'checking' | 'ready' | 'countdown' | 'counting';
export type CameraStatus = 'idle' | 'loading' | 'live' | 'error';
export type JourneyPhase = 'setup' | 'calibrating' | 'countdown' | 'set' | 'break' | 'results';

export interface JourneyStep {
  key: string;
  label: string;
}

/** 'study' is the volunteer protocol; Admin can pin one mode for every set when testing. */
export type FeedbackSetting = 'study' | FeedbackMode;

/**
 * Study protocol: set 1 is the no-coaching control (rep counting only); the rest break and set 2
 * get combined audio + visual coaching. Free practice is always coached.
 */
export function feedbackModeFor(setting: FeedbackSetting, workflowMode: WorkflowMode, trialState: CoachingTrialState): FeedbackMode {
  if (setting !== 'study') return setting;
  if (workflowMode !== 'coaching') return 'combined';
  return trialState === 'idle' || trialState === 'attempt-1' ? 'control' : 'combined';
}

/** Spoken form tips follow the protocol in study mode, and the Admin switch otherwise. */
export function spokenTipsFor(setting: FeedbackSetting, mode: FeedbackMode, adminSwitch: boolean) {
  if (setting === 'study') return mode === 'audio' || mode === 'combined';
  return adminSwitch;
}

/** Real-time Up/Down cues only run in modes with audio (so never in the set 1 control). */
export function tempoCuesFor(mode: FeedbackMode, enabled: boolean) {
  return enabled && (mode === 'audio' || mode === 'combined');
}

/** Which sets actually heard tempo cues, for the results sheet: "set2", "set1+set2", "on" (practice), or "off". */
export function tempoCuesLabel(reps: Array<{ attempt?: number; tempoCues?: boolean }>) {
  const cued = reps.filter((rep) => rep.tempoCues);
  if (!cued.length) return 'off';
  const sets = [...new Set(cued.map((rep) => rep.attempt ?? 0))].filter(Boolean).sort();
  return sets.length ? sets.map((set) => `set${set}`).join('+') : 'on';
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
      { key: 'consent', label: 'Consent' },
      { key: 'calibrating', label: 'Frame' },
      { key: 'set-1', label: 'Set 1' },
      { key: 'break', label: 'Coach' },
      { key: 'set-2', label: 'Set 2' },
      { key: 'results', label: 'Results' },
    ];
  }
  return [
    { key: 'setup', label: 'Name' },
    { key: 'consent', label: 'Consent' },
    { key: 'calibrating', label: 'Frame' },
    { key: 'set', label: 'Practice' },
    { key: 'results', label: 'Results' },
  ];
}

/** During setup, the Consent step lights up once a name is entered. */
export function activeStepKey(phase: JourneyPhase, mode: WorkflowMode, trialState: CoachingTrialState, hasName = false): string {
  if (phase === 'setup') return hasName ? 'consent' : 'setup';
  if (phase === 'results' || phase === 'break') return phase;
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
  bodyLineScore: number | null;
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
  /** Null when no rep in the set had a readable plank line. */
  bodyLine: number | null;
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
  if (!reps.length) return { count: 0, average: 0, best: 0, depth: 0, bodyLine: null, elbowFlare: 0, hipDirection: null };
  const avg = (pick: (rep: RepLike) => number) => Math.round(reps.reduce((sum, rep) => sum + pick(rep), 0) / reps.length);
  const plankScores = reps.map((rep) => rep.bodyLineScore).filter((value): value is number => value !== null && value !== undefined);
  return {
    count: reps.length,
    average: avg((rep) => rep.score),
    best: reps.reduce((best, rep) => Math.max(best, rep.score), 0),
    depth: avg((rep) => rep.elbowDepthScore),
    bodyLine: plankScores.length ? Math.round(plankScores.reduce((sum, value) => sum + value, 0) / plankScores.length) : null,
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
      ...(summary.bodyLine === null ? [] : [{ key: 'hips' as const, score: summary.bodyLine, passLine: FOCUS_PASS_LINES.hips }]),
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

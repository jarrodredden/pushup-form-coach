import { REP_CUE_LINES } from './repFeedback';
import type { CoachingTrialState, WorkflowMode } from './sessionFlow';
import type { CameraViewMode, FeedbackMode, PoseAnalysis, PosePoint } from './types';

/**
 * Live "good form" colouring for the skeleton. A component is good when its live score is at or
 * above the same line the coach uses for corrections (REP_CUE_LINES), so blue means "no correction
 * coming for this". Hysteresis keeps colours from flickering: a good component only drops back below
 * the line minus FORM_HYSTERESIS, and any change needs FORM_SWITCH_FRAMES frames in a row.
 */
export type FormComponent = 'elbowTuck' | 'plank' | 'hands' | 'head';

export const FORM_COMPONENTS: FormComponent[] = ['elbowTuck', 'plank', 'hands', 'head'];

export const FORM_GOOD_LINES: Record<FormComponent | 'depth', number> = {
  elbowTuck: REP_CUE_LINES.elbowFlare,
  plank: REP_CUE_LINES.hips,
  hands: REP_CUE_LINES.handStack,
  head: REP_CUE_LINES.headAlignment,
  depth: REP_CUE_LINES.depth,
};
export const FORM_HYSTERESIS = 5;
export const FORM_SWITCH_FRAMES = 3;
/** How long the depth pulse stays on after the chest last reached target depth. */
export const DEPTH_PULSE_MS = 700;

export const FORM_GOOD_COLOR = '#5BC8FF';

/** MediaPipe pose landmark pairs drawn as skeleton lines, tagged with the component that owns them. */
export const SKELETON_SEGMENTS: Array<{ from: number; to: number; component: FormComponent }> = [
  { from: 11, to: 12, component: 'hands' },
  { from: 11, to: 13, component: 'elbowTuck' },
  { from: 13, to: 15, component: 'elbowTuck' },
  { from: 12, to: 14, component: 'elbowTuck' },
  { from: 14, to: 16, component: 'elbowTuck' },
  { from: 11, to: 23, component: 'plank' },
  { from: 12, to: 24, component: 'plank' },
  { from: 23, to: 24, component: 'plank' },
  { from: 11, to: 24, component: 'plank' },
  { from: 12, to: 23, component: 'plank' },
  { from: 23, to: 25, component: 'plank' },
  { from: 25, to: 27, component: 'plank' },
  { from: 24, to: 26, component: 'plank' },
  { from: 26, to: 28, component: 'plank' },
];

/** Which component a landmark dot belongs to (0–10 face, 11–12 shoulders, 13–14 elbows, 15–22 wrists/hands, 23+ hips/legs/feet). */
export function jointComponent(index: number): FormComponent {
  if (index <= 10) return 'head';
  if (index === 13 || index === 14) return 'elbowTuck';
  if (index <= 22) return 'hands';
  return 'plank';
}

export const ELBOW_JOINTS = [13, 14];

/** Live component scores for one frame; null = the camera can't judge it (stays default colour). */
export interface FormScores {
  elbowTuck: number | null;
  plank: number | null;
  hands: number | null;
  head: number | null;
  depth: number;
}

export function formScoresFromAnalysis(frame: PoseAnalysis, landmarks: PosePoint[] | null | undefined, viewMode: CameraViewMode): FormScores {
  const nose = landmarks?.[0];
  const headReadable = viewMode === 'head-on' && (nose?.visibility ?? 0) > 0.35;
  return {
    elbowTuck: frame.elbowAbduction === null ? null : frame.elbowFlareScore,
    plank: frame.bodyLineScore,
    hands: frame.handStackScore,
    head: headReadable ? frame.headAlignmentScore : null,
    depth: frame.elbowDepthScore,
  };
}

export interface FormColorState {
  good: Record<FormComponent, boolean>;
  /** Consecutive frames the opposite state has been seen. */
  pending: Record<FormComponent, number>;
  depthPulseUntil: number;
}

const allComponents = <T,>(value: T): Record<FormComponent, T> => ({ elbowTuck: value, plank: value, hands: value, head: value });

export function createFormColorState(): FormColorState {
  return { good: allComponents(false), pending: allComponents(0), depthPulseUntil: 0 };
}

export function stepFormColors(state: FormColorState, scores: FormScores, now: number): FormColorState {
  const good = { ...state.good };
  const pending = { ...state.pending };
  for (const component of FORM_COMPONENTS) {
    const score = scores[component];
    if (score === null || !Number.isFinite(score)) {
      good[component] = false;
      pending[component] = 0;
      continue;
    }
    const line = FORM_GOOD_LINES[component];
    const wantsGood = good[component] ? score >= line - FORM_HYSTERESIS : score >= line;
    if (wantsGood === good[component]) {
      pending[component] = 0;
      continue;
    }
    pending[component] += 1;
    if (pending[component] >= FORM_SWITCH_FRAMES) {
      good[component] = wantsGood;
      pending[component] = 0;
    }
  }
  const depthPulseUntil = scores.depth >= FORM_GOOD_LINES.depth ? now + DEPTH_PULSE_MS : state.depthPulseUntil;
  return { good, pending, depthPulseUntil };
}

export function depthPulseActive(state: FormColorState, now: number) {
  return now < state.depthPulseUntil;
}

/**
 * Set 2 of a coaching session in a mode with visuals (Visual or Combined). Never set 1 or the
 * break, so the experiment's baseline set stays plain. Free practice only for an unlocked admin.
 */
export function formColorsActive(input: { feedbackMode: FeedbackMode; workflowMode: WorkflowMode; trialState: CoachingTrialState; adminUnlocked: boolean }) {
  if (input.feedbackMode !== 'visual' && input.feedbackMode !== 'combined') return false;
  if (input.workflowMode === 'coaching') return input.trialState === 'attempt-2';
  return input.adminUnlocked;
}

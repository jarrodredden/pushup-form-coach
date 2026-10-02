import type { CameraViewMode, PoseAnalysis } from './types';

export type CoachingMetricKey = 'depth' | 'hips' | 'elbowFlare' | 'handStack' | 'headAlignment';
export type CoachingIssueKey = 'setup' | 'depth' | 'hipPike' | 'hipSag' | 'elbowFlare' | 'handStack' | 'headAlignment';
export type HipDirection = 'pike' | 'sag';

export interface CoachingIssue {
  key: CoachingIssueKey;
  cue: string;
}

export const SCORE_WEIGHTS: Record<CameraViewMode, Record<CoachingMetricKey, number>> = {
  side: { depth: 0.56, hips: 0.28, handStack: 0.1, elbowFlare: 0.06, headAlignment: 0 },
  'head-on': { depth: 0.55, hips: 0.24, elbowFlare: 0.09, handStack: 0.07, headAlignment: 0.05 },
};

export function weightedRepScore(
  viewMode: CameraViewMode,
  metrics: { depth: number; bodyLine: number; elbowFlare: number; handStack: number; headAlignment: number },
) {
  const weights = SCORE_WEIGHTS[viewMode];
  return Math.round(
    metrics.depth * weights.depth +
      metrics.bodyLine * weights.hips +
      metrics.elbowFlare * weights.elbowFlare +
      metrics.handStack * weights.handStack +
      metrics.headAlignment * weights.headAlignment,
  );
}

export const LIVE_CUES: Record<Exclude<CoachingIssueKey, 'setup'>, string> = {
  depth: 'Go a little deeper while keeping hips level.',
  hipPike: 'Don’t pike — bring your hips down into a straight plank.',
  hipSag: 'Don’t sag — lift your hips and squeeze your belly.',
  elbowFlare: 'Tuck the elbows in.',
  handStack: 'Hands under shoulders.',
  headAlignment: 'Keep the head centered.',
};

export const FOCUS_LINES = {
  depth: 'Go a little deeper while keeping hips level — bend your elbows until your chest is close to the floor.',
  hipPike: 'Don’t pike — your hips were riding high. Bring them down into one straight plank line.',
  hipSag: 'Don’t sag — your hips were dropping. Squeeze your belly and glutes to hold a straight plank line.',
  elbowFlare: 'Tuck your elbows closer to your sides instead of flaring them out.',
  clean: 'Great form — keep the same depth and straight body line.',
};

/** Below this many points of one-sided hip deficit the hips count as level. */
export const HIP_BIAS_MIN = 3;

export function hipDirection(bias: number | null | undefined): HipDirection | null {
  if (bias === null || bias === undefined || Number.isNaN(bias)) return null;
  if (bias >= HIP_BIAS_MIN) return 'sag';
  if (bias <= -HIP_BIAS_MIN) return 'pike';
  return null;
}

export interface TipMetric {
  key: CoachingMetricKey;
  score: number;
  passLine: number;
  /** Override for metrics whose "needs work" gate is not simply score < passLine. */
  needsWork?: boolean;
}

export interface RankedTip {
  key: CoachingMetricKey;
  score: number;
  gain: number;
  risk: number;
  net: number;
  deferred: boolean;
}

/** Share of the remaining gap a single cue is expected to close. */
const CUE_GAP_CLOSE = 0.5;
/** A conflicting metric this many points weaker than the cued metric defers the cue. */
const MUCH_WEAKER_POINTS = 15;
/** Chasing depth tends to make a weak plank sag further and weak elbows flare wider. */
const CONFLICTS: Partial<Record<CoachingMetricKey, CoachingMetricKey[]>> = {
  depth: ['hips', 'elbowFlare'],
};

/**
 * Ranks the metrics that need work by expected net overall-score gain:
 * gain = weight × (100 − score) × CUE_GAP_CLOSE, minus the weighted deficit of any
 * metric the cue tends to worsen. Cues that would push against a much weaker metric
 * are deferred behind every other tip.
 */
export function rankCoachingTips(metrics: TipMetric[], viewMode: CameraViewMode): RankedTip[] {
  const weights = SCORE_WEIGHTS[viewMode];
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return metrics
    .filter((metric) => metric.needsWork ?? metric.score < metric.passLine)
    .map((metric) => {
      const gain = weights[metric.key] * Math.max(0, 100 - metric.score) * CUE_GAP_CLOSE;
      const conflicts = (CONFLICTS[metric.key] ?? [])
        .map((key) => byKey.get(key))
        .filter((conflict): conflict is TipMetric => Boolean(conflict));
      const risk = conflicts.reduce(
        (total, conflict) => total + weights[conflict.key] * Math.max(0, conflict.passLine - conflict.score),
        0,
      );
      const deferred = conflicts.some(
        (conflict) => conflict.score < conflict.passLine && conflict.score <= metric.score - MUCH_WEAKER_POINTS,
      );
      return { key: metric.key, score: metric.score, gain, risk, net: gain - risk, deferred };
    })
    .sort((a, b) => Number(a.deferred) - Number(b.deferred) || b.net - a.net);
}

export const LIVE_PASS_LINES: Record<CameraViewMode, Record<CoachingMetricKey, number>> = {
  'head-on': { depth: 55, hips: 74, elbowFlare: 68, handStack: 72, headAlignment: 70 },
  side: { depth: 58, hips: 74, elbowFlare: 70, handStack: 72, headAlignment: 0 },
};

function hipIssues(direction: HipDirection | null): CoachingIssue[] {
  if (direction === 'pike') return [{ key: 'hipPike', cue: LIVE_CUES.hipPike }];
  if (direction === 'sag') return [{ key: 'hipSag', cue: LIVE_CUES.hipSag }];
  return [
    { key: 'hipPike', cue: LIVE_CUES.hipPike },
    { key: 'hipSag', cue: LIVE_CUES.hipSag },
  ];
}

export function liveCoachingIssues(frame: PoseAnalysis, counting: boolean): CoachingIssue[] {
  const setupNeeded = counting
    ? frame.confidence < 0.32 || frame.framingScore < 20
    : frame.viewMode === 'head-on'
      ? frame.confidence < 0.72 || frame.framingScore < 64 || frame.handStackScore < 72
      : frame.confidence < 0.7 || frame.framingScore < 62 || frame.handStackScore < 72;
  if (setupNeeded) {
    return [{ key: 'setup', cue: frame.setupHint ?? 'Move back so hands and torso stay in frame.' }];
  }

  const pass = LIVE_PASS_LINES[frame.viewMode];
  const hipsNeedWork =
    frame.bodyLineScore < pass.hips ||
    (frame.viewMode === 'side' && ((frame.hipSagScore ?? 100) < 72 || (frame.hipPikeScore ?? 100) < 72));
  const metrics: TipMetric[] = [
    { key: 'depth', score: frame.elbowDepthScore, passLine: pass.depth },
    { key: 'hips', score: frame.bodyLineScore, passLine: pass.hips, needsWork: hipsNeedWork },
    { key: 'elbowFlare', score: frame.elbowFlareScore, passLine: pass.elbowFlare },
    { key: 'handStack', score: frame.handStackScore, passLine: pass.handStack },
  ];
  if (frame.viewMode === 'head-on') {
    metrics.push({ key: 'headAlignment', score: frame.headAlignmentScore, passLine: pass.headAlignment });
  }

  return rankCoachingTips(metrics, frame.viewMode).flatMap((tip): CoachingIssue[] =>
    tip.key === 'hips' ? hipIssues(hipDirection(frame.hipBias)) : [{ key: tip.key, cue: LIVE_CUES[tip.key] }],
  );
}

export const SPOKEN_CUES = {
  depth: 'Go a little deeper while keeping hips level',
  hipPike: 'Don’t pike, hips down',
  hipSag: 'Don’t sag, squeeze your belly',
};

const CUE_SHORTENINGS: Array<[RegExp, string]> = [
  [/^go a little deeper while keeping hips level.*$/i, SPOKEN_CUES.depth],
  [/^lower a little deeper.*$/i, SPOKEN_CUES.depth],
  [/^lower deeper.*$/i, SPOKEN_CUES.depth],
  [/^don['’]t pike.*$/i, SPOKEN_CUES.hipPike],
  [/^keep the hips level and avoid piking.*$/i, SPOKEN_CUES.hipPike],
  [/^don['’]t sag.*$/i, SPOKEN_CUES.hipSag],
  [/^keep the hips from sagging.*$/i, SPOKEN_CUES.hipSag],
  [/^tuck the elbows in.*$/i, 'Tuck elbows in'],
  [/^stack the hands.*$/i, 'Hands under shoulders'],
  [/^keep the head centered.*$/i, 'Keep head centered'],
  [/^back up or lower the phone.*$/i, 'Back up for hands and torso'],
  [/^move back or lower the phone.*$/i, 'Back up for hands and torso'],
  [/^clean head-on rep.*$/i, 'Good rep'],
  [/^clean side-view rep.*$/i, 'Good rep'],
  [/^audio cues are unlocked.*$/i, 'Audio unlocked'],
  [/^tap enable sound.*$/i, 'Tap Start camera and sound'],
];

export function shortenCue(message: string) {
  const normalized = message.trim();
  for (const [pattern, replacement] of CUE_SHORTENINGS) {
    if (pattern.test(normalized)) return replacement;
  }
  const words = normalized.split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : normalized;
}

import { REP_TOP_ANGLE } from './scoring';
import { REP_CUE_LINES } from './repFeedback';

/**
 * Real-time "Down" / "Up" cues driven by the live pose, not a metronome. "Down" fires on the first
 * frame at lockout (the start of each rep), "Up" on the first frame the elbows reach the target depth,
 * which is the same depth score a rep needs to avoid the "lower your chest" correction.
 *
 * Each cue arms the other, and the two thresholds are ~60° of elbow bend apart, so landmark jitter
 * around either one can't fire it twice: there's at most one Down and one Up per rep.
 */
export type TempoCue = 'up' | 'down';

export const TEMPO_TOP_ANGLE = REP_TOP_ANGLE;
export const TEMPO_DEPTH_SCORE = REP_CUE_LINES.depth;
/** A shallow rep (never reached depth) must still bend this far below lockout before the next Down. */
export const TEMPO_SHALLOW_BEND = 30;
/** No two cues closer than this; faster than any real half-rep. */
export const TEMPO_MIN_GAP_MS = 280;
/** Minimum wait after counting starts before the first Down. */
export const TEMPO_START_DELAY_MS = 600;
/** The first Down waits for "Go!" to finish speaking, but never longer than this after counting starts. */
export const TEMPO_FIRST_DOWN_MAX_WAIT_MS = 2500;

export interface TempoState {
  /** awaitTop: next cue is Down. descending: next cue is Up (or Down again after a shallow rep). */
  phase: 'awaitTop' | 'descending';
  /** Smallest elbow angle since the last Down. */
  minAngle: number;
  lastCue: TempoCue | null;
  lastCueAt: number;
  armedAt: number;
}

export function createTempoState(now: number, startDelayMs = TEMPO_START_DELAY_MS): TempoState {
  return { phase: 'awaitTop', minAngle: 180, lastCue: null, lastCueAt: -Infinity, armedAt: now + startDelayMs };
}

export interface TempoFrame {
  elbowAngle: number;
  /** 0–100 depth score for this frame (after any admin baseline). */
  depthScore: number;
  now: number;
  /** False once the set's last rep is coming back up: no rep follows, so no Down. */
  allowDown?: boolean;
  /** True while other speech (the countdown's "Go!") is still playing. */
  speechBusy?: boolean;
}

export function stepTempo(state: TempoState, frame: TempoFrame): { state: TempoState; cue: TempoCue | null } {
  const { elbowAngle, depthScore, now, allowDown = true, speechBusy = false } = frame;
  if (now < state.armedAt || now - state.lastCueAt < TEMPO_MIN_GAP_MS) {
    return { state: state.phase === 'descending' ? { ...state, minAngle: Math.min(state.minAngle, elbowAngle) } : state, cue: null };
  }
  const waitingForGo = state.lastCue === null && speechBusy && now < state.armedAt - TEMPO_START_DELAY_MS + TEMPO_FIRST_DOWN_MAX_WAIT_MS;
  const atTop = allowDown && !waitingForGo && elbowAngle >= TEMPO_TOP_ANGLE;
  const deep = depthScore >= TEMPO_DEPTH_SCORE;
  const down = (): { state: TempoState; cue: TempoCue } => ({
    state: { ...state, phase: 'descending', minAngle: elbowAngle, lastCue: 'down', lastCueAt: now },
    cue: 'down',
  });
  const up = (minAngle: number): { state: TempoState; cue: TempoCue } => ({
    state: { ...state, phase: 'awaitTop', minAngle, lastCue: 'up', lastCueAt: now },
    cue: 'up',
  });

  if (state.phase === 'awaitTop') {
    if (atTop) return down();
    // Started the first rep before the first Down could play: still say Up at depth.
    if (state.lastCue === null && deep) return up(elbowAngle);
    return { state, cue: null };
  }
  const minAngle = Math.min(state.minAngle, elbowAngle);
  if (deep) return up(minAngle);
  if (atTop && minAngle <= TEMPO_TOP_ANGLE - TEMPO_SHALLOW_BEND) {
    return down();
  }
  return { state: { ...state, minAngle }, cue: null };
}

export interface TempoLatency {
  cue: TempoCue;
  /** Pose result in hand → AudioBufferSourceNode.start(). */
  poseToStartMs: number;
  /** Pose inference for the triggering frame. */
  inferenceMs: number;
  /** Browser-reported audio output latency (baseLatency + outputLatency). */
  outputMs: number;
}

export const latencyTotalMs = (sample: TempoLatency) => sample.poseToStartMs + sample.outputMs;

export function summarizeLatency(samples: TempoLatency[]) {
  if (!samples.length) return null;
  const totals = samples.map(latencyTotalMs).sort((a, b) => a - b);
  const median = totals[Math.floor((totals.length - 1) / 2)];
  const inference = samples.map((sample) => sample.inferenceMs).sort((a, b) => a - b);
  return {
    count: samples.length,
    medianMs: Math.round(median),
    maxMs: Math.round(totals[totals.length - 1]),
    medianInferenceMs: Math.round(inference[Math.floor((inference.length - 1) / 2)]),
  };
}

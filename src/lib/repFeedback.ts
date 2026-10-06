import { hipDirection } from './coaching';
import lines from './feedbackLines.json';
import type { SessionRep } from './types';

/**
 * In-set feedback is corrective only: after each rep, one short cue for that rep's weakest form
 * component (or nothing when the rep was clean). Praise is saved for the end-of-set and end-of-session
 * wrap-ups. Every line here has a pre-recorded clip in public/voices (scripts/generate-voices.mjs).
 */
export type CorrectionKey = keyof typeof lines.corrective;

export const CORRECTIVE_LINES: Record<CorrectionKey, string[]> = lines.corrective;
export const NEUTRAL_LINE = lines.neutral;
export const SET_ONE_WRAP_UP = lines.set1Done;

/** A rep component under its line earns a cue. Depth 80 ≈ elbows bent past 100° at the bottom. */
export const REP_CUE_LINES = { depth: 80, hips: 75, elbowFlare: 75, handStack: 70, headAlignment: 65 };
/** Clean reps in a row before the single neutral "Keep that form." a set may get. */
const CLEAN_STREAK_FOR_NEUTRAL = 2;

export interface FeedbackMemory {
  lastText: string | null;
  turns: Partial<Record<CorrectionKey, number>>;
  cleanStreak: number;
  neutralUsed: boolean;
}

export function createFeedbackMemory(): FeedbackMemory {
  return { lastText: null, turns: {}, cleanStreak: 0, neutralUsed: false };
}

/** Rotates through the phrasings for a cue and never returns the line that was just used. */
export function correctionPhrase(memory: FeedbackMemory, key: CorrectionKey): { text: string; memory: FeedbackMemory } {
  const pool = CORRECTIVE_LINES[key];
  let turn = memory.turns[key] ?? 0;
  let text = pool[turn % pool.length];
  if (text === memory.lastText && pool.length > 1) {
    turn += 1;
    text = pool[turn % pool.length];
  }
  return { text, memory: { ...memory, lastText: text, turns: { ...memory.turns, [key]: turn + 1 } } };
}

export type RepScores = Pick<
  SessionRep,
  'viewMode' | 'elbowDepthScore' | 'bodyLineScore' | 'elbowFlareScore' | 'handStackScore' | 'headAlignmentScore' | 'hipBias'
>;

/** The component furthest under its cue line, or null when every component is good. */
export function weakestCorrection(rep: RepScores): CorrectionKey | null {
  const shortfalls: Array<[CorrectionKey, number]> = [];
  const check = (key: CorrectionKey, score: number | null, line: number) => {
    if (score !== null && score < line) shortfalls.push([key, line - score]);
  };
  check('depth', rep.elbowDepthScore, REP_CUE_LINES.depth);
  if (rep.bodyLineScore !== null) {
    const direction = hipDirection(rep.hipBias);
    check(direction === 'sag' ? 'hipSag' : direction === 'pike' ? 'hipPike' : 'bodyLine', rep.bodyLineScore, REP_CUE_LINES.hips);
  }
  check('elbowFlare', rep.elbowFlareScore, REP_CUE_LINES.elbowFlare);
  check('handStack', rep.handStackScore, REP_CUE_LINES.handStack);
  if (rep.viewMode === 'head-on') check('headAlignment', rep.headAlignmentScore, REP_CUE_LINES.headAlignment);
  shortfalls.sort((a, b) => b[1] - a[1]);
  return shortfalls[0]?.[0] ?? null;
}

export function repFeedback(memory: FeedbackMemory, rep: RepScores): { text: string | null; key: CorrectionKey | 'neutral' | null; memory: FeedbackMemory } {
  const key = weakestCorrection(rep);
  if (key) {
    const phrase = correctionPhrase({ ...memory, cleanStreak: 0 }, key);
    return { text: phrase.text, key, memory: phrase.memory };
  }
  const cleanStreak = memory.cleanStreak + 1;
  if (cleanStreak >= CLEAN_STREAK_FOR_NEUTRAL && !memory.neutralUsed && memory.lastText !== NEUTRAL_LINE) {
    return { text: NEUTRAL_LINE, key: 'neutral', memory: { ...memory, cleanStreak, neutralUsed: true, lastText: NEUTRAL_LINE } };
  }
  return { text: null, key: null, memory: { ...memory, cleanStreak } };
}

/** Positive end-of-session line with the set 1 → set 2 change (whole points). */
export function sessionWrapUp(delta: number) {
  const points = Math.round(delta);
  if (points > 0) return lines.sessionImproved.replace('{n}', String(points)).replace('{points}', points === 1 ? 'point' : 'points');
  if (points === 0) return lines.sessionSteady;
  return lines.sessionDeclined;
}

/** Every line the coach can speak from this module, for clip generation and tests. */
export function allFeedbackLines() {
  return [
    ...Object.values(CORRECTIVE_LINES).flat(),
    NEUTRAL_LINE,
    SET_ONE_WRAP_UP,
    ...Array.from({ length: lines.maxImprovementClip }, (_, index) => sessionWrapUp(index + 1)),
    sessionWrapUp(0),
    sessionWrapUp(-1),
  ];
}

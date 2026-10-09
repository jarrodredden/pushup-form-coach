import { describe, expect, it } from 'vitest';
import {
  createFormColorState,
  depthPulseActive,
  DEPTH_PULSE_MS,
  FORM_GOOD_LINES,
  FORM_HYSTERESIS,
  FORM_SWITCH_FRAMES,
  formColorsActive,
  jointComponent,
  SKELETON_SEGMENTS,
  stepFormColors,
  type FormScores,
} from './formColors';
import { REP_CUE_LINES } from './repFeedback';

const scores = (overrides: Partial<FormScores>): FormScores => ({ elbowTuck: 0, plank: 0, hands: 0, head: 0, depth: 0, ...overrides });

function run(frames: FormScores[]) {
  let state = createFormColorState();
  return frames.map((frame, index) => {
    state = stepFormColors(state, frame, index * 33);
    return state;
  });
}

describe('live form colours', () => {
  it('uses the same lines as the corrective coaching', () => {
    expect(FORM_GOOD_LINES).toEqual({
      elbowTuck: REP_CUE_LINES.elbowFlare,
      plank: REP_CUE_LINES.hips,
      hands: REP_CUE_LINES.handStack,
      head: REP_CUE_LINES.headAlignment,
      depth: REP_CUE_LINES.depth,
    });
  });

  it('turns a component good after a few frames at or above its line', () => {
    const states = run(Array(FORM_SWITCH_FRAMES).fill(scores({ elbowTuck: FORM_GOOD_LINES.elbowTuck })));
    expect(states[FORM_SWITCH_FRAMES - 2].good.elbowTuck).toBe(false);
    expect(states[FORM_SWITCH_FRAMES - 1].good.elbowTuck).toBe(true);
    expect(states.at(-1)!.good.plank).toBe(false);
  });

  it('does not flicker when the score jitters around the line', () => {
    const line = FORM_GOOD_LINES.plank;
    const jitter = Array.from({ length: 40 }, (_, i) => scores({ plank: line + (i % 2 ? -3 : 2) }));
    const states = run([...Array(FORM_SWITCH_FRAMES).fill(scores({ plank: line + 5 })), ...jitter]);
    expect(states.slice(FORM_SWITCH_FRAMES - 1).every((s) => s.good.plank)).toBe(true);
  });

  it('a single bad or good frame never flips the colour', () => {
    const line = FORM_GOOD_LINES.hands;
    const states = run([
      ...Array(FORM_SWITCH_FRAMES).fill(scores({ hands: 100 })),
      scores({ hands: 0 }),
      ...Array(5).fill(scores({ hands: 100 })),
    ]);
    expect(states.every((s, i) => i < FORM_SWITCH_FRAMES - 1 || s.good.hands)).toBe(true);
    const back = run([scores({ hands: line }), scores({ hands: 0 }), scores({ hands: line }), scores({ hands: 0 })]);
    expect(back.some((s) => s.good.hands)).toBe(false);
  });

  it('drops back once the score is clearly under the line', () => {
    const line = FORM_GOOD_LINES.elbowTuck;
    const states = run([...Array(FORM_SWITCH_FRAMES).fill(scores({ elbowTuck: 100 })), ...Array(FORM_SWITCH_FRAMES).fill(scores({ elbowTuck: line - FORM_HYSTERESIS - 1 }))]);
    expect(states.at(-1)!.good.elbowTuck).toBe(false);
  });

  it('n/a components stay default immediately', () => {
    const states = run([...Array(FORM_SWITCH_FRAMES).fill(scores({ plank: 100, head: 100 })), scores({ plank: null, head: null })]);
    expect(states.at(-2)!.good.plank).toBe(true);
    expect(states.at(-1)!.good.plank).toBe(false);
    expect(states.at(-1)!.good.head).toBe(false);
  });

  it('pulses for a moment when target depth is reached', () => {
    let state = createFormColorState();
    state = stepFormColors(state, scores({ depth: FORM_GOOD_LINES.depth }), 1000);
    expect(depthPulseActive(state, 1000)).toBe(true);
    state = stepFormColors(state, scores({ depth: 10 }), 1100);
    expect(depthPulseActive(state, 1100)).toBe(true);
    expect(depthPulseActive(state, 1000 + DEPTH_PULSE_MS)).toBe(false);
  });

  it('only colours set 2 with visuals, or free practice for an admin', () => {
    const base = { workflowMode: 'coaching' as const, adminUnlocked: false };
    expect(formColorsActive({ ...base, feedbackMode: 'combined', trialState: 'attempt-2' })).toBe(true);
    expect(formColorsActive({ ...base, feedbackMode: 'visual', trialState: 'attempt-2' })).toBe(true);
    expect(formColorsActive({ ...base, feedbackMode: 'audio', trialState: 'attempt-2' })).toBe(false);
    expect(formColorsActive({ ...base, feedbackMode: 'control', trialState: 'attempt-2' })).toBe(false);
    expect(formColorsActive({ ...base, feedbackMode: 'combined', trialState: 'attempt-1' })).toBe(false);
    expect(formColorsActive({ ...base, feedbackMode: 'combined', trialState: 'between-attempts' })).toBe(false);
    expect(formColorsActive({ workflowMode: 'free', feedbackMode: 'combined', trialState: 'idle', adminUnlocked: false })).toBe(false);
    expect(formColorsActive({ workflowMode: 'free', feedbackMode: 'combined', trialState: 'idle', adminUnlocked: true })).toBe(true);
  });

  it('maps body parts to the component that judges them', () => {
    const owner = (a: number, b: number) => SKELETON_SEGMENTS.find((s) => s.from === a && s.to === b)?.component;
    expect(owner(11, 13)).toBe('elbowTuck');
    expect(owner(13, 15)).toBe('elbowTuck');
    expect(owner(11, 12)).toBe('hands');
    expect(owner(11, 23)).toBe('plank');
    expect(owner(25, 27)).toBe('plank');
    expect(jointComponent(0)).toBe('head');
    expect(jointComponent(13)).toBe('elbowTuck');
    expect(jointComponent(15)).toBe('hands');
    expect(jointComponent(19)).toBe('hands');
    expect(jointComponent(11)).toBe('hands');
    expect(jointComponent(27)).toBe('plank');
  });
});

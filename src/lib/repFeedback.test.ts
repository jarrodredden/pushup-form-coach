import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allFeedbackLines,
  correctionPhrase,
  CORRECTIVE_LINES,
  createFeedbackMemory,
  NEUTRAL_LINE,
  repFeedback,
  sessionWrapUp,
  weakestCorrection,
  type RepScores,
} from './repFeedback';
import { resolveVoiceClipNames } from './voiceAudio';

const goodRep: RepScores = {
  viewMode: 'head-on',
  elbowDepthScore: 95,
  bodyLineScore: 95,
  elbowFlareScore: 100,
  handStackScore: 95,
  headAlignmentScore: 95,
  hipBias: 0,
};

const PRAISE = /\b(nice|great|awesome|strong|solid|good job|golden|flying|yes)\b/i;

describe('in-set rep feedback', () => {
  it('cues the weakest component of the rep', () => {
    expect(weakestCorrection({ ...goodRep, elbowDepthScore: 70 })).toBe('depth');
    expect(weakestCorrection({ ...goodRep, elbowDepthScore: 75, elbowFlareScore: 40 })).toBe('elbowFlare');
    expect(weakestCorrection({ ...goodRep, bodyLineScore: 50, hipBias: 50 })).toBe('hipSag');
    expect(weakestCorrection({ ...goodRep, bodyLineScore: 50, hipBias: -50 })).toBe('hipPike');
    expect(weakestCorrection({ ...goodRep, bodyLineScore: null })).toBeNull();
    expect(weakestCorrection(goodRep)).toBeNull();
  });

  it('never praises mid-set: clean reps are quiet, with at most one neutral line per set', () => {
    let memory = createFeedbackMemory();
    const spoken: Array<string | null> = [];
    for (let rep = 0; rep < 5; rep += 1) {
      const result = repFeedback(memory, goodRep);
      memory = result.memory;
      spoken.push(result.text);
    }
    expect(spoken.filter((text) => text === NEUTRAL_LINE)).toHaveLength(1);
    expect(spoken[0]).toBeNull();
    expect(spoken.filter((text) => text && text !== NEUTRAL_LINE)).toHaveLength(0);
    for (const line of [...Object.values(CORRECTIVE_LINES).flat(), NEUTRAL_LINE]) expect(line).not.toMatch(PRAISE);
  });

  it('rotates phrasing and never repeats the same line back to back', () => {
    let memory = createFeedbackMemory();
    const lines: string[] = [];
    for (let rep = 0; rep < 6; rep += 1) {
      const result = repFeedback(memory, { ...goodRep, elbowFlareScore: 40 });
      memory = result.memory;
      lines.push(result.text!);
    }
    for (let index = 1; index < lines.length; index += 1) expect(lines[index]).not.toBe(lines[index - 1]);
    expect(new Set(lines).size).toBe(CORRECTIVE_LINES.elbowFlare.length);
  });

  it('does not repeat a line just used by a live cue', () => {
    const afterLive = correctionPhrase(createFeedbackMemory(), 'hipSag').memory;
    const shared = repFeedback({ ...afterLive, turns: {} }, { ...goodRep, bodyLineScore: 50, hipBias: 50 });
    expect(shared.text).not.toBe(afterLive.lastText);
  });
});

describe('end-of-session wrap-up', () => {
  it('praises and reports the set 1 → set 2 change', () => {
    expect(sessionWrapUp(12)).toBe('Great work! You improved by 12 points from set 1 to set 2.');
    expect(sessionWrapUp(1)).toBe('Great work! You improved by 1 point from set 1 to set 2.');
    expect(sessionWrapUp(0)).toMatch(/held steady/);
    expect(sessionWrapUp(-4)).toMatch(/^Great work finishing both sets/);
  });
});

describe('voice clips', () => {
  it('has a recorded MP3 for every corrective, neutral, and wrap-up line', () => {
    const voicesDir = path.resolve('public/voices');
    for (const line of allFeedbackLines()) {
      for (const clip of resolveVoiceClipNames(line) ?? []) {
        expect(existsSync(path.join(voicesDir, `${clip}.mp3`)), `${line} -> ${clip}.mp3`).toBe(true);
      }
    }
  });
});

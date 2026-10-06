import { describe, expect, it } from 'vitest';
import {
  createTempoState,
  stepTempo,
  summarizeLatency,
  TEMPO_FIRST_DOWN_MAX_WAIT_MS,
  TEMPO_MIN_GAP_MS,
  TEMPO_START_DELAY_MS,
  type TempoCue,
} from './tempoCues';

/** Same mapping as analyzePose: 100 at 85°, 0 at 160°. */
const depthScoreForAngle = (angle: number) => Math.min(100, Math.max(0, ((160 - angle) / 75) * 100));

/** Feeds elbow angles at 30 fps and returns the cues with the frame index they fired on. */
function run(angles: number[], startAt = TEMPO_START_DELAY_MS) {
  let state = createTempoState(0);
  const cues: Array<{ cue: TempoCue; frame: number }> = [];
  angles.forEach((elbowAngle, frame) => {
    const step = stepTempo(state, { elbowAngle, depthScore: depthScoreForAngle(elbowAngle), now: startAt + frame * 33 });
    state = step.state;
    if (step.cue) cues.push({ cue: step.cue, frame });
  });
  return cues;
}

const ramp = (from: number, to: number, frames: number) => Array.from({ length: frames }, (_, i) => from + ((to - from) * i) / (frames - 1));
const rep = () => [...ramp(170, 85, 15), ...ramp(85, 170, 15)];

describe('tempo cues', () => {
  it('says Down at lockout and Up the frame the elbows reach depth, once each per rep', () => {
    const cues = run([170, 170, ...rep(), ...rep(), 170]);
    expect(cues.map((c) => c.cue)).toEqual(['down', 'up', 'down', 'up', 'down']);
    // Up fires on the first frame at depth score 80 (elbow ≤ 100°), not after the bottom.
    const angles = [170, 170, ...rep()];
    const firstDeep = angles.findIndex((angle) => depthScoreForAngle(angle) >= 80);
    expect(cues[1].frame).toBe(firstDeep);
  });

  it('ignores jitter around either threshold', () => {
    const jitterTop = [159, 157, 159, 157, 160, 156, 159];
    const jitterBottom = [101, 99, 101, 98, 102, 99, 101, 99];
    const cues = run([...jitterTop, ...ramp(156, 101, 10), ...jitterBottom, ...ramp(101, 170, 10), ...jitterTop]);
    expect(cues.map((c) => c.cue)).toEqual(['down', 'up', 'down']);
  });

  it('waits for "Go!" before the first Down', () => {
    const cues = run(Array(40).fill(170), 0);
    expect(cues).toHaveLength(1);
    expect(cues[0].frame * 33).toBeGreaterThanOrEqual(TEMPO_START_DELAY_MS);
  });

  it('holds the first Down while "Go!" is still speaking, up to a cap', () => {
    const firstDown = (busyUntil: number) => {
      let state = createTempoState(0);
      for (let now = 0; now < 4000; now += 33) {
        const step = stepTempo(state, { elbowAngle: 170, depthScore: 0, now, speechBusy: now < busyUntil });
        state = step.state;
        if (step.cue) return now;
      }
      return null;
    };
    expect(firstDown(1200)).toBeGreaterThanOrEqual(1200);
    expect(firstDown(1200)).toBeLessThan(1240);
    expect(firstDown(10_000)).toBeGreaterThanOrEqual(TEMPO_FIRST_DOWN_MAX_WAIT_MS);
    expect(firstDown(10_000)).toBeLessThan(TEMPO_FIRST_DOWN_MAX_WAIT_MS + 40);
  });

  it('still says Up if the first rep starts before the first Down could play', () => {
    let state = createTempoState(0, 0);
    const cues: TempoCue[] = [];
    [170, ...rep(), 170].forEach((elbowAngle, frame) => {
      const step = stepTempo(state, { elbowAngle, depthScore: depthScoreForAngle(elbowAngle), now: frame * 33, speechBusy: frame < 10 });
      state = step.state;
      if (step.cue) cues.push(step.cue);
    });
    expect(cues).toEqual(['up', 'down']);
  });

  it('a shallow rep gets no Up, but the next rep still gets its Down', () => {
    const shallow = [...ramp(170, 120, 12), ...ramp(120, 170, 12)];
    const cues = run([170, ...shallow, ...rep()]);
    expect(cues.map((c) => c.cue)).toEqual(['down', 'down', 'up', 'down']);
  });

  it('a wobble that never really bends does not re-trigger Down', () => {
    const cues = run([170, ...ramp(170, 140, 6), ...ramp(140, 170, 6), 170]);
    expect(cues.map((c) => c.cue)).toEqual(['down']);
  });

  it('stays quiet at the final lockout of a set', () => {
    let state = createTempoState(0, 0);
    const cues: TempoCue[] = [];
    [170, ...rep()].forEach((elbowAngle, frame) => {
      const step = stepTempo(state, { elbowAngle, depthScore: depthScoreForAngle(elbowAngle), now: frame * 33, allowDown: frame === 0 });
      state = step.state;
      if (step.cue) cues.push(step.cue);
    });
    expect(cues).toEqual(['down', 'up']);
  });

  it('never fires two cues closer than the minimum gap', () => {
    let state = createTempoState(0, 0);
    const first = stepTempo(state, { elbowAngle: 170, depthScore: 0, now: 1000 });
    state = first.state;
    expect(first.cue).toBe('down');
    expect(stepTempo(state, { elbowAngle: 80, depthScore: 100, now: 1000 + TEMPO_MIN_GAP_MS - 1 }).cue).toBeNull();
    expect(stepTempo(state, { elbowAngle: 80, depthScore: 100, now: 1000 + TEMPO_MIN_GAP_MS }).cue).toBe('up');
  });

  it('summarizes latency as pose→start plus output', () => {
    const summary = summarizeLatency([
      { cue: 'down', poseToStartMs: 1, inferenceMs: 20, outputMs: 10 },
      { cue: 'up', poseToStartMs: 3, inferenceMs: 30, outputMs: 10 },
      { cue: 'down', poseToStartMs: 2, inferenceMs: 25, outputMs: 10 },
    ]);
    expect(summary).toEqual({ count: 3, medianMs: 12, maxMs: 13, medianInferenceMs: 25 });
  });
});

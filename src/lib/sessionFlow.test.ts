import { describe, expect, it } from 'vitest';
import { activeStepKey, attemptForTrialState, coachingFocusLines, deriveJourneyPhase, REPS_PER_SET, summarizeReps, trialStateAfterRep } from './sessionFlow';

const base = {
  cameraStatus: 'live' as const,
  calibrationState: 'counting' as const,
  workflowMode: 'coaching' as const,
  trialState: 'attempt-1' as const,
  hasResults: false,
};

describe('coaching session flow', () => {
  it('moves to the coaching break after exactly five reps in set 1', () => {
    let state = 'attempt-1' as ReturnType<typeof trialStateAfterRep>;
    for (let count = 1; count < REPS_PER_SET; count += 1) {
      state = trialStateAfterRep(state, count);
      expect(state).toBe('attempt-1');
    }
    expect(trialStateAfterRep(state, REPS_PER_SET)).toBe('between-attempts');
  });

  it('completes the session after five reps in set 2', () => {
    expect(trialStateAfterRep('attempt-2', 4)).toBe('attempt-2');
    expect(trialStateAfterRep('attempt-2', 5)).toBe('complete');
  });

  it('tags reps with the active attempt', () => {
    expect(attemptForTrialState('attempt-1')).toBe(1);
    expect(attemptForTrialState('attempt-2')).toBe(2);
    expect(attemptForTrialState('idle')).toBe(0);
  });

  it('derives the journey phase for each step', () => {
    expect(deriveJourneyPhase({ ...base, cameraStatus: 'idle', calibrationState: 'idle', trialState: 'idle' })).toBe('setup');
    expect(deriveJourneyPhase({ ...base, calibrationState: 'checking' })).toBe('calibrating');
    expect(deriveJourneyPhase({ ...base, calibrationState: 'countdown' })).toBe('countdown');
    expect(deriveJourneyPhase(base)).toBe('set');
    expect(deriveJourneyPhase({ ...base, trialState: 'between-attempts' })).toBe('break');
    expect(deriveJourneyPhase({ ...base, trialState: 'complete' })).toBe('results');
    expect(deriveJourneyPhase({ ...base, workflowMode: 'free', trialState: 'idle', cameraStatus: 'idle', hasResults: true })).toBe('results');
  });

  it('summarizes a set and puts the biggest form gap first', () => {
    const summary = summarizeReps([
      { score: 60, elbowDepthScore: 40, bodyLineScore: 70, elbowFlareScore: 90 },
      { score: 70, elbowDepthScore: 50, bodyLineScore: 72, elbowFlareScore: 90 },
    ]);
    expect(summary).toMatchObject({ count: 2, average: 65, best: 70, depth: 45 });
    const lines = coachingFocusLines(summary);
    expect(lines[0]).toMatch(/lower/i);
    expect(lines).toHaveLength(2);
  });

  it('highlights the right step in the progress indicator', () => {
    expect(activeStepKey('set', 'coaching', 'attempt-1')).toBe('set-1');
    expect(activeStepKey('countdown', 'coaching', 'attempt-2')).toBe('set-2');
    expect(activeStepKey('break', 'coaching', 'between-attempts')).toBe('break');
    expect(activeStepKey('set', 'free', 'idle')).toBe('set');
  });
});

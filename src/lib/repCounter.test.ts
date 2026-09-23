import { describe, expect, it } from 'vitest';
import { buildCsv } from './export';
import { createRepCounter } from './repCounter';
import { SessionRep, SessionSummary } from './types';

describe('rep counter', () => {
  it('increments completed reps in order', () => {
    const counter = createRepCounter();
    expect(counter.next()).toBe(1);
    expect(counter.next()).toBe(2);
    expect(counter.next()).toBe(3);
  });

  it('keeps rep indices sequential in csv output', () => {
    const counter = createRepCounter();
    const reps: SessionRep[] = [1, 2, 3].map((indexSeed) => ({
      index: counter.next(),
      viewMode: 'head-on',
      score: 80 + indexSeed,
      notes: [`Rep ${indexSeed}`],
      elbowDepthScore: 80,
      bodyLineScore: 82,
      elbowFlareScore: 78,
      handStackScore: 79,
      headAlignmentScore: 77,
      framingScore: 76,
      hipSagScore: null,
      hipPikeScore: null,
      confidence: 0.95,
      timestamp: Date.now(),
    }));

    const summary: SessionSummary = {
      id: 'session-1',
      name: 'Jarrod',
      dateIso: '2026-09-23T02:51:00.000Z',
      reps: 3,
      averageScore: 83,
      bestScore: 84,
      beforeScore: 70,
      afterScore: 83,
      notes: ['Rep 1', 'Rep 2', 'Rep 3'],
    };

    const csv = buildCsv(summary, reps, []);
    expect(csv).toContain('rep_index,view_mode,score');
    expect(csv).toContain('\n1,head-on');
    expect(csv).toContain('\n2,head-on');
    expect(csv).toContain('\n3,head-on');
  });
});

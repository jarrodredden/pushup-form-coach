import { describe, expect, it } from 'vitest';
import { buildNotesExport } from './export';
import { SessionRep } from './types';

describe('notes export', () => {
  it('renders a docs-friendly session summary', () => {
    const reps: SessionRep[] = [
      {
        index: 1,
        viewMode: 'head-on',
        score: 76,
        notes: ['Go a little deeper.', 'Tuck the elbows in.'],
        elbowDepthScore: 68,
        bodyLineScore: 72,
        elbowFlareScore: 71,
        handStackScore: 80,
        headAlignmentScore: 78,
        framingScore: 74,
        hipSagScore: null,
        hipPikeScore: null,
        confidence: 0.94,
        timestamp: Date.now(),
      },
    ];

    const notes = buildNotesExport(
      {
        name: 'Jarrod',
        dateIso: '2026-09-23T02:18:00.000Z',
        mode: 'combined',
        cameraView: 'head-on',
        spokenCoachingEnabled: false,
        reps: 4,
        averageScore: 78,
        bestScore: 86,
        beforeScore: 70,
        afterScore: 78,
        notes: ['Go a little deeper.', 'Tuck the elbows in.'],
      },
      reps,
    );

    expect(notes).toContain('# Push-up session notes');
    expect(notes).toContain('Athlete: Jarrod');
    expect(notes).toContain('Mode: combined');
    expect(notes).toContain('View: head-on');
    expect(notes).toContain('Top coaching themes:');
    expect(notes).toContain('Depth');
    expect(notes).not.toMatch(/feet/i);
    expect(notes).not.toContain('rep_index');
  });
});

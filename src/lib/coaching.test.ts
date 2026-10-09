import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOCUS_LINES, hipDirection, LIVE_CUES, liveCoachingIssues, rankCoachingTips, SCORE_WEIGHTS, shortenCue, SPOKEN_CUES } from './coaching';
import type { PoseAnalysis } from './types';
import { resolveVoiceClipNames } from './voiceAudio';

function liveFrame(overrides: Partial<PoseAnalysis> = {}): PoseAnalysis {
  return {
    viewMode: 'head-on',
    overallScore: 80,
    elbowAngle: 95,
    elbowDepthScore: 90,
    bodyLineScore: 90,
    plankRaw: 0,
    plankMethod: 'front-hips',
    plankDetail: null,
    elbowFlareScore: 90,
    elbowAbduction: 40,
    handStackScore: 90,
    headAlignmentScore: 90,
    framingScore: 90,
    hipSagScore: null,
    hipPikeScore: null,
    hipBias: 0,
    confidence: 0.95,
    phase: 'bottom',
    setupHint: null,
    notes: [],
    ...overrides,
  };
}

describe('tip ranking by expected net score gain', () => {
  it('puts depth first when it is the biggest weighted gain and the plank is fine', () => {
    const ranked = rankCoachingTips(
      [
        { key: 'depth', score: 45, passLine: 70 },
        { key: 'hips', score: 71, passLine: 75 },
        { key: 'elbowFlare', score: 90, passLine: 72 },
      ],
      'head-on',
    );
    expect(ranked.map((tip) => tip.key)).toEqual(['depth', 'hips']);
    expect(ranked[0].deferred).toBe(false);
  });

  it('does not push depth first when going deeper would tank a weak body line', () => {
    const ranked = rankCoachingTips(
      [
        { key: 'depth', score: 50, passLine: 70 },
        { key: 'hips', score: 40, passLine: 75 },
        { key: 'elbowFlare', score: 90, passLine: 72 },
      ],
      'head-on',
    );
    expect(ranked[0].key).toBe('hips');
    expect(ranked[1].key).toBe('depth');
    expect(ranked[1].risk).toBeGreaterThan(0);
  });

  it('defers depth behind a much weaker conflicting metric even if raw depth gain is larger', () => {
    const ranked = rankCoachingTips(
      [
        { key: 'depth', score: 30, passLine: 70 },
        { key: 'hips', score: 90, passLine: 75 },
        { key: 'elbowFlare', score: 10, passLine: 72 },
      ],
      'head-on',
    );
    const depth = ranked.find((tip) => tip.key === 'depth');
    expect(depth?.deferred).toBe(true);
    expect(ranked.map((tip) => tip.key)).toEqual(['elbowFlare', 'depth']);
  });

  it('weights tips by the view’s score formula', () => {
    const metrics = [
      { key: 'handStack' as const, score: 40, passLine: 72 },
      { key: 'headAlignment' as const, score: 20, passLine: 70 },
    ];
    for (const view of ['head-on', 'side'] as const) {
      for (const tip of rankCoachingTips(metrics, view)) {
        const metric = metrics.find((item) => item.key === tip.key)!;
        expect(tip.net).toBeCloseTo(SCORE_WEIGHTS[view][tip.key] * (100 - metric.score) * 0.5);
      }
    }
    // Hands and head count about the same from the front, so the bigger gap leads.
    expect(rankCoachingTips(metrics, 'head-on')[0].key).toBe('headAlignment');
    expect(rankCoachingTips([metrics[0], { ...metrics[1], score: 60 }], 'head-on')[0].key).toBe('handStack');
  });
});

describe('live coaching cues', () => {
  it('phrases depth as a little deeper while keeping hips level', () => {
    const issues = liveCoachingIssues(liveFrame({ elbowDepthScore: 40 }), true);
    expect(issues[0]).toEqual({ key: 'depth', cue: LIVE_CUES.depth });
    expect(issues[0].cue).toMatch(/a little deeper while keeping hips level/i);
  });

  it('tells a piking athlete not to pike and a sagging athlete not to sag (head-on)', () => {
    const piking = liveCoachingIssues(liveFrame({ bodyLineScore: 50, hipBias: -50 }), true);
    expect(piking.map((issue) => issue.key)).toEqual(['hipPike']);
    expect(piking[0].cue).toMatch(/don.t pike/i);

    const sagging = liveCoachingIssues(liveFrame({ bodyLineScore: 50, hipBias: 50 }), true);
    expect(sagging.map((issue) => issue.key)).toEqual(['hipSag']);
    expect(sagging[0].cue).toMatch(/don.t sag/i);
    expect(sagging[0].cue).not.toMatch(/lower/i);
  });

  it('uses the side-view sag and pike scores for direction', () => {
    const frame = liveFrame({ viewMode: 'side', hipSagScore: 100, hipPikeScore: 60, bodyLineScore: 80, hipBias: -40 });
    expect(liveCoachingIssues(frame, true).map((issue) => issue.key)).toEqual(['hipPike']);
  });

  it('gives two distinct hip tips when the direction is unknown', () => {
    const keys = liveCoachingIssues(liveFrame({ bodyLineScore: 50, hipBias: 0 }), true).map((issue) => issue.key);
    expect(keys).toEqual(['hipPike', 'hipSag']);
  });

  it('never uses the old vague hips-lower wording', () => {
    const allCues = [...Object.values(LIVE_CUES), ...Object.values(FOCUS_LINES)].join(' ');
    expect(allCues).not.toMatch(/keep the hips lower/i);
  });

  it('classifies hip bias into pike or sag', () => {
    expect(hipDirection(-10)).toBe('pike');
    expect(hipDirection(10)).toBe('sag');
    expect(hipDirection(1)).toBeNull();
    expect(hipDirection(undefined)).toBeNull();
  });
});

describe('spoken cue clips', () => {
  it('shortens every live cue to a phrase with a recorded MP3', () => {
    const voicesDir = path.resolve('public/voices');
    for (const cue of Object.values(LIVE_CUES)) {
      const clips = resolveVoiceClipNames(shortenCue(cue)) ?? [];
      expect(clips.length).toBeGreaterThan(0);
      for (const clip of clips) {
        expect(existsSync(path.join(voicesDir, `${clip}.mp3`)), `${cue} -> ${clip}.mp3`).toBe(true);
      }
    }
  });

  it('maps legacy note wording to the new pike / sag / depth phrases', () => {
    expect(shortenCue('Keep the hips from sagging.')).toBe(SPOKEN_CUES.hipSag);
    expect(shortenCue('Keep the hips level and avoid piking.')).toBe(SPOKEN_CUES.hipPike);
    expect(shortenCue('Lower a little deeper at the bottom of the rep.')).toBe(SPOKEN_CUES.depth);
  });
});

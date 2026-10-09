import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MIN,
  coverLayout,
  createWatchdog,
  describeStage,
  isIOSDevice,
  pickFrameSize,
  prefersPortraitCamera,
  stageCoverage,
  stepWatchdog,
  toStagePoint,
  WATCHDOG_REATTACH_MS,
  WATCHDOG_RELAYOUT_MS,
} from './stageLayout';

describe('camera stage cover layout', () => {
  it('fills a portrait phone stage with a landscape stream, cropping the sides evenly', () => {
    const layout = coverLayout(390, 640, 1280, 720)!;
    expect(layout.height).toBeCloseTo(640);
    expect(layout.width).toBeCloseTo(1137.8, 1);
    expect(layout.offsetX).toBeCloseTo(-373.9, 1);
    expect(layout.offsetY).toBe(0);
    expect(toStagePoint({ x: 0.5, y: 0.5 }, layout, false)).toEqual({ x: 195, y: 320 });
  });

  it('fills a portrait stage with a portrait stream (iPhone) and a landscape stage with either', () => {
    const portrait = coverLayout(390, 640, 720, 1280)!;
    expect(portrait.width).toBeCloseTo(390);
    expect(portrait.height).toBeCloseTo(693.3, 1);
    expect(portrait.offsetY).toBeCloseTo(-26.7, 1);
    for (const [vw, vh] of [[1280, 720], [720, 1280], [640, 480]]) {
      const layout = coverLayout(1000, 560, vw, vh)!;
      expect(layout.width).toBeGreaterThanOrEqual(1000 - 1e-6);
      expect(layout.height).toBeGreaterThanOrEqual(560 - 1e-6);
    }
  });

  it('maps landmarks onto the displayed video pixels, mirrored like the preview', () => {
    const layout = coverLayout(390, 640, 720, 1280)!;
    const left = toStagePoint({ x: 0.1, y: 0.2 }, layout, false);
    const mirrored = toStagePoint({ x: 0.1, y: 0.2 }, layout, true);
    expect(left.x).toBeCloseTo(39);
    expect(mirrored.x).toBeCloseTo(351);
    expect(mirrored.y).toBeCloseTo(layout.offsetY + 0.2 * layout.height);
  });

  it('waits for real sizes before laying out', () => {
    expect(coverLayout(390, 640, 0, 0)).toBeNull();
    expect(coverLayout(0, 640, 1280, 720)).toBeNull();
  });
});

describe('stream size and watchdog', () => {
  it('uses videoWidth/videoHeight when they agree with the decoded frames', () => {
    expect(pickFrameSize({ element: { width: 720, height: 1280 }, frame: { width: 720, height: 1280 } })).toEqual({ width: 720, height: 1280, source: 'element' });
    expect(pickFrameSize({ element: { width: 1280, height: 720 } })).toEqual({ width: 1280, height: 720, source: 'element' });
  });

  it('trusts the rendered frame when iOS reports a stale landscape size for portrait frames', () => {
    expect(pickFrameSize({ element: { width: 1280, height: 720 }, bitmap: { width: 720, height: 1280 } })).toEqual({ width: 720, height: 1280, source: 'bitmap' });
    expect(pickFrameSize({ element: { width: 1280, height: 720 }, frame: { width: 720, height: 1280 }, bitmap: { width: 720, height: 1280 } })?.source).toBe('bitmap');
  });

  it('never overrides on frame-callback metadata alone (it can be the unrotated sensor buffer)', () => {
    expect(pickFrameSize({ element: { width: 720, height: 1280 }, frame: { width: 1280, height: 720 } })?.source).toBe('element');
  });

  it('keeps videoWidth/videoHeight when the decoded sources disagree with each other', () => {
    expect(pickFrameSize({ element: { width: 1280, height: 720 }, frame: { width: 1280, height: 720 }, bitmap: { width: 720, height: 1280 } })?.source).toBe('element');
  });

  it('falls back when the element reports 0×0', () => {
    expect(pickFrameSize({ element: { width: 0, height: 0 }, frame: { width: 720, height: 1280 } })?.source).toBe('frame');
    expect(pickFrameSize({ element: { width: 0, height: 0 }, settings: { width: 1280, height: 720 } })?.source).toBe('settings');
    expect(pickFrameSize({ element: { width: 0, height: 0 } })).toBeNull();
  });

  it('measures how much of the stage the video covers', () => {
    const stage = { left: 0, top: 0, width: 390, height: 640 };
    expect(stageCoverage({ left: -374, top: 0, width: 1138, height: 640 }, stage)).toEqual({ x: 1, y: 1 });
    const narrow = stageCoverage({ left: 105, top: 0, width: 180, height: 640 }, stage);
    expect(narrow.x).toBeCloseTo(180 / 390);
    expect(narrow.x).toBeLessThan(COVERAGE_MIN);
  });

  it('re-lays out after 300 ms, re-attaches if that did not help, then cools down', () => {
    let state = createWatchdog();
    const step = (bad: boolean, now: number) => {
      const result = stepWatchdog(state, bad, now);
      state = result.state;
      return result.action;
    };
    expect(step(true, 0)).toBe('none');
    expect(step(true, WATCHDOG_RELAYOUT_MS - 1)).toBe('none');
    expect(step(true, WATCHDOG_RELAYOUT_MS)).toBe('relayout');
    expect(step(true, WATCHDOG_RELAYOUT_MS + 100)).toBe('none');
    expect(step(true, WATCHDOG_RELAYOUT_MS + WATCHDOG_REATTACH_MS)).toBe('reattach');
    expect(step(true, 3000)).toBe('relayout');
    expect(step(true, 3000 + WATCHDOG_REATTACH_MS)).toBe('none');
    expect(step(false, 9000)).toBe('none');
    expect(step(true, 9000)).toBe('none');
  });

  it('a brief glitch under 300 ms does nothing', () => {
    let state = createWatchdog();
    for (const [bad, now] of [[true, 0], [true, 200], [false, 250], [true, 400], [true, 650]] as const) {
      const result = stepWatchdog(state, bad, now);
      state = result.state;
      expect(result.action).toBe('none');
    }
  });

  it('detects iPhone and iPadOS (which reports MacIntel) but not desktop Mac or Android', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130' })).toBe(true);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' })).toBe(false);
  });

  it('asks for portrait video only on an upright touch screen', () => {
    expect(prefersPortraitCamera({ coarsePointer: true, viewport: { width: 390, height: 797 } })).toBe(true);
    expect(prefersPortraitCamera({ coarsePointer: true, viewport: { width: 844, height: 390 } })).toBe(false);
    expect(prefersPortraitCamera({ coarsePointer: false, viewport: { width: 1366, height: 768 } })).toBe(false);
    expect(prefersPortraitCamera({ coarsePointer: false, viewport: { width: 700, height: 900 } })).toBe(false);
  });

  it('describes stage vs stream vs rendered rect for the admin overlay', () => {
    const text = describeStage({
      phase: 'set',
      fixes: 1,
      stage: { width: 390, height: 600 },
      stream: { width: 720, height: 1280, source: "bitmap" },
      element: { width: 1280, height: 720 },
      frame: { width: 720, height: 1280 },
      bitmap: null,
      settings: { width: 1280, height: 720 },
      videoRect: { left: 0, top: -46.5, width: 390, height: 693.3 },
      coverage: { x: 1, y: 1 },
      viewport: { width: 390, height: 844 },
      visualViewport: { width: 390, height: 760 },
      dpr: 3,
      orientation: 'portrait-primary',
      readyState: 4,
      paused: false,
    });
    expect(text).toContain('stage 390×600');
    expect(text).toContain('stream 720×1280 [bitmap] · el 1280×720');
    expect(text).toContain('bmp –');
    expect(text).toContain('video 390×693 @ 0,-46 · covers 100%×100%');
  });
});

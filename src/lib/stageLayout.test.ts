import { describe, expect, it } from 'vitest';
import { coverLayout, toStagePoint } from './stageLayout';

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

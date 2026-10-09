import { describe, expect, it } from 'vitest';
import { AUTO_START_HOLD_MS, createPositionWatch, LEFT_POSITION_MS, watchPosition, type PositionWatch } from './autoStart';

const FRAME_MS = 33;
type Frame = { atTop: boolean; horizontal: boolean };
const TOP: Frame = { atTop: true, horizontal: true };
const PLANK_BENT: Frame = { atTop: false, horizontal: true };
const UPRIGHT: Frame = { atTop: false, horizontal: false };

function run(frames: Frame[], start: PositionWatch = createPositionWatch()) {
  let state = start;
  let holdingAt: number | null = null;
  let leftAt: number | null = null;
  frames.forEach((frame, i) => {
    const now = i * FRAME_MS;
    const step = watchPosition(state, { ...frame, now });
    state = step.state;
    if (step.holding && holdingAt === null) holdingAt = now;
    if (step.left && leftAt === null) leftAt = now;
  });
  return { state, holdingAt, leftAt };
}
const repeat = (frame: Frame, ms: number) => Array.from({ length: Math.ceil(ms / FRAME_MS) }, () => frame);

describe('auto start position watch', () => {
  it('starts once the top of a push-up has been held for 1.5 s', () => {
    expect(run(repeat(TOP, AUTO_START_HOLD_MS - 100)).holdingAt).toBeNull();
    const held = run(repeat(TOP, AUTO_START_HOLD_MS + 100)).holdingAt;
    expect(held).not.toBeNull();
    expect(held!).toBeGreaterThanOrEqual(AUTO_START_HOLD_MS);
  });

  it('a one-frame wobble does not restart the hold, sitting back does', () => {
    const wobble = [...repeat(TOP, 800), PLANK_BENT, ...repeat(TOP, 800)];
    expect(run(wobble).holdingAt).not.toBeNull();
    const satBack = [...repeat(TOP, 800), ...repeat(UPRIGHT, 500), ...repeat(TOP, 800)];
    expect(run(satBack).holdingAt).toBeNull();
  });

  it('standing or kneeling up does not start it', () => {
    expect(run(repeat(UPRIGHT, 3000)).holdingAt).toBeNull();
  });

  it('flags leaving the plank after a moment out of it, not on a dip into a bent-arm plank', () => {
    expect(run([...repeat(TOP, 500), ...repeat(PLANK_BENT, 2000)]).leftAt).toBeNull();
    const left = run([...repeat(TOP, 500), ...repeat(UPRIGHT, LEFT_POSITION_MS + 200)]).leftAt;
    expect(left).not.toBeNull();
    expect(run([...repeat(TOP, 500), ...repeat(UPRIGHT, LEFT_POSITION_MS - 200), ...repeat(TOP, 500)]).leftAt).toBeNull();
  });
});

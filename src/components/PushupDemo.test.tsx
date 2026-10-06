import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pushupSkeleton, type Vec3 } from '../lib/idealPushup';
import { REP_TOP_ANGLE } from '../lib/scoring';
import { PushupDemo } from './PushupDemo';

const sub = (a: Vec3, b: Vec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const angleDeg = (a: Vec3, b: Vec3) => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return (Math.acos(dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))) * 180) / Math.PI;
};

describe('PushupDemo', () => {
  it('renders an accessible figure with the caption and no external assets', () => {
    const html = renderToStaticMarkup(<PushupDemo frozenDepth={1} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('Watch the ideal form: body straight, elbows tucked, chest low');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('depicts ideal form: tucked elbows and chest low at the bottom, lockout at the top', () => {
    const bottom = pushupSkeleton(1, 45);
    const tuck = angleDeg(sub(bottom.lElbow, bottom.lShoulder), sub(bottom.lHip, bottom.lShoulder));
    expect(tuck).toBeGreaterThan(30);
    expect(tuck).toBeLessThan(60);
    expect(bottom.lShoulder.y).toBeLessThan(0.15);

    const top = pushupSkeleton(0, 45);
    expect(angleDeg(sub(top.lShoulder, top.lElbow), sub(top.lWrist, top.lElbow))).toBeGreaterThan(REP_TOP_ANGLE);
    expect(top.lWrist.x - top.lShoulder.x).toBeGreaterThan(0);
  });
});

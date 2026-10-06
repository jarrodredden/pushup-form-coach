import { useEffect, useMemo, useState } from 'react';
import { PUSHUP_BODY, project, pushupDepthAt, pushupSkeleton, type Camera, type PushupJoint, type Vec3 } from '../lib/idealPushup';

/** Ideal form shown by the demo: elbows tucked ~45° from the torso. */
const DEMO_TUCK_DEGREES = 45;
const REP_MS = 2000;
const FRAME_MS = 1000 / 30;

/** Head-on like the volunteer's phone, but raised and further back so the body line reads above the head. */
const DEMO_CAMERA: Camera = { eye: { x: 0, y: 1.9, z: 1.8 }, target: { x: 0, y: 0.1, z: -0.6 }, focal: 2.4 };

type Region = 'arm' | 'torso' | 'leg';
const BONES: Array<{ from: PushupJoint; to: PushupJoint; region: Region }> = [
  { from: 'lShoulder', to: 'rShoulder', region: 'torso' },
  { from: 'lHip', to: 'rHip', region: 'torso' },
  { from: 'lShoulder', to: 'lHip', region: 'torso' },
  { from: 'rShoulder', to: 'rHip', region: 'torso' },
  { from: 'lShoulder', to: 'lElbow', region: 'arm' },
  { from: 'lElbow', to: 'lWrist', region: 'arm' },
  { from: 'rShoulder', to: 'rElbow', region: 'arm' },
  { from: 'rElbow', to: 'rWrist', region: 'arm' },
  { from: 'lHip', to: 'lKnee', region: 'leg' },
  { from: 'lKnee', to: 'lAnkle', region: 'leg' },
  { from: 'lAnkle', to: 'lToe', region: 'leg' },
  { from: 'rHip', to: 'rKnee', region: 'leg' },
  { from: 'rKnee', to: 'rAnkle', region: 'leg' },
  { from: 'rAnkle', to: 'rToe', region: 'leg' },
];
const JOINT_DOTS: PushupJoint[] = ['lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lHip', 'rHip', 'lKnee', 'rKnee'];

const JOINTS = Object.keys(pushupSkeleton(0)) as PushupJoint[];

/** Exercise mat under the athlete, from just past the hands back beyond the feet. */
const MAT: Vec3[] = [
  { x: -0.48, y: 0, z: 0.3 },
  { x: 0.48, y: 0, z: 0.3 },
  { x: 0.48, y: 0, z: -1.5 },
  { x: -0.48, y: 0, z: -1.5 },
];

function demoScene(depth: number, camera: Camera = DEMO_CAMERA) {
  const skeleton = pushupSkeleton(depth, DEMO_TUCK_DEGREES);
  const points = {} as Record<PushupJoint, { x: number; y: number; depth: number }>;
  for (const joint of JOINTS) points[joint] = project(skeleton[joint], camera);
  const headRadius = Math.abs(project({ ...skeleton.head, y: skeleton.head.y + PUSHUP_BODY.headRadius }, camera).y - points.head.y);
  return { points, headRadius };
}


/** Fixed frame covering the whole rep so the figure never shifts or rescales mid-loop. */
function demoViewBox(camera: Camera) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let step = 0; step <= 10; step += 1) {
    const { points, headRadius } = demoScene(step / 10, camera);
    for (const point of Object.values(points)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y + (point === points.head ? headRadius : 0));
    }
  }
  const padX = 0.12 * (maxX - minX);
  const padY = 0.12 * (maxY - minY);
  return { x: minX - padX, y: minY - padY, width: maxX - minX + padX * 2, height: maxY - minY + padY * 2 };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useLoopClock(running: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = -Infinity;
    const start = performance.now();
    const tick = (time: number) => {
      if (time - last >= FRAME_MS) {
        last = time;
        setNow(time - start);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return now;
}

export function PushupDemo({
  caption = 'Watch the ideal form: body straight, elbows tucked, chest low',
  frozenDepth,
  camera = DEMO_CAMERA,
}: {
  caption?: string;
  /** Renders a single still pose (0 = top, 1 = bottom) instead of the loop. */
  frozenDepth?: number;
  camera?: Camera;
}) {
  const reducedMotion = usePrefersReducedMotion();
  // Reduced motion: hold the bottom of the rep, where the form cues matter most.
  const still = frozenDepth ?? (reducedMotion ? 0.9 : null);
  const time = useLoopClock(still === null);
  const viewBox = useMemo(() => demoViewBox(camera), [camera]);
  const mat = useMemo(() => MAT.map((corner) => project(corner, camera)), [camera]);
  const depth = still ?? pushupDepthAt(time, REP_MS);
  const goingDown = still === null ? time % REP_MS < REP_MS / 2 : still >= 0.5;
  const { points, headRadius } = demoScene(depth, camera);

  const unit = viewBox.height / 100;
  const bones = BONES.map((bone) => ({
    ...bone,
    a: points[bone.from],
    b: points[bone.to],
    depth: (points[bone.from].depth + points[bone.to].depth) / 2,
  })).sort((p, q) => q.depth - p.depth);
  const shoulderMid = { x: (points.lShoulder.x + points.rShoulder.x) / 2, y: (points.lShoulder.y + points.rShoulder.y) / 2 };
  const ankleMid = { x: (points.lAnkle.x + points.rAnkle.x) / 2, y: (points.lAnkle.y + points.rAnkle.y) / 2 };

  return (
    <figure className="pushup-demo">
      <svg
        className="pushup-demo__svg"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Animated stick figure doing push-ups with ideal form, seen from the front: straight body, hands slightly wider than shoulders, elbows tucked about 45 degrees, chest lowered near the floor, then arms locked out at the top."
      >
        <polygon className="pushup-demo__mat" points={mat.map((corner) => `${corner.x},${corner.y}`).join(' ')} />
        <line
          className="pushup-demo__guide"
          x1={ankleMid.x}
          y1={ankleMid.y}
          x2={shoulderMid.x}
          y2={shoulderMid.y}
          strokeWidth={unit * 0.8}
          strokeDasharray={`${unit * 2.2} ${unit * 2}`}
        />
        <polygon
          className="pushup-demo__torso"
          points={(['lShoulder', 'rShoulder', 'rHip', 'lHip'] as const).map((joint) => `${points[joint].x},${points[joint].y}`).join(' ')}
        />
        <line
          className="pushup-demo__bone pushup-demo__bone--torso"
          x1={shoulderMid.x}
          y1={shoulderMid.y}
          x2={points.head.x}
          y2={points.head.y}
          strokeWidth={unit * 3.2}
        />
        {bones.map((bone) => (
          <line
            key={`${bone.from}-${bone.to}`}
            className={`pushup-demo__bone pushup-demo__bone--${bone.region}`}
            x1={bone.a.x}
            y1={bone.a.y}
            x2={bone.b.x}
            y2={bone.b.y}
            strokeWidth={unit * (bone.region === 'leg' ? 2.4 : 3.2)}
          />
        ))}
        {JOINT_DOTS.map((joint) => (
          <circle key={joint} className="pushup-demo__joint" cx={points[joint].x} cy={points[joint].y} r={unit * 1.8} />
        ))}
        <circle className="pushup-demo__head" cx={points.head.x} cy={points.head.y} r={headRadius} strokeWidth={unit * 2.4} />
      </svg>
      <div className="pushup-demo__phase" aria-hidden="true">
        <span className={goingDown ? 'is-on' : ''}>Down · chest low</span>
        <span className={goingDown ? '' : 'is-on'}>Up · lock out</span>
      </div>
      <figcaption className="pushup-demo__caption">{caption}</figcaption>
    </figure>
  );
}

import { hipDirection, LIVE_CUES, weightedRepScore } from './coaching';
import { elbowTuckScore, headOnElbowAbduction, median, worldElbowAbduction } from './elbowTuck';
import { measureFrontPlank, measureSidePlank, plankMethodLabel, type PlankReference } from './plankLine';
import { CameraViewMode, PoseAnalysis, PosePoint, RepAccumulator, RepFrameSample, SessionRep } from './types';

export const MIN_SIGNAL = 0.45;
export const REP_TOP_ANGLE = 158;
export const REP_BOTTOM_ANGLE = 120;

/** Frames within this many degrees of the rep's deepest elbow angle form the scored bottom window. */
export const BOTTOM_WINDOW_DEGREES = 12;
const MAX_BOTTOM_FRAMES = 240;

const REQUIRED = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
const REQUIRED_HEAD_ON = [11, 12, 13, 14, 15, 16] as const;
const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const point = (landmarks: PosePoint[] | undefined, index: number): PosePoint | null => landmarks?.[index] ?? null;
const midpoint = (a: PosePoint, b: PosePoint): PosePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
});
const distance = (a: PosePoint, b: PosePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: PosePoint, b: PosePoint, c: PosePoint) => {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!mag) return 180;
  return (Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI;
};
const averageVisibility = (landmarks: PosePoint[] | undefined, indices: readonly number[]) => {
  if (!landmarks?.length) return 0;
  const sum = indices.reduce((acc, index) => acc + (landmarks[index]?.visibility ?? 0), 0);
  return sum / indices.length;
};
const mean = (...values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const scoreLine = (offset: number, scale: number) => clamp(100 - offset * scale, 0, 100);

/** Elbow angle (as measured) that earns full depth credit; every degree above costs DEPTH_POINTS_PER_DEGREE. */
export const FULL_DEPTH_ANGLE = 90;
const DEPTH_POINTS_PER_DEGREE = 3;
export const depthScoreForAngle = (elbowAngle: number) => clamp(100 - Math.max(0, elbowAngle - FULL_DEPTH_ANGLE) * DEPTH_POINTS_PER_DEGREE, 0, 100);
export const angleForDepthScore = (score: number) => FULL_DEPTH_ANGLE + (100 - clamp(score, 0, 100)) / DEPTH_POINTS_PER_DEGREE;
/** The rep's depth is read from its few deepest frames, not diluted by the frames around them. */
const DEPTH_SAMPLE_FRAMES = 3;

/** Down and back up faster than this is rushed. */
export const CONTROLLED_REP_MS = 1200;
const RUSHED_MAX_PENALTY = 15;
/** Over RUSHED_MAX_PENALTY's span: at CONTROLLED_REP_MS − this, the full penalty applies. */
const RUSHED_SPAN_MS = 600;
/** Arms this straight at the top count as locked out; REP_TOP_ANGLE (the counting minimum) costs LOCKOUT_MAX_PENALTY. */
export const FULL_LOCKOUT_ANGLE = 165;
const LOCKOUT_MAX_PENALTY = 10;

export const RUSHED_NOTE = 'Rushed — take about two seconds, down and up.';
export const LOCKOUT_NOTE = 'Straighten the arms fully at the top.';

export interface RepControl {
  durationMs: number;
  lockoutAngle: number;
}

export function controlPenalty(control: RepControl | undefined) {
  if (!control) return { rushed: 0, lockout: 0 };
  const rushed = clamp(((CONTROLLED_REP_MS - control.durationMs) / RUSHED_SPAN_MS) * RUSHED_MAX_PENALTY, 0, RUSHED_MAX_PENALTY);
  const lockout = control.lockoutAngle > 0
    ? clamp(((FULL_LOCKOUT_ANGLE - control.lockoutAngle) / (FULL_LOCKOUT_ANGLE - REP_TOP_ANGLE)) * LOCKOUT_MAX_PENALTY, 0, LOCKOUT_MAX_PENALTY)
    : 0;
  return { rushed: Math.round(rushed), lockout: Math.round(lockout) };
}

/** Side view: wrists may sit this far (in torso lengths) from under the shoulders for full credit; zero at SIDE_HAND_ZERO. */
const SIDE_HAND_FULL = 0.2;
const SIDE_HAND_ZERO = 0.5;
/** Side view: head in line with the torso within this many degrees for full credit; zero at SIDE_HEAD_ZERO_DEG. */
const SIDE_HEAD_FULL_DEG = 12;
const SIDE_HEAD_ZERO_DEG = 40;
/** Front view: lateral offset of hands / head from the shoulders' centre, points lost per shoulder width. */
const FRONT_OFFSET_POINTS = 220;

const ELBOW_NOTE: Record<CameraViewMode, { below: number; text: string }> = {
  'head-on': { below: 68, text: 'Tuck the elbows in a bit more from the front view.' },
  side: { below: 74, text: 'Tuck the elbows a little more.' },
};
const CLEAN_NOTE: Record<CameraViewMode, string> = { 'head-on': 'Clean head-on rep.', side: 'Clean side-view rep.' };

/** Re-derives the elbow note after the live elbow score is smoothed or re-graded on a saved range. */
export function withElbowNote(notes: string[], viewMode: CameraViewMode, elbowFlareScore: number) {
  const { below, text } = ELBOW_NOTE[viewMode];
  const others = notes.filter((note) => note !== text && note !== CLEAN_NOTE[viewMode]);
  const next = elbowFlareScore < below ? [...others, text] : others;
  return next.length ? next : [CLEAN_NOTE[viewMode]];
}

function buildHeadOnNotes(metrics: {
  elbowDepthScore: number;
  bodyLineScore: number | null;
  elbowFlareScore: number;
  handStackScore: number;
  headAlignmentScore: number;
  framingScore: number;
  hipBias: number;
  setupHint: string | null;
}) {
  const notes: string[] = [];
  if (metrics.setupHint) notes.push(metrics.setupHint);
  // Front-view coaching is intentionally softer so depth and flare stay achievable on a phone camera.
  if (metrics.elbowDepthScore < 55) notes.push(LIVE_CUES.depth);
  if (metrics.bodyLineScore !== null && metrics.bodyLineScore < 74) {
    const direction = hipDirection(metrics.hipBias);
    if (direction !== 'sag') notes.push(LIVE_CUES.hipPike);
    if (direction !== 'pike') notes.push(LIVE_CUES.hipSag);
  }
  if (metrics.elbowFlareScore < ELBOW_NOTE['head-on'].below) notes.push(ELBOW_NOTE['head-on'].text);
  if (metrics.handStackScore < 74) notes.push('Stack the hands under the shoulders.');
  if (metrics.headAlignmentScore < 72) notes.push('Keep the head centered between the shoulders.');
  if (metrics.framingScore < 70 && !metrics.setupHint) notes.push('Back up or lower the phone until hands, torso, and head stay in frame.');
  if (!notes.length) notes.push(CLEAN_NOTE['head-on']);
  return notes;
}

function buildSideNotes(metrics: {
  elbowDepthScore: number;
  bodyLineScore: number | null;
  hipSagScore: number | null;
  hipPikeScore: number | null;
  handStackScore: number;
  headAlignmentScore: number;
  elbowFlareScore: number;
  setupHint: string | null;
}) {
  const notes: string[] = [];
  if (metrics.setupHint) notes.push(metrics.setupHint);
  if (metrics.elbowDepthScore < 58) notes.push(LIVE_CUES.depth);
  if ((metrics.hipSagScore ?? 100) < 74) notes.push(LIVE_CUES.hipSag);
  if ((metrics.hipPikeScore ?? 100) < 74) notes.push(LIVE_CUES.hipPike);
  if (metrics.handStackScore < 74) notes.push('Keep hands stacked under the shoulders.');
  if (metrics.headAlignmentScore < 72) notes.push('Keep the head in line with the body.');
  if (metrics.elbowFlareScore < ELBOW_NOTE.side.below) notes.push(ELBOW_NOTE.side.text);
  if (!notes.length) notes.push(CLEAN_NOTE.side);
  return notes;
}

function framingHint(landmarks: PosePoint[] | undefined, viewMode: CameraViewMode) {
  const wristsVisible = averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]);
  const anklesVisible = averageVisibility(landmarks, [LEFT.ankle, RIGHT.ankle]);
  const shouldersVisible = averageVisibility(landmarks, [LEFT.shoulder, RIGHT.shoulder]);
  const headVisible = averageVisibility(landmarks, [0, 1, 2, 5, 7, 8]);
  if (viewMode === 'head-on') {
    if (wristsVisible < 0.35 && shouldersVisible < 0.35) return 'Move back so hands, torso, and head are visible.';
    if (wristsVisible < 0.45) return 'Move back a little so both hands stay visible.';
    if (shouldersVisible < 0.45) return 'Center the torso in frame.';
    if (headVisible < 0.35) return 'Raise the phone so the head stays visible.';
    return null;
  }
  if (wristsVisible < 0.4 && anklesVisible < 0.4) return 'Use a wider side setup so wrists, hips, and shoulders stay visible.';
  if (anklesVisible < 0.45) return 'Back the phone up a little so the body stays in frame.';
  return null;
}

const ELBOW_VISIBLE = 0.5;

/** Mean of the arms the camera can actually see; null when neither elbow is readable. */
function elbowAbductionForView(
  landmarks: PosePoint[],
  worldLandmarks: PosePoint[] | undefined,
  viewMode: CameraViewMode,
  shoulderWidth: number,
): number | null {
  const sides = [
    { shoulder: LEFT.shoulder, elbow: LEFT.elbow, other: RIGHT.shoulder },
    { shoulder: RIGHT.shoulder, elbow: RIGHT.elbow, other: LEFT.shoulder },
  ].filter((side) => (landmarks[side.elbow]?.visibility ?? 0) >= ELBOW_VISIBLE);
  const readings = sides
    .map((side) => {
      if (viewMode === 'head-on') {
        return headOnElbowAbduction(landmarks[side.shoulder], landmarks[side.elbow], landmarks[side.other], shoulderWidth);
      }
      if (!worldLandmarks?.length) return null;
      const shoulderMid = midpoint(worldLandmarks[LEFT.shoulder], worldLandmarks[RIGHT.shoulder]);
      const hipMid = midpoint(worldLandmarks[LEFT.hip], worldLandmarks[RIGHT.hip]);
      return worldElbowAbduction(worldLandmarks[side.shoulder], worldLandmarks[side.elbow], worldLandmarks[side.other], shoulderMid, hipMid);
    })
    .filter((value): value is number => value !== null);
  return readings.length ? mean(...readings) : null;
}

export interface AnalyzeOptions {
  worldLandmarks?: PosePoint[];
  /** Video width / height. Landmark x is normalized by width and y by height, so geometry needs it. */
  aspect?: number;
  /** The athlete's own top-of-rep plank, for the front-view plank line. */
  plankReference?: PlankReference | null;
}

export function analyzePose(
  landmarks: PosePoint[] | undefined,
  viewMode: CameraViewMode = 'head-on',
  options: AnalyzeOptions = {},
): PoseAnalysis {
  const { worldLandmarks, aspect = 0.75, plankReference } = options;
  // Front view only needs the upper body; knees and ankles are usually out of frame from there.
  const confidence = averageVisibility(landmarks, viewMode === 'head-on' ? REQUIRED_HEAD_ON : REQUIRED);
  if (!landmarks?.length || confidence < MIN_SIGNAL) {
    const setupHint = viewMode === 'head-on'
      ? 'Move back until hands, torso, and head are visible.'
      : 'Move far enough back that the full side profile stays visible.';
    return {
      viewMode,
      overallScore: 0,
      elbowAngle: 180,
      elbowDepthScore: 0,
      bodyLineScore: null,
      plankRaw: null,
      plankMethod: null,
      plankDetail: null,
      elbowFlareScore: 0,
      elbowAbduction: null,
      handStackScore: 0,
      headAlignmentScore: 0,
      framingScore: 0,
      hipSagScore: null,
      hipPikeScore: null,
      hipBias: 0,
      confidence,
      phase: 'unknown',
      setupHint,
      notes: [setupHint],
    };
  }

  const lShoulder = point(landmarks, LEFT.shoulder)!;
  const rShoulder = point(landmarks, RIGHT.shoulder)!;
  const lElbow = point(landmarks, LEFT.elbow)!;
  const rElbow = point(landmarks, RIGHT.elbow)!;
  const lWrist = point(landmarks, LEFT.wrist)!;
  const rWrist = point(landmarks, RIGHT.wrist)!;
  const nose = point(landmarks, 0);

  const shoulderMid = midpoint(lShoulder, rShoulder);
  const wristMid = midpoint(lWrist, rWrist);
  const shoulderWidth = Math.max(distance(lShoulder, rShoulder), 0.001);
  const headVisible = averageVisibility(landmarks, [0, 1, 2, 5, 7, 8]);

  const leftElbowAngle = angle(lShoulder, lElbow, lWrist);
  const rightElbowAngle = angle(rShoulder, rElbow, rWrist);
  const elbowAngle = mean(leftElbowAngle, rightElbowAngle);
  const elbowDepthScore = depthScoreForAngle(elbowAngle);
  const elbowAbduction = elbowAbductionForView(landmarks, worldLandmarks, viewMode, shoulderWidth);
  const elbowFlareScore = elbowTuckScore(elbowAbduction);
  const noseVisible = Boolean(nose) && (nose!.visibility ?? 0) > 0.35;
  let handStackScore: number;
  let headAlignmentScore: number;
  if (viewMode === 'side') {
    // Side on, the shoulders overlap, so shoulder width can't scale anything: use the torso.
    const X = (p: PosePoint) => p.x * aspect;
    const hipMid = midpoint(point(landmarks, LEFT.hip)!, point(landmarks, RIGHT.hip)!);
    const torso = Math.max(Math.hypot(X(shoulderMid) - X(hipMid), shoulderMid.y - hipMid.y), 0.001);
    const handOffset = Math.abs(X(wristMid) - X(shoulderMid)) / torso;
    handStackScore = clamp(100 - (Math.max(0, handOffset - SIDE_HAND_FULL) / (SIDE_HAND_ZERO - SIDE_HAND_FULL)) * 100, 0, 100);
    if (noseVisible) {
      const torsoDir = Math.atan2(shoulderMid.y - hipMid.y, X(shoulderMid) - X(hipMid));
      const headDir = Math.atan2(nose!.y - shoulderMid.y, X(nose!) - X(shoulderMid));
      const neck = Math.abs(((((headDir - torsoDir) * 180) / Math.PI + 540) % 360) - 180);
      headAlignmentScore = clamp(100 - (Math.max(0, neck - SIDE_HEAD_FULL_DEG) / (SIDE_HEAD_ZERO_DEG - SIDE_HEAD_FULL_DEG)) * 100, 0, 100);
    } else {
      headAlignmentScore = 55;
    }
  } else {
    handStackScore = scoreLine(Math.abs(wristMid.x - shoulderMid.x) / shoulderWidth, FRONT_OFFSET_POINTS);
    headAlignmentScore = noseVisible ? scoreLine(Math.abs(nose!.x - shoulderMid.x) / shoulderWidth, FRONT_OFFSET_POINTS) : 55;
  }
  const framingHintText = framingHint(landmarks, viewMode);
  const phase = elbowAngle >= 155 ? 'top' : elbowAngle <= 95 ? 'bottom' : 'mid';
  const plank = viewMode === 'head-on' ? measureFrontPlank(landmarks, aspect, plankReference) : measureSidePlank(landmarks, aspect);
  const framingScore = Math.round(
    clamp(
      (averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]) * 0.55 + averageVisibility(landmarks, [LEFT.ankle, RIGHT.ankle]) * 0.45) * 100,
      0,
      100,
    ),
  );

  const bodyLineScore = plank.score;
  const hipBias = plank.bias;
  const plankFields = { plankRaw: plank.raw, plankMethod: plank.method, plankDetail: plank.detail };
  let hipSagScore: number | null = null;
  let hipPikeScore: number | null = null;
  let overallScore = 0;
  let notes: string[] = [];

  if (viewMode === 'side') {
    if (bodyLineScore !== null) {
      hipSagScore = hipBias > 0 ? bodyLineScore : 100;
      hipPikeScore = hipBias < 0 ? bodyLineScore : 100;
    }
    overallScore = weightedRepScore('side', {
      depth: elbowDepthScore,
      bodyLine: bodyLineScore,
      elbowFlare: elbowFlareScore,
      handStack: handStackScore,
      headAlignment: headAlignmentScore,
    });
    notes = buildSideNotes({
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      hipSagScore,
      hipPikeScore,
      handStackScore: Math.round(handStackScore),
      headAlignmentScore: Math.round(headAlignmentScore),
      elbowFlareScore: Math.round(elbowFlareScore),
      setupHint: framingHintText,
    });
  } else {
    const headOnFrameScore = clamp(
      averageVisibility(landmarks, [LEFT.wrist, RIGHT.wrist]) * 40 +
        averageVisibility(landmarks, [LEFT.shoulder, RIGHT.shoulder]) * 35 +
        headVisible * 25,
      0,
      100,
    );
    overallScore = weightedRepScore('head-on', {
      depth: elbowDepthScore,
      bodyLine: bodyLineScore,
      elbowFlare: elbowFlareScore,
      handStack: handStackScore,
      headAlignment: headAlignmentScore,
    });
    notes = buildHeadOnNotes({
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      elbowFlareScore: Math.round(elbowFlareScore),
      handStackScore: Math.round(handStackScore),
      headAlignmentScore: Math.round(headAlignmentScore),
      framingScore: Math.round(headOnFrameScore),
      hipBias,
      setupHint: framingHintText,
    });
    return {
      viewMode,
      overallScore,
      elbowAngle,
      elbowDepthScore: Math.round(elbowDepthScore),
      bodyLineScore,
      ...plankFields,
      elbowFlareScore: Math.round(elbowFlareScore),
      elbowAbduction: elbowAbduction === null ? null : Math.round(elbowAbduction),
      handStackScore: Math.round(handStackScore),
      headAlignmentScore: Math.round(headAlignmentScore),
      framingScore: Math.round(headOnFrameScore),
      hipSagScore,
      hipPikeScore,
      hipBias,
      confidence: clamp(confidence, 0, 1),
      phase,
      setupHint: framingHintText,
      notes,
    };
  }

  return {
    viewMode,
    overallScore,
    elbowAngle,
    elbowDepthScore: Math.round(elbowDepthScore),
    bodyLineScore,
    ...plankFields,
    elbowFlareScore: Math.round(elbowFlareScore),
    elbowAbduction: elbowAbduction === null ? null : Math.round(elbowAbduction),
    handStackScore: Math.round(handStackScore),
    headAlignmentScore: Math.round(headAlignmentScore),
    framingScore,
    hipSagScore,
    hipPikeScore,
    hipBias,
    confidence: clamp(confidence, 0, 1),
    phase,
    setupHint: framingHintText,
    notes,
  };
}

export function createEmptyRepAccumulator(): RepAccumulator {
  return { frames: 0, bottomFrames: [] };
}

function sampleFromFrame(frame: PoseAnalysis): RepFrameSample {
  return {
    elbowAngle: frame.elbowAngle,
    depth: frame.elbowDepthScore,
    bodyLine: frame.bodyLineScore,
    plankRaw: frame.plankRaw,
    plankMethod: frame.plankMethod,
    elbowFlare: frame.elbowFlareScore,
    elbowAbduction: frame.elbowAbduction,
    headAlignment: frame.headAlignmentScore,
    framing: frame.framingScore,
    hipSag: frame.hipSagScore,
    hipPike: frame.hipPikeScore,
    hipBias: frame.hipBias,
    handStack: frame.handStackScore,
    notes: frame.notes.filter((note) => note !== frame.setupHint),
  };
}

/**
 * Records one post-top frame. Only frames at the bottom of the rep (elbow at or past the
 * down threshold) are kept for scoring, so slow descents and lockouts don't dilute the rep.
 */
export function addRepFrame(accumulator: RepAccumulator, frame: PoseAnalysis, bottomAngle = REP_BOTTOM_ANGLE): RepAccumulator {
  const frames = accumulator.frames + 1;
  if (frame.elbowAngle > bottomAngle) return { ...accumulator, frames };
  let bottomFrames = [...accumulator.bottomFrames, sampleFromFrame(frame)];
  if (bottomFrames.length > MAX_BOTTOM_FRAMES) {
    const shallowest = bottomFrames.reduce((worst, sample, index) => (sample.elbowAngle > bottomFrames[worst].elbowAngle ? index : worst), 0);
    bottomFrames = bottomFrames.filter((_, index) => index !== shallowest);
  }
  return { frames, bottomFrames };
}

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Scores the rep from the bottom window: frames within BOTTOM_WINDOW_DEGREES of the deepest elbow angle. */
export function finalizeRep(accumulator: RepAccumulator, analysis: PoseAnalysis, index: number, control?: RepControl): SessionRep | null {
  if (!accumulator.bottomFrames.length) return null;
  const deepest = Math.min(...accumulator.bottomFrames.map((sample) => sample.elbowAngle));
  const window = accumulator.bottomFrames.filter((sample) => sample.elbowAngle <= deepest + BOTTOM_WINDOW_DEGREES);
  const pick = (select: (sample: RepFrameSample) => number) => average(window.map(select));
  const pickNullable = (select: (sample: RepFrameSample) => number | null) => {
    const values = window.map(select).filter((value): value is number => value !== null);
    return values.length ? Math.round(average(values)) : null;
  };

  // Median of the deepest few frames: how low the rep actually went, robust to one glitchy frame.
  const depth = median([...window].sort((a, b) => a.elbowAngle - b.elbowAngle).slice(0, DEPTH_SAMPLE_FRAMES).map((sample) => sample.depth)) ?? 0;
  const plankSamples = window.filter((sample) => sample.bodyLine !== null);
  const bodyLine = median(plankSamples.map((sample) => sample.bodyLine as number));
  const plankRaw = median(plankSamples.map((sample) => sample.plankRaw).filter((value): value is number => value !== null));
  const plankMethod = plankSamples.length ? plankSamples[Math.floor(plankSamples.length / 2)].plankMethod : null;
  // Median, not mean: one jittery elbow landmark shouldn't knock points off a tucked rep.
  const elbowFlare = median(window.map((sample) => sample.elbowFlare)) ?? 100;
  const elbowAbduction = median(
    window.map((sample) => sample.elbowAbduction).filter((value): value is number => value !== null),
  );
  const headAlignment = pick((sample) => sample.headAlignment);
  const handStack = pick((sample) => sample.handStack);
  const formScore = weightedRepScore(analysis.viewMode, { depth, bodyLine, elbowFlare, handStack, headAlignment });
  const penalty = controlPenalty(control);
  const controlNotes = [
    ...(penalty.rushed ? [RUSHED_NOTE] : []),
    ...(penalty.lockout ? [LOCKOUT_NOTE] : []),
  ];

  return {
    index,
    viewMode: analysis.viewMode,
    score: Math.max(0, formScore - penalty.rushed - penalty.lockout),
    notes: [...new Set([...controlNotes, ...window.flatMap((sample) => sample.notes)])].slice(0, 6),
    ...(control ? { durationMs: Math.round(control.durationMs), lockoutAngle: Math.round(control.lockoutAngle), controlPenalty: penalty.rushed + penalty.lockout } : {}),
    elbowDepthScore: Math.round(depth),
    bodyLineScore: bodyLine === null ? null : Math.round(bodyLine),
    plankMethod,
    plankRaw: plankRaw === null ? null : Number(plankRaw.toFixed(plankMethod?.startsWith('side') ? 1 : 3)),
    plankDebug: plankSamples.length
      ? `${plankMethodLabel(plankMethod)} · raw ${plankRaw === null ? '–' : plankRaw.toFixed(plankMethod?.startsWith('side') ? 1 : 3)}${plankMethod?.startsWith('side') ? '° bend' : ' SW'} (+ sag / − pike) · ${plankSamples.length}/${window.length} bottom frames`
      : `n/a · plank landmarks not visible in ${window.length} bottom frames`,
    elbowFlareScore: Math.round(elbowFlare),
    elbowAbduction: elbowAbduction === null ? undefined : Math.round(elbowAbduction),
    handStackScore: Math.round(handStack),
    headAlignmentScore: Math.round(headAlignment),
    framingScore: Math.round(pick((sample) => sample.framing)),
    hipSagScore: analysis.viewMode === 'side' ? pickNullable((sample) => sample.hipSag) : null,
    hipPikeScore: analysis.viewMode === 'side' ? pickNullable((sample) => sample.hipPike) : null,
    hipBias: Math.round(pick((sample) => sample.hipBias)),
    bottomElbowAngle: Math.round(deepest),
    confidence: analysis.confidence,
    timestamp: Date.now(),
  };
}

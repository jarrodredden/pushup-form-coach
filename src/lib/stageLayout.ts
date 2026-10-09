/**
 * One "cover" transform for the camera stage, used to size the <video> element and to draw the pose
 * overlay. Both layers go through this instead of each relying on CSS object-fit, which browsers apply
 * separately (and iOS WebKit doesn't always re-apply after the stream's size or orientation changes).
 */
export interface StageLayout {
  /** Stage size in CSS pixels. */
  stageWidth: number;
  stageHeight: number;
  /** Intrinsic stream size. */
  videoWidth: number;
  videoHeight: number;
  /** Displayed video rect inside the stage, in CSS pixels (may overflow the stage on one axis). */
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function coverLayout(stageWidth: number, stageHeight: number, videoWidth: number, videoHeight: number): StageLayout | null {
  if (!(stageWidth > 0 && stageHeight > 0 && videoWidth > 0 && videoHeight > 0)) return null;
  const scale = Math.max(stageWidth / videoWidth, stageHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    stageWidth,
    stageHeight,
    videoWidth,
    videoHeight,
    width,
    height,
    offsetX: (stageWidth - width) / 2,
    offsetY: (stageHeight - height) / 2,
  };
}

/** Maps a normalized landmark (0–1 of the raw camera frame) to stage CSS pixels, mirrored like the preview. */
export function toStagePoint(point: { x: number; y: number }, layout: StageLayout, mirrored: boolean) {
  const x = mirrored ? 1 - point.x : point.x;
  return { x: layout.offsetX + x * layout.width, y: layout.offsetY + point.y * layout.height };
}

export function sameLayout(a: StageLayout | null, b: StageLayout | null) {
  if (!a || !b) return a === b;
  return (
    a.stageWidth === b.stageWidth && a.stageHeight === b.stageHeight && a.videoWidth === b.videoWidth && a.videoHeight === b.videoHeight
  );
}

export interface Size {
  width: number;
  height: number;
}

export type FrameSizeSource = 'element' | 'frame' | 'bitmap' | 'settings';

const usable = (size: Size | null | undefined): size is Size => Boolean(size && size.width > 0 && size.height > 0);
const isPortrait = (size: Size) => size.height > size.width;

/**
 * The stream size to lay out with. videoWidth/videoHeight normally win, but iOS WebKit can report
 * them as 0, or keep the sensor (landscape) orientation for a while after it has started painting
 * rotated portrait frames. When an ImageBitmap of the current frame (the rendered, rotated image)
 * disagrees on orientation, trust it: that's what's painted. requestVideoFrameCallback metadata can
 * describe the raw sensor buffer before rotation, so it can veto an override but never cause one.
 */
export function pickFrameSize(sources: { element?: Size | null; frame?: Size | null; bitmap?: Size | null; settings?: Size | null }): (Size & { source: FrameSizeSource }) | null {
  const decoded: Array<[FrameSizeSource, Size | null | undefined]> = [
    ['bitmap', sources.bitmap],
    ['frame', sources.frame],
  ];
  if (usable(sources.element)) {
    const element = sources.element;
    const { bitmap, frame } = sources;
    const disagrees = (size: Size) => isPortrait(size) !== isPortrait(element);
    if (usable(bitmap) && disagrees(bitmap) && (!usable(frame) || disagrees(frame))) {
      return { width: bitmap.width, height: bitmap.height, source: 'bitmap' };
    }
    return { width: element.width, height: element.height, source: 'element' };
  }
  for (const [source, size] of [...decoded, ['settings', sources.settings] as [FrameSizeSource, Size | null | undefined]]) {
    if (usable(size)) return { width: size.width, height: size.height, source };
  }
  return null;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Share of the stage covered by the video element on each axis (1 = fully covered). */
export function stageCoverage(video: Rect, stage: Rect) {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  return {
    x: stage.width > 0 ? overlap(video.left, video.left + video.width, stage.left, stage.left + stage.width) / stage.width : 1,
    y: stage.height > 0 ? overlap(video.top, video.top + video.height, stage.top, stage.top + stage.height) / stage.height : 1,
  };
}

export const COVERAGE_MIN = 0.95;
export const WATCHDOG_RELAYOUT_MS = 300;
export const WATCHDOG_REATTACH_MS = 1500;
export const WATCHDOG_REATTACH_COOLDOWN_MS = 5000;

export interface WatchdogState {
  badSince: number | null;
  relayoutAt: number | null;
  reattachAt: number | null;
}

export function createWatchdog(): WatchdogState {
  return { badSince: null, relayoutAt: null, reattachAt: null };
}

export type WatchdogAction = 'none' | 'relayout' | 'reattach';

/**
 * Something is "bad" when the video element covers less than 95% of the stage on either axis, or
 * the reported stream size disagrees with the decoded frames. After 300 ms of that, force a fresh
 * layout; if it's still bad 1.5 s after that, re-attach the stream and play() (at most every 5 s).
 */
export function stepWatchdog(state: WatchdogState, bad: boolean, now: number): { state: WatchdogState; action: WatchdogAction } {
  if (!bad) return { state: { ...state, badSince: null, relayoutAt: null }, action: 'none' };
  const badSince = state.badSince ?? now;
  if (now - badSince < WATCHDOG_RELAYOUT_MS) return { state: { ...state, badSince }, action: 'none' };
  if (state.relayoutAt === null) return { state: { ...state, badSince, relayoutAt: now }, action: 'relayout' };
  const cooled = state.reattachAt === null || now - state.reattachAt >= WATCHDOG_REATTACH_COOLDOWN_MS;
  if (now - state.relayoutAt >= WATCHDOG_REATTACH_MS && cooled) {
    return { state: { badSince: now, relayoutAt: null, reattachAt: now }, action: 'reattach' };
  }
  return { state: { ...state, badSince }, action: 'none' };
}

/** iPhone/iPad, including iPadOS Safari, which reports itself as a Mac. Every iOS browser runs on WebKit. */
export function isIOSDevice(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }) {
  return /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

export interface StageDiagnostics {
  phase: string;
  fixes: number;
  stage: Size;
  stream: (Size & { source: FrameSizeSource }) | null;
  element: Size;
  frame: Size | null;
  bitmap: Size | null;
  settings: Size | null;
  videoRect: Rect;
  coverage: { x: number; y: number };
  viewport: Size;
  visualViewport: Size | null;
  dpr: number;
  orientation: string;
  readyState: number;
  paused: boolean;
}

const dims = (size: Size | null | undefined) => (size && size.width > 0 && size.height > 0 ? `${Math.round(size.width)}×${Math.round(size.height)}` : '–');
const pct = (value: number) => `${Math.round(value * 100)}%`;

/** The admin overlay / log text: everything needed to tell a small stage from a small video. */
export function describeStage(d: StageDiagnostics) {
  return [
    `${d.phase} · fixes ${d.fixes} · ${d.orientation}`,
    `stage ${dims(d.stage)} · win ${dims(d.viewport)} · vv ${dims(d.visualViewport)} · dpr ${d.dpr}`,
    `stream ${dims(d.stream)} [${d.stream?.source ?? 'none'}] · el ${dims(d.element)} · rvfc ${dims(d.frame)} · bmp ${dims(d.bitmap)} · cfg ${dims(d.settings)}`,
    `video ${dims(d.videoRect)} @ ${Math.round(d.videoRect.left)},${Math.round(d.videoRect.top)} · covers ${pct(d.coverage.x)}×${pct(d.coverage.y)}`,
    `ready ${d.readyState} · ${d.paused ? 'paused' : 'playing'}`,
  ].join('\n');
}

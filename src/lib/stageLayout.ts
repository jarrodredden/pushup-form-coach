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

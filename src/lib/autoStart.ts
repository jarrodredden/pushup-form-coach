/**
 * Hands-free set start. After the rest the volunteer gets into a push-up; holding the top of a
 * push-up for AUTO_START_HOLD_MS starts the countdown, and dropping out of the plank during the
 * countdown sends them back to waiting. Fed from plankPosture() every pose frame.
 */

/** Held top-of-push-up that starts the countdown. */
export const AUTO_START_HOLD_MS = 1500;
/** A frame or two of noise (arms read just under straight) doesn't restart the hold. */
export const HOLD_GRACE_MS = 250;
/** Out of the plank this long during the countdown → back to waiting. */
export const LEFT_POSITION_MS = 600;
/** A manual Start button appears if the position still hasn't been detected after this long. */
export const MANUAL_START_AFTER_MS = 20_000;

export interface PositionWatch {
  topSince: number | null;
  topLostAt: number | null;
  offSince: number | null;
}

export const createPositionWatch = (): PositionWatch => ({ topSince: null, topLostAt: null, offSince: null });

export function watchPosition(
  previous: PositionWatch,
  input: { atTop: boolean; horizontal: boolean; now: number },
): { state: PositionWatch; holding: boolean; left: boolean } {
  const { atTop, horizontal, now } = input;
  let { topSince, topLostAt } = previous;
  if (atTop) {
    topSince ??= now;
    topLostAt = null;
  } else if (topSince !== null) {
    topLostAt ??= now;
    if (now - topLostAt > HOLD_GRACE_MS) {
      topSince = null;
      topLostAt = null;
    }
  }
  const offSince = horizontal ? null : (previous.offSince ?? now);
  return {
    state: { topSince, topLostAt, offSince },
    holding: atTop && topSince !== null && now - topSince >= AUTO_START_HOLD_MS,
    left: offSince !== null && now - offSince >= LEFT_POSITION_MS,
  };
}

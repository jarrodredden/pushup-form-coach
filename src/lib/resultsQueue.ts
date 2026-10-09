/**
 * Unsent result rows for the Google Sheet, kept in localStorage until the sheet confirms them, so a
 * failed, offline, or closed-mid-upload session still lands in the sheet later. Each row carries a
 * session_id; the queue holds at most one row per session and the Apps Script skips ids it already
 * has, so retries and manual taps can't create duplicate rows.
 */
export type ResultRow = Record<string, string | number>;

export interface PendingResult {
  sessionId: string;
  row: ResultRow;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

export const RESULTS_QUEUE_KEY = 'pushup-results-pending';
const QUEUE_LIMIT = 50;
const FIRST_RETRY_MS = 3000;
const MAX_RETRY_MS = 60000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function newSessionId(now = Date.now(), random = Math.random) {
  return `s${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

/** 3 s, 6 s, 12 s, … capped at a minute, for the nth failed attempt. */
export function retryDelayMs(attempts: number) {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

const isPending = (value: unknown): value is PendingResult => {
  const item = value as PendingResult | null;
  return Boolean(item && typeof item.sessionId === 'string' && item.sessionId && item.row && typeof item.row === 'object');
};

export function loadPendingResults(storage: StorageLike = localStorage): PendingResult[] {
  try {
    const parsed = JSON.parse(storage.getItem(RESULTS_QUEUE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

export function savePendingResults(queue: PendingResult[], storage: StorageLike = localStorage) {
  const trimmed = queue.slice(-QUEUE_LIMIT);
  try {
    if (trimmed.length) storage.setItem(RESULTS_QUEUE_KEY, JSON.stringify(trimmed));
    else storage.removeItem(RESULTS_QUEUE_KEY);
  } catch {
    // Storage full or blocked: the in-memory queue still uploads while the page is open.
  }
  return trimmed;
}

/** Adds a session's row, replacing any earlier row for the same session. */
export function enqueueResult(queue: PendingResult[], sessionId: string, row: ResultRow, now: number): PendingResult[] {
  const entry: PendingResult = { sessionId, row: { ...row, session_id: sessionId }, queuedAt: now, attempts: 0, nextAttemptAt: now };
  return [...queue.filter((item) => item.sessionId !== sessionId), entry];
}

export function markResultFailed(queue: PendingResult[], sessionId: string, error: string, now: number): PendingResult[] {
  return queue.map((item) => {
    if (item.sessionId !== sessionId) return item;
    const attempts = item.attempts + 1;
    return { ...item, attempts, lastError: error, nextAttemptAt: now + retryDelayMs(attempts) };
  });
}

export function dropResult(queue: PendingResult[], sessionId: string) {
  return queue.filter((item) => item.sessionId !== sessionId);
}

/** Rows to try now: all of them when forced (load, back online, manual retry), else those whose backoff has passed. */
export function dueResults(queue: PendingResult[], now: number, force = false) {
  return queue.filter((item) => force || item.nextAttemptAt <= now);
}

export function nextAttemptAt(queue: PendingResult[]) {
  return queue.length ? Math.min(...queue.map((item) => item.nextAttemptAt)) : null;
}

/** Reads the Apps Script reply. Older deployments answer just { ok: true }; an unreadable body after HTTP 200 counts as saved. */
export function parseResultUploadResponse(body: unknown): { ok: boolean; duplicate: boolean; error?: string } {
  const reply = body as { ok?: unknown; duplicate?: unknown; error?: unknown } | null;
  if (reply && reply.ok === false) return { ok: false, duplicate: false, error: typeof reply.error === 'string' ? reply.error : 'sheet error' };
  return { ok: true, duplicate: Boolean(reply?.duplicate) };
}

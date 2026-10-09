import { describe, expect, it } from 'vitest';
import {
  dropResult,
  dueResults,
  enqueueResult,
  loadPendingResults,
  markResultFailed,
  newSessionId,
  nextAttemptAt,
  parseResultUploadResponse,
  RESULTS_QUEUE_KEY,
  retryDelayMs,
  savePendingResults,
} from './resultsQueue';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
};

describe('results upload queue', () => {
  it('makes distinct, sortable session ids', () => {
    expect(newSessionId(1_700_000_000_000, () => 0.5)).toMatch(/^s[0-9a-z]+-[0-9a-z]{6}$/);
    expect(newSessionId(1, () => 0.1)).not.toBe(newSessionId(1, () => 0.2));
  });

  it('keeps one row per session and stamps the row with session_id', () => {
    let queue = enqueueResult([], 'a', { volunteer_name: 'Sam', attempt1_score: 70 }, 1000);
    queue = enqueueResult(queue, 'b', { volunteer_name: 'Ana' }, 1100);
    queue = enqueueResult(queue, 'a', { volunteer_name: 'Sam', attempt1_score: 72 }, 1200);
    expect(queue.map((item) => item.sessionId)).toEqual(['b', 'a']);
    expect(queue[1].row).toEqual({ volunteer_name: 'Sam', attempt1_score: 72, session_id: 'a' });
  });

  it('backs off 3 s, 6 s, 12 s … up to a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(retryDelayMs)).toEqual([3000, 6000, 12000, 24000, 48000, 60000, 60000]);
    let queue = enqueueResult([], 'a', {}, 0);
    queue = markResultFailed(queue, 'a', 'HTTP 500', 10_000);
    expect(queue[0]).toMatchObject({ attempts: 1, lastError: 'HTTP 500', nextAttemptAt: 13_000 });
    queue = markResultFailed(queue, 'a', 'HTTP 500', 13_000);
    expect(queue[0].nextAttemptAt).toBe(19_000);
    expect(dueResults(queue, 18_000)).toEqual([]);
    expect(dueResults(queue, 18_000, true)).toHaveLength(1);
    expect(dueResults(queue, 19_000)).toHaveLength(1);
    expect(nextAttemptAt(queue)).toBe(19_000);
    expect(nextAttemptAt(dropResult(queue, 'a'))).toBeNull();
  });

  it('survives a reload through storage and ignores junk', () => {
    const storage = memoryStorage();
    savePendingResults(enqueueResult([], 'a', { reps: 10 }, 5), storage);
    expect(loadPendingResults(storage)).toEqual([{ sessionId: 'a', row: { reps: 10, session_id: 'a' }, queuedAt: 5, attempts: 0, nextAttemptAt: 5 }]);
    savePendingResults([], storage);
    expect(storage.data.has(RESULTS_QUEUE_KEY)).toBe(false);
    storage.setItem(RESULTS_QUEUE_KEY, '{not json');
    expect(loadPendingResults(storage)).toEqual([]);
    storage.setItem(RESULTS_QUEUE_KEY, JSON.stringify([{ nope: 1 }, { sessionId: 'x', row: {} }]));
    expect(loadPendingResults(storage).map((item) => item.sessionId)).toEqual(['x']);
  });

  it('reads old and new Apps Script replies', () => {
    expect(parseResultUploadResponse({ ok: true })).toEqual({ ok: true, duplicate: false });
    expect(parseResultUploadResponse({ ok: true, duplicate: true })).toEqual({ ok: true, duplicate: true });
    expect(parseResultUploadResponse({ ok: false, error: 'Lock timeout' })).toEqual({ ok: false, duplicate: false, error: 'Lock timeout' });
    expect(parseResultUploadResponse(null)).toEqual({ ok: true, duplicate: false });
  });
});

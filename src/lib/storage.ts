import { SessionEntry } from './types';

export function loadHistory(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SessionEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(storageKey: string, history: SessionEntry[]) {
  localStorage.setItem(storageKey, JSON.stringify(history));
}

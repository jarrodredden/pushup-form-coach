const VOICE_CLIP_ROOT = '/voices';
const VOICE_QUEUE_LIMIT = 10;

type VoiceQueueItem = {
  clip: string;
  fallback: string;
};

const voiceQueue: VoiceQueueItem[] = [];
let voiceBusy = false;
let activeAudio: HTMLAudioElement | null = null;
const preloadedClips = new Map<string, HTMLAudioElement>();

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clipNamesForMessage(message: string): string[] | null {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  if (/^ready$/i.test(normalized)) return ['ready'];
  if (/^go$/i.test(normalized)) return ['go'];
  if (/^[1-5]$/.test(normalized)) return [`countdown-${normalized}`];

  const repMatch = normalized.match(/^rep\s+(\d{1,2})(?:[.,]\s*.*)?$/i);
  if (repMatch) return [`rep-${repMatch[1]}`];

  return [slugify(normalized)];
}

export function resolveVoiceClipNames(message: string) {
  return clipNamesForMessage(message);
}

function queueClip(clip: string, fallback: string) {
  if (voiceQueue.length >= VOICE_QUEUE_LIMIT) {
    voiceQueue.shift();
  }
  voiceQueue.push({ clip, fallback });
}

function clipUrl(clip: string) {
  return `${VOICE_CLIP_ROOT}/${clip}.mp3`;
}

function queueFallbackSpeech(message: string) {
  if (!('speechSynthesis' in window)) return false;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'en-US';
    utterance.rate = 0.98;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

function playNextClip() {
  if (voiceBusy) return;
  const next = voiceQueue.shift();
  if (!next) return;

  voiceBusy = true;
  const audio = new Audio(clipUrl(next.clip));
  audio.preload = 'auto';
  activeAudio = audio;

  const finish = () => {
    if (activeAudio === audio) {
      activeAudio = null;
    }
    voiceBusy = false;
    playNextClip();
  };

  audio.onended = finish;
  audio.onerror = () => {
    const fallbackPlayed = queueFallbackSpeech(next.fallback);
    if (!fallbackPlayed) {
      // Keep moving even if the fallback isn't available.
    }
    finish();
  };

  try {
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      void result.catch(() => {
        const fallbackPlayed = queueFallbackSpeech(next.fallback);
        if (!fallbackPlayed) {
          // Keep moving even if the fallback isn't available.
        }
        finish();
      });
    }
  } catch {
    const fallbackPlayed = queueFallbackSpeech(next.fallback);
    if (!fallbackPlayed) {
      // Keep moving even if the fallback isn't available.
    }
    finish();
  }
}


export function preloadVoiceClips(clips: string[]) {
  if (typeof window === 'undefined') return;
  for (const clip of clips) {
    if (preloadedClips.has(clip)) continue;
    const audio = new Audio(clipUrl(clip));
    audio.preload = 'auto';
    audio.load();
    preloadedClips.set(clip, audio);
  }
}

export function playVoiceMessage(message: string) {
  if (typeof window === 'undefined') return;
  const normalized = message.trim();
  if (!normalized) return;

  const clips = clipNamesForMessage(normalized);
  if (!clips) {
    queueFallbackSpeech(normalized);
    return;
  }

  const lastQueued = voiceQueue[voiceQueue.length - 1];
  if (lastQueued?.fallback === normalized) return;
  for (const clip of clips) {
    queueClip(clip, normalized);
  }
  playNextClip();
}

export function playVoiceClip(clip: string, fallback: string) {
  if (typeof window === 'undefined') return;
  queueClip(clip, fallback);
  playNextClip();
}

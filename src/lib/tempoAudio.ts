import downClip from '../assets/tempo/down.wav?inline';
import upClip from '../assets/tempo/up.wav?inline';
import type { TempoCue } from './tempoCues';

/**
 * Low-latency playback for the Up / Down tempo cues. The clips are inlined into the JS bundle (so
 * they work from file:// in the offline package, where fetch() is unavailable), decoded once into
 * AudioBuffers when sound is unlocked, and played with an AudioBufferSourceNode the moment a cue
 * fires. They never go through the voice-clip queue, HTMLAudioElement, or speechSynthesis.
 */
const CLIP_DATA: Record<TempoCue, string> = { up: upClip, down: downClip };
/** Anything quieter than this (~ -40 dBFS) at the start or end of a clip counts as silence. */
const SILENCE_THRESHOLD = 0.01;
const CUE_GAIN = 1;

const buffers = new Map<TempoCue, AudioBuffer>();
let loading: Promise<boolean> | null = null;
let loadedFor: BaseAudioContext | null = null;
let active: AudioBufferSourceNode | null = null;

function dataUrlToArrayBuffer(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** First and last sample index above the threshold on any channel (end is exclusive). */
export function audibleRange(channels: Float32Array[], threshold = SILENCE_THRESHOLD) {
  const length = channels[0]?.length ?? 0;
  let start = length;
  let end = 0;
  for (const data of channels) {
    for (let index = 0; index < length; index += 1) {
      if (Math.abs(data[index]) > threshold) {
        start = Math.min(start, index);
        break;
      }
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      if (Math.abs(data[index]) > threshold) {
        end = Math.max(end, index + 1);
        break;
      }
    }
  }
  return start < end ? { start, end } : { start: 0, end: length };
}

/** Drops any leading/trailing silence left after decoding (resampling can pad a few samples). */
function trimBuffer(context: BaseAudioContext, buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const { start, end } = audibleRange(channels);
  if (start === 0 && end === buffer.length) return buffer;
  const trimmed = context.createBuffer(buffer.numberOfChannels, end - start, buffer.sampleRate);
  channels.forEach((data, index) => trimmed.copyToChannel(data.subarray(start, end), index));
  return trimmed;
}

function decode(context: BaseAudioContext, data: ArrayBuffer) {
  // Promise form first; old WebKit only supports the callback form.
  return new Promise<AudioBuffer>((resolve, reject) => {
    const result = context.decodeAudioData(data, resolve, reject);
    if (result && typeof result.then === 'function') result.then(resolve, reject);
  });
}

/** Decodes both clips for this context. Safe to call repeatedly; resolves true once they're ready. */
export function loadTempoCues(context: BaseAudioContext): Promise<boolean> {
  if (loadedFor === context && loading) return loading;
  loadedFor = context;
  buffers.clear();
  loading = Promise.all(
    (Object.keys(CLIP_DATA) as TempoCue[]).map(async (cue) => {
      buffers.set(cue, trimBuffer(context, await decode(context, dataUrlToArrayBuffer(CLIP_DATA[cue]))));
    }),
  )
    .then(() => true)
    .catch(() => {
      loading = null;
      return false;
    });
  return loading;
}

export function tempoCuesReady(context: BaseAudioContext | null) {
  return Boolean(context && loadedFor === context && buffers.size === Object.keys(CLIP_DATA).length);
}

export function tempoCueDurationMs(cue: TempoCue) {
  const buffer = buffers.get(cue);
  return buffer ? buffer.duration * 1000 : 0;
}

/** Browser-reported time from start() to the speaker, in ms (0 when the browser doesn't say). */
export function audioOutputLatencyMs(context: AudioContext) {
  const base = Number.isFinite(context.baseLatency) ? context.baseLatency : 0;
  const output = 'outputLatency' in context && Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
  return (base + output) * 1000;
}

/**
 * Plays a cue right now, cutting off the previous cue if it's still sounding. Returns the clip
 * length in ms, or null if the clips aren't decoded for this context yet.
 */
export function playTempoCue(context: AudioContext, cue: TempoCue): number | null {
  const buffer = loadedFor === context ? buffers.get(cue) : undefined;
  if (!buffer) return null;
  if (context.state !== 'running') void context.resume().catch(() => undefined);
  if (active) {
    try {
      active.stop();
    } catch {
      // Already finished.
    }
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = CUE_GAIN;
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => {
    if (active === source) active = null;
    gain.disconnect();
  };
  source.start();
  active = source;
  return buffer.duration * 1000;
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { audibleRange } from './tempoAudio';

/** Reads a 16-bit PCM WAV's samples (as written by scripts/generate-tempo-cues.mjs). */
function readWav(path: string) {
  const file = readFileSync(path);
  expect(file.toString('ascii', 0, 4)).toBe('RIFF');
  let offset = 12;
  let sampleRate = 0;
  while (offset < file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      expect(file.readUInt16LE(offset + 8)).toBe(1);
      expect(file.readUInt16LE(offset + 22)).toBe(16);
      sampleRate = file.readUInt32LE(offset + 12);
    }
    if (id === 'data') {
      const samples = new Float32Array(size / 2);
      for (let index = 0; index < samples.length; index += 1) samples[index] = file.readInt16LE(offset + 8 + index * 2) / 32768;
      return { samples, sampleRate };
    }
    offset += 8 + size;
  }
  throw new Error('no data chunk');
}

describe('tempo clips', () => {
  for (const cue of ['up', 'down']) {
    it(`${cue}.wav is short and starts on the word (no leading silence)`, () => {
      const { samples, sampleRate } = readWav(`src/assets/tempo/${cue}.wav`);
      const durationMs = (samples.length / sampleRate) * 1000;
      expect(durationMs).toBeGreaterThan(120);
      expect(durationMs).toBeLessThan(450);
      const { start, end } = audibleRange([samples]);
      expect((start / sampleRate) * 1000).toBeLessThan(5);
      expect(((samples.length - end) / sampleRate) * 1000).toBeLessThan(25);
    });
  }

  it('audibleRange finds the first and last sample above the threshold', () => {
    const data = new Float32Array([0, 0.001, 0, 0.5, -0.4, 0.2, 0.002, 0]);
    expect(audibleRange([data])).toEqual({ start: 3, end: 6 });
    expect(audibleRange([new Float32Array(4)])).toEqual({ start: 0, end: 4 });
  });
});

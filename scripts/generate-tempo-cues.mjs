/* global fetch, Buffer, console, process */
/**
 * Builds the real-time "Up" / "Down" tempo clips (src/assets/tempo/*.wav) from the same Google TTS
 * voice as public/voices. Needs ffmpeg on PATH. Each clip is trimmed to the speech itself (no leading
 * or trailing silence), sped up slightly so it lands crisply, peak-normalized, and written as 16-bit
 * PCM WAV: unlike MP3 there's no encoder delay, so the first sample is the start of the word.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import googleTTS from 'google-tts-api';

const OUT_DIR = path.resolve('src/assets/tempo');
const CUES = [
  ['up', 'Up!'],
  ['down', 'Down!'],
];
const SPEED = 1.2;
const PEAK_DB = -1;
const GATE = 'start_periods=1:start_threshold=-45dB:start_silence=0.002';

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** ffmpeg prints volumedetect stats on stderr. */
function peakDb(file) {
  const stats = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostdin -i "${file}" -af volumedetect -f null - 2>&1`], { encoding: 'utf8' });
  const match = /max_volume: (-?[\d.]+) dB/.exec(stats);
  if (!match) throw new Error(`Couldn't read the peak level of ${file}`);
  return Number(match[1]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'tempo-cues-'));
  for (const [name, text] of CUES) {
    const url = googleTTS.getAudioUrl(text, { lang: 'en-US', slow: false, host: 'https://translate.google.com' });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TTS download failed for "${text}": ${response.status}`);
    const source = path.join(work, `${name}.mp3`);
    const trimmed = path.join(work, `${name}-trimmed.wav`);
    await fs.writeFile(source, Buffer.from(await response.arrayBuffer()));
    // Trim both ends (reverse → trim → reverse), then speed up without changing pitch.
    ffmpeg(['-i', source, '-af', `silenceremove=${GATE},areverse,silenceremove=${GATE},areverse,atempo=${SPEED}`, '-ac', '1', '-ar', '24000', trimmed]);
    const peak = peakDb(trimmed);
    const target = path.join(OUT_DIR, `${name}.wav`);
    ffmpeg([
      '-i',
      trimmed,
      '-af',
      `volume=${(PEAK_DB - peak).toFixed(2)}dB,afade=t=in:d=0.003,areverse,afade=t=in:d=0.012,areverse`,
      '-c:a',
      'pcm_s16le',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      target,
    ]);
    const duration = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target], { encoding: 'utf8' }).trim();
    console.log(`${path.relative(process.cwd(), target)}: ${Math.round(Number(duration) * 1000)} ms`);
  }
  await fs.rm(work, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

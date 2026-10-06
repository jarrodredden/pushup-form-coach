/* global fetch, Buffer, console, process */
import fs from 'node:fs/promises';
import path from 'node:path';
import googleTTS from 'google-tts-api';

const OUT_DIR = path.resolve('public/voices');
const FORCE = process.argv.includes('--force');

// Shared with src/lib/repFeedback.ts: corrective in-set cues plus the end-of-set/session wrap-ups.
const feedback = JSON.parse(await fs.readFile(path.resolve('src/lib/feedbackLines.json'), 'utf8'));

function sessionWrapUp(points) {
  if (points > 0) return feedback.sessionImproved.replace('{n}', String(points)).replace('{points}', points === 1 ? 'point' : 'points');
  return points === 0 ? feedback.sessionSteady : feedback.sessionDeclined;
}

const feedbackLines = [
  ...Object.values(feedback.corrective).flat(),
  feedback.neutral,
  feedback.set1Done,
  ...Array.from({ length: feedback.maxImprovementClip }, (_, i) => sessionWrapUp(i + 1)),
  sessionWrapUp(0),
  sessionWrapUp(-1),
];

const tips = [
  'Go a little deeper while keeping hips level',
  "Don't pike, hips down",
  "Don't sag, squeeze your belly",
  'Go a little deeper.',
  'Tuck elbows in.',
  'Hands under shoulders.',
  'Keep head centered.',
  'Back up for hands and torso.',
  'Keep hips level.',
];

const files = [
  ['ready', 'Ready!'],
  ['calibration-complete', 'Calibration complete!'],
  ['get-ready', 'Get ready!'],
  ['lets-get-started', "Let's get started!"],
  ['go', 'Go!'],
  ...Array.from({ length: 5 }, (_, i) => [`countdown-${i + 1}`, `${i + 1}!`]),
  ...Array.from({ length: 20 }, (_, i) => [`rep-${i + 1}`, `Rep ${i + 1}`]),
  ...tips.map((text) => [slugify(text), text]),
  ...feedbackLines.map((text) => [slugify(text), text]),
];

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, data);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const [name, text] of files) {
    const targetPath = path.join(OUT_DIR, `${name}.mp3`);
    if (!FORCE && (await fs.stat(targetPath).catch(() => null))) continue;
    const url = googleTTS.getAudioUrl(text, {
      lang: 'en-US',
      slow: false,
      host: 'https://translate.google.com',
    });
    process.stdout.write(`Generating ${path.relative(process.cwd(), targetPath)} ... `);
    await downloadFile(url, targetPath);
    console.log('done');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

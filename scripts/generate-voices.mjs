/* global fetch, Buffer, console, process */
import fs from 'node:fs/promises';
import path from 'node:path';
import googleTTS from 'google-tts-api';

const OUT_DIR = path.resolve('public/voices');

const encouragements = {
  low: [
    "You've got this — drop a bit lower next one.",
    "Shake it off — next one's yours.",
    'Nice try — a little deeper next rep.',
    'Keep going — just a bit lower.',
    'You can do it — one more notch deeper.',
  ],
  mid: [
    "Good rep — a little more depth and you're golden.",
    'Nice work — keep that one coming.',
    'Solid — a touch deeper next time.',
    "Good job — that's moving the right way.",
    'Strong rep — keep chasing the depth.',
  ],
  high: [
    'Nice! That was a strong one.',
    'Yes! Deep and solid!',
    'Great one — keep that energy.',
    'Awesome rep — that was clean.',
    "Big rep — you're flying now.",
  ],
};

const tips = [
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
  ...Object.values(encouragements).flatMap((phrases) => phrases.map((text) => [slugify(text), text])),
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

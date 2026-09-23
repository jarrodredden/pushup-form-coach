/* global fetch, Buffer, console, process */
import fs from 'node:fs/promises';
import path from 'node:path';
import googleTTS from 'google-tts-api';

const OUT_DIR = path.resolve('public/voices');

const encouragements = {
  low: [
    'You can do better — keep going.',
    'Build that rep a little more.',
    'Try for more depth next time.',
  ],
  mid: [
    'Good job — keep that body line tight.',
    'Nice rep — stay strong and steady.',
    'Good work — keep that plank tight.',
  ],
  high: [
    'Great work — keep that depth.',
    'Awesome rep — stay tight.',
    'Great rep — strong and clean.',
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
  ['ready', 'Ready'],
  ['go', 'Go'],
  ...Array.from({ length: 5 }, (_, i) => [`countdown-${i + 1}`, String(i + 1)]),
  ...Array.from({ length: 20 }, (_, i) => [`rep-${i + 1}`, `Rep ${i + 1}`]),
  ...tips.map((text) => [slugify(text), text]),
  ...Object.entries(encouragements).flatMap(([, phrases]) => phrases.map((text) => [slugify(text), text])),
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

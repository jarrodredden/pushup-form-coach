// Builds the self-contained offline package (no CDN, no network) and zips it.
//   node scripts/build-offline.mjs                 -> release/pushup-form-coach-offline.zip
//   node scripts/build-offline.mjs --copy-to DIR   -> also copies the zip into DIR (used to publish it on Vercel)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-offline');
const releaseDir = join(root, 'release');
const packageFolder = 'pushup-form-coach-offline';
const zipName = `${packageFolder}.zip`;
const copyToIndex = process.argv.indexOf('--copy-to');
const copyTo = copyToIndex > -1 ? join(root, process.argv[copyToIndex + 1]) : null;

await build({ root, mode: 'offline', logLevel: 'warn', configFile: join(root, 'vite.config.ts') });

// file:// pages can't load module scripts or crossorigin stylesheets from disk, so inline them.
const indexPath = join(outDir, 'index.html');
let html = readFileSync(indexPath, 'utf8');
const scriptTag = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
const styleTag = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/);
if (!scriptTag || !styleTag) {
  throw new Error('Offline build: could not find the app script/style tags to inline.');
}
const js = readFileSync(join(outDir, scriptTag[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(outDir, styleTag[1]), 'utf8');
html = html
  .replace(scriptTag[0], () => '')
  .replace(styleTag[0], () => `<style>${css}</style>`)
  .replace('</body>', () => `<script type="module">\n${js}\n</script>\n</body>`);
writeFileSync(indexPath, html);
rmSync(join(outDir, 'assets'), { recursive: true, force: true });

// MediaPipe WASM + pose model, embedded as base64 in classic scripts (the only script type file:// allows).
const wasmDir = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const poseData = [
  ['wasm-loader.js', 'wasmLoader', join(wasmDir, 'vision_wasm_internal.js')],
  ['wasm-binary.js', 'wasmBinary', join(wasmDir, 'vision_wasm_internal.wasm')],
  ['model.js', 'model', join(root, 'public/models/pose_landmarker_lite.task')],
];
mkdirSync(join(outDir, 'pose-data'), { recursive: true });
for (const [file, key, source] of poseData) {
  const base64 = readFileSync(source).toString('base64');
  writeFileSync(join(outDir, 'pose-data', file), `(window.__PUSHUP_OFFLINE__=window.__PUSHUP_OFFLINE__||{}).${key}="${base64}";\n`);
}

cpSync(join(root, 'public/voices'), join(outDir, 'voices'), { recursive: true });
cpSync(join(root, 'scripts/offline/README-OFFLINE.txt'), join(outDir, 'README-OFFLINE.txt'));

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[`${packageFolder}/${relative(outDir, full).split('\\').join('/')}`] = [readFileSync(full), { level: name.endsWith('.mp3') ? 0 : 6 }];
  }
};
walk(outDir);
const zipped = zipSync(files);

mkdirSync(releaseDir, { recursive: true });
writeFileSync(join(releaseDir, zipName), zipped);
if (copyTo) {
  if (!existsSync(copyTo)) mkdirSync(copyTo, { recursive: true });
  writeFileSync(join(copyTo, zipName), zipped);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`Offline package: release/${zipName} (${mb(zipped.length)}, ${Object.keys(files).length} files)${copyTo ? `, copied to ${relative(root, copyTo)}/` : ''}`);

import { FilesetResolver } from '@mediapipe/tasks-vision';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export const POSE_MODEL_FILE = 'models/pose_landmarker_lite.task';
export const OFFLINE_DATA_FILES = ['pose-data/wasm-loader.js', 'pose-data/wasm-binary.js', 'pose-data/model.js'] as const;

interface EmbeddedPoseData {
  wasmLoader?: string;
  wasmBinary?: string;
  model?: string;
}

declare global {
  interface Window {
    __PUSHUP_OFFLINE__?: EmbeddedPoseData;
  }
}

export interface PoseAssets {
  fileset: WasmFileset;
  baseOptions: { modelAssetPath: string } | { modelAssetBuffer: Uint8Array };
}

export const isOfflinePackage = import.meta.env.MODE === 'offline';

const assetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

export function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Chrome blocks fetch() and CORS-mode scripts from file:// pages, but still runs plain classic
// <script src> tags. The offline package therefore ships its binaries as base64 inside classic scripts.
function loadClassicScript(path: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl(path);
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${path}`));
    document.head.appendChild(script);
  });
}

async function loadEmbeddedAssets(): Promise<PoseAssets> {
  await Promise.all(OFFLINE_DATA_FILES.map(loadClassicScript));
  const data = window.__PUSHUP_OFFLINE__;
  if (!data?.wasmLoader || !data.wasmBinary || !data.model) {
    throw new Error('Offline pose data is missing from the package.');
  }
  const loader = new Blob([base64ToBytes(data.wasmLoader)], { type: 'text/javascript' });
  const wasm = new Blob([base64ToBytes(data.wasmBinary)], { type: 'application/wasm' });
  const model = base64ToBytes(data.model);
  delete window.__PUSHUP_OFFLINE__;
  return {
    fileset: { wasmLoaderPath: URL.createObjectURL(loader), wasmBinaryPath: URL.createObjectURL(wasm) },
    baseOptions: { modelAssetBuffer: model },
  };
}

export async function loadPoseAssets(): Promise<PoseAssets> {
  if (isOfflinePackage) return loadEmbeddedAssets();
  return {
    fileset: await FilesetResolver.forVisionTasks(assetUrl('mediapipe')),
    baseOptions: { modelAssetPath: assetUrl(POSE_MODEL_FILE) },
  };
}

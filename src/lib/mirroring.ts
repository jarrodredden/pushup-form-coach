import { CameraFacing } from './types';

export function shouldMirrorPreview(facing: CameraFacing) {
  return facing === 'user';
}

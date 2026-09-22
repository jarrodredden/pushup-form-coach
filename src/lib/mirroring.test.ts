import { describe, expect, it } from 'vitest';
import { shouldMirrorPreview } from './mirroring';

describe('mirror rules', () => {
  it('mirrors the selfie camera preview', () => {
    expect(shouldMirrorPreview('user')).toBe(true);
  });

  it('does not mirror the back camera preview', () => {
    expect(shouldMirrorPreview('environment')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveVoiceClipNames } from './voiceAudio';

describe('voice clip resolution', () => {
  it('resolves coaching phrases to generated clips', () => {
    expect(resolveVoiceClipNames('Nice! That was a strong one.')).toEqual(['nice-that-was-a-strong-one']);
    expect(resolveVoiceClipNames('Go a little deeper')).toEqual(['go-a-little-deeper']);
  });

  it('resolves countdown phrases to clip names', () => {
    expect(resolveVoiceClipNames('5')).toEqual(['countdown-5']);
    expect(resolveVoiceClipNames("Let's get started!")).toEqual(['lets-get-started']);
  });
});

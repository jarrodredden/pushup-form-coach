import { describe, expect, it } from 'vitest';
import { resolveVoiceClipNames } from './voiceAudio';

describe('voice clip resolution', () => {
  it('resolves coaching phrases to generated clips', () => {
    expect(resolveVoiceClipNames('Tuck your elbows.')).toEqual(['tuck-your-elbows']);
    expect(resolveVoiceClipNames('Great work! You improved by 12 points from set 1 to set 2.')).toEqual([
      'great-work-you-improved-by-12-points-from-set-1-to-set-2',
    ]);
    expect(resolveVoiceClipNames('Go a little deeper')).toEqual(['go-a-little-deeper']);
  });

  it('resolves countdown phrases to clip names', () => {
    expect(resolveVoiceClipNames('5')).toEqual(['countdown-5']);
    expect(resolveVoiceClipNames("Let's get started!")).toEqual(['lets-get-started']);
  });
});

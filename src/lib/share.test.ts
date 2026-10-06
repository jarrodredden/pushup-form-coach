import { afterEach, describe, expect, it, vi } from 'vitest';
import { canWebShare, copyText, qrPath, SHARE_URL } from './share';

const linkElement = {} as HTMLElement;

function stubSelection() {
  const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
  const range = { selectNodeContents: vi.fn() };
  vi.stubGlobal('window', { getSelection: () => selection });
  return { selection, range };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('share page', () => {
  it('always shares the public site', () => {
    expect(SHARE_URL).toBe('https://pushup-form-coach.vercel.app');
  });

  it('builds a square QR code with the three finder patterns', () => {
    const { size, path } = qrPath(SHARE_URL);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    const dark = new Set([...path.matchAll(/M(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`));
    for (const [x, y] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      expect(dark.has(`${x},${y}`)).toBe(true);
      expect(dark.has(`${x + 6},${y + 6}`)).toBe(true);
      expect(dark.has(`${x + 3},${y + 3}`)).toBe(true);
      expect(dark.has(`${x + 1},${y + 1}`)).toBe(false);
    }
  });

  it('copies with the Clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText(SHARE_URL, linkElement)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(SHARE_URL);
  });

  it('falls back to selecting the text and execCommand', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const { selection, range } = stubSelection();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', { execCommand, createRange: () => range });
    expect(await copyText(SHARE_URL, linkElement)).toBe('copied');
    expect(range.selectNodeContents).toHaveBeenCalledWith(linkElement);
    expect(selection.addRange).toHaveBeenCalledWith(range);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('leaves the link selected when copying is blocked', async () => {
    vi.stubGlobal('navigator', {});
    const { selection, range } = stubSelection();
    vi.stubGlobal('document', { execCommand: vi.fn().mockReturnValue(false), createRange: () => range });
    expect(await copyText(SHARE_URL, linkElement)).toBe('selected');
    expect(selection.addRange).toHaveBeenCalledWith(range);
  });

  it('only offers Share where the Web Share API exists', () => {
    vi.stubGlobal('navigator', {});
    expect(canWebShare()).toBe(false);
    vi.stubGlobal('navigator', { share: vi.fn() });
    expect(canWebShare()).toBe(true);
  });
});

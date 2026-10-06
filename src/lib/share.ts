import qrcode from 'qrcode-generator';

/** Always the public site, including from the offline package (its own address is a file:// path). */
export const SHARE_URL = 'https://pushup-form-coach.vercel.app';
export const SHARE_TITLE = 'Push-up Form Coach';
export const SHARE_TEXT = 'Try the Push-up Form Coach from our science fair project!';

/** QR modules for `text` as an SVG path in module units (one `h1v1h-1z` square per dark module). */
export function qrPath(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}

export type CopyResult = 'copied' | 'selected';

function selectContents(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Copies with the async Clipboard API, then the older execCommand route. If both are blocked the
 * link text is left selected so the volunteer can copy it by hand.
 */
export async function copyText(text: string, element: HTMLElement | null): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Permission denied or not a secure context: fall through.
  }
  if (element) {
    selectContents(element);
    try {
      if (document.execCommand('copy')) return 'copied';
    } catch {
      // Leave it selected.
    }
  }
  return 'selected';
}

/** Selects the link text, e.g. when it's tapped. */
export function selectLinkText(element: HTMLElement) {
  selectContents(element);
}

export function canWebShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Opens the system share sheet. Returns false if the volunteer cancelled or sharing failed. */
export async function webShare() {
  try {
    await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
    return true;
  } catch {
    return false;
  }
}

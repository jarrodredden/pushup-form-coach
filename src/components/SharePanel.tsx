import { useEffect, useMemo, useRef, useState } from 'react';
import { canWebShare, copyText, qrPath, selectLinkText, SHARE_URL, webShare, type CopyResult } from '../lib/share';
import { CheckIcon, CopyIcon, ShareIcon } from './Icons';

interface SharePanelProps {
  name: string;
}

const COPIED_MS = 2200;
const SCHEME = 'https://';

export function SharePanel({ name }: SharePanelProps) {
  const linkRef = useRef<HTMLParagraphElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const shareAvailable = useMemo(canWebShare, []);
  const qr = useMemo(() => qrPath(SHARE_URL), []);
  const firstName = name.trim().split(/\s+/)[0];

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copy = async () => {
    const result = await copyText(SHARE_URL, linkRef.current);
    setCopyResult(result);
    setCopied(result === 'copied');
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    if (result === 'copied') {
      resetTimerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    }
  };

  return (
    <div className="share">
      <header className="share__head">
        <p className="eyebrow">{firstName ? `All done, ${firstName}!` : 'All done!'}</p>
        <h1>Thanks for helping with our science fair project!</h1>
        <p className="share__lead">Share this with others so they can try it too.</p>
      </header>

      <section className="card share__card">
        <figure className="share__qr">
          <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label={`QR code for ${SHARE_URL}`} shapeRendering="crispEdges">
            <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.path} fill="#0a0c0f" />
          </svg>
          <figcaption>Scan with a phone camera</figcaption>
        </figure>

        <div className="share__actions">
          <div className="share__link-box">
            <span className="field__label">Link</span>
            <p ref={linkRef} className="share__link" onClick={(event) => selectLinkText(event.currentTarget)}>
              {SCHEME}
              <wbr />
              <span className="share__host">{SHARE_URL.slice(SCHEME.length)}</span>
            </p>
          </div>
          <button className={`btn btn--primary btn--xl btn--block${copied ? ' is-copied' : ''}`} onClick={copy}>
            {copied ? (
              <>
                <CheckIcon /> Copied!
              </>
            ) : (
              <>
                <CopyIcon /> Copy link
              </>
            )}
          </button>
          {shareAvailable ? (
            <button className="btn btn--secondary btn--xl btn--block" onClick={() => void webShare()}>
              <ShareIcon /> Share
            </button>
          ) : null}
          <p id="share-copy-status" className="share__status" role="status" aria-live="polite">
            {copyResult === 'copied'
              ? 'Link copied. Paste it into a message or email.'
              : copyResult === 'selected'
                ? 'The link is selected. Press Ctrl+C (or ⌘C) to copy it.'
                : ''}
          </p>
        </div>
      </section>
    </div>
  );
}

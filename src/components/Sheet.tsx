import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface SheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, subtitle, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-root" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__grip" aria-hidden="true" />
        <header className="sheet__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="sheet__subtitle">{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
            <CloseIcon />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}

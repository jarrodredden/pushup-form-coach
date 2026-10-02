import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Point = { x: number; y: number };

interface SignaturePadProps {
  label: string;
  hint?: string;
  onChange: (dataUrl: string | null) => void;
}

/** Ink shorter than this (CSS px) reads as a stray tap, not a signature. */
const MIN_INK_PX = 60;
const PAD_HEIGHT = 170;

export function SignaturePad({ label, hint, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const inkRef = useRef(0);
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (!stroke.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 320;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(PAD_HEIGHT * ratio);
      redraw();
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [redraw]);

  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const emit = () => {
    const signed = inkRef.current >= MIN_INK_PX;
    setHasInk(strokesRef.current.length > 0);
    onChange(signed && canvasRef.current ? canvasRef.current.toDataURL('image/png') : null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointFor(event)]);
    redraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current.at(-1);
    if (!stroke) return;
    const native = event.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const rect = event.currentTarget.getBoundingClientRect();
    const points = events.length
      ? events.map((coalesced) => ({ x: coalesced.clientX - rect.left, y: coalesced.clientY - rect.top }))
      : [pointFor(event)];
    for (const point of points) {
      const last = stroke.at(-1)!;
      inkRef.current += Math.hypot(point.x - last.x, point.y - last.y);
      stroke.push(point);
    }
    redraw();
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emit();
  };

  const clear = () => {
    strokesRef.current = [];
    inkRef.current = 0;
    redraw();
    emit();
  };

  return (
    <div className="signature">
      <div className="signature__head">
        <span className="field__label">{label}</span>
        <button type="button" className="btn btn--ghost btn--small" onClick={clear} disabled={!hasInk}>
          Clear
        </button>
      </div>
      <div className="signature__pad">
        <canvas
          ref={canvasRef}
          className="signature__canvas"
          style={{ height: PAD_HEIGHT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
          role="img"
          aria-label={`${label} pad. Draw your signature with a finger, stylus, or mouse.`}
        />
        {!hasInk ? <span className="signature__placeholder" aria-hidden="true">Sign here</span> : null}
        <span className="signature__line" aria-hidden="true" />
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export function MetricBar({ label, value, hint, emptyLabel = '—' }: { label: string; value: number | null; hint?: string; emptyLabel?: string }) {
  const actual = value ?? 0;
  const tone = value === null ? 'none' : actual >= 80 ? 'good' : actual >= 60 ? 'mid' : 'low';
  return (
    <div className={`metric metric--${tone}`}>
      <div className="metric__head">
        <span>{label}</span>
        <strong>{value === null ? emptyLabel : Math.round(actual)}</strong>
      </div>
      <div className="metric__track" role="presentation">
        <span style={{ width: `${clamp(actual)}%` }} />
      </div>
      {hint ? <p className="metric__hint">{hint}</p> : null}
    </div>
  );
}

export function CompareBar({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  const delta = before === null || after === null ? null : Math.round(after - before);
  return (
    <div className="compare">
      <div className="compare__head">
        <span>{label}</span>
        <span className={delta !== null && delta > 0 ? 'delta delta--up' : delta !== null && delta < 0 ? 'delta delta--down' : 'delta'}>
          {delta === null ? 'n/a' : delta > 0 ? `+${delta}` : delta}
        </span>
      </div>
      <div className="compare__row">
        <span className="compare__tag">1</span>
        <div className="compare__track"><span className="compare__fill compare__fill--before" style={{ width: `${clamp(before ?? 0)}%` }} /></div>
        <strong>{before === null ? 'n/a' : Math.round(before)}</strong>
      </div>
      <div className="compare__row">
        <span className="compare__tag compare__tag--after">2</span>
        <div className="compare__track"><span className="compare__fill compare__fill--after" style={{ width: `${clamp(after ?? 0)}%` }} /></div>
        <strong>{after === null ? 'n/a' : Math.round(after)}</strong>
      </div>
    </div>
  );
}

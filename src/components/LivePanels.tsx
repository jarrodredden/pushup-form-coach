import type { SetSummary } from '../lib/sessionFlow';
import type { SessionRep } from '../lib/types';
import { CheckIcon } from './Icons';
import { MetricBar } from './MetricBar';
import { SpokenTipsSwitch } from './SetupPanel';

export interface ChecklistItem {
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

export function CalibratingPanel({ checklist, tip, waitingForBody }: { checklist: ChecklistItem[]; tip: string; waitingForBody: boolean }) {
  return (
    <section className="card live-card">
      <h2 className="card__title">Get into frame</h2>
      <p className="live-card__lead">{tip}</p>
      {waitingForBody ? (
        <p className="fine-print">Looking for you… get into the top of a push-up facing the phone.</p>
      ) : (
        <ul className="checklist">
          {checklist.map((item) => (
            <li key={item.label} className={item.ok ? 'checklist__item is-ok' : 'checklist__item'}>
              <span className="checklist__mark" aria-hidden="true">{item.ok ? <CheckIcon size={14} /> : null}</span>
              <span className="checklist__label">
                {item.label}
                {!item.required ? <em> · coaching</em> : null}
              </span>
              <span className="checklist__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="fine-print">You don’t need 100% — the countdown starts automatically around 75–85% confidence.</p>
    </section>
  );
}

export function LiveFormPanel({
  metrics,
  visualsAllowed,
  setReps,
  title,
}: {
  metrics: Array<{ label: string; value: number | null }>;
  visualsAllowed: boolean;
  setReps: SessionRep[];
  title: string;
}) {
  return (
    <section className="card live-card">
      <div className="card__row">
        <h2 className="card__title">{title}</h2>
        {setReps.length ? (
          <div className="mini-tiles" aria-label="Scores this set">
            {setReps.map((rep) => (
              <span key={rep.index} className={`mini-tile mini-tile--${rep.score >= 75 ? 'good' : rep.score >= 55 ? 'mid' : 'low'}`}>{rep.score}</span>
            ))}
          </div>
        ) : null}
      </div>
      {visualsAllowed ? (
        <div className="metric-list">
          {metrics.map((metric) => (
            <MetricBar key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      ) : (
        <p className="fine-print">This experiment mode hides on-screen form feedback. Just do your reps — scores appear on the results screen.</p>
      )}
    </section>
  );
}

export function BreakPanel({
  set1,
  focusLines,
  metrics,
  visualsAllowed,
  spokenCoaching,
  onSpokenCoachingChange,
  audioAllowed,
}: {
  set1: SetSummary;
  focusLines: string[];
  metrics: Array<{ label: string; value: number | null }>;
  visualsAllowed: boolean;
  spokenCoaching: boolean;
  onSpokenCoachingChange: (value: boolean) => void;
  audioAllowed: boolean;
}) {
  return (
    <>
      <section className="card break-card">
        <div className="break-card__score">
          <span>Set 1 score</span>
          <strong>{set1.average}</strong>
          <span className="fine-print">best rep {set1.best}</span>
        </div>
        <div>
          <h2 className="card__title">Your focus for set 2</h2>
          <ol className="focus-list">
            {focusLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      </section>
      {visualsAllowed ? (
        <section className="card live-card">
          <h2 className="card__title">Practice it now</h2>
          <p className="fine-print">Hold a push-up and adjust until the bars turn green. Nothing is counted during the break.</p>
          <div className="metric-list">
            {metrics.map((metric) => (
              <MetricBar key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="card">
        <SpokenTipsSwitch checked={spokenCoaching} onChange={onSpokenCoachingChange} disabled={!audioAllowed} />
      </section>
    </>
  );
}

import { improvementVerdict, REPS_PER_SET, type SetSummary, type WorkflowMode } from '../lib/sessionFlow';
import type { SessionRep } from '../lib/types';
import { CompareBar, MetricBar } from './MetricBar';

interface ResultsPanelProps {
  mode: WorkflowMode;
  name: string;
  onNameChange: (value: string) => void;
  set1: SetSummary;
  set2: SetSummary;
  overall: SetSummary;
  reps: SessionRep[];
  focusLines: string[];
  previousScore: number | null;
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  uploadMessage: string;
  savedLocally: boolean;
  onSaveLocal: () => void;
  onExportNotes: () => void;
  onExportCsv: () => void;
}

function RepTiles({ reps, label }: { reps: SessionRep[]; label: string }) {
  const slots = Array.from({ length: Math.max(REPS_PER_SET, reps.length) }, (_, index) => reps[index] ?? null);
  return (
    <div className="rep-tiles" aria-label={label}>
      <span className="rep-tiles__label">{label}</span>
      <div className="rep-tiles__row">
        {slots.map((rep, index) => (
          <span key={index} className={rep ? `rep-tile rep-tile--${rep.score >= 75 ? 'good' : rep.score >= 55 ? 'mid' : 'low'}` : 'rep-tile rep-tile--empty'}>
            {rep ? rep.score : '–'}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResultsPanel(props: ResultsPanelProps) {
  const { mode, name, set1, set2, overall, reps } = props;
  const coachingComplete = mode === 'coaching' && set1.count > 0 && set2.count > 0;
  const delta = set2.average - set1.average;
  const verdict = improvementVerdict(delta);
  const ordered = [...reps].sort((a, b) => a.index - b.index);
  const displayName = name.trim() || 'Volunteer';

  return (
    <div className="results">
      <header className="results__head">
        <p className="eyebrow">{mode === 'coaching' ? 'Coaching session results' : 'Practice results'}</p>
        <h1>{displayName}</h1>
      </header>

      {coachingComplete ? (
        <section className={`verdict verdict--${verdict.tone}`} aria-live="polite">
          <div className="verdict__scores">
            <div>
              <span>Set 1</span>
              <strong>{set1.average}</strong>
            </div>
            <div className="verdict__arrow" aria-hidden="true">→</div>
            <div>
              <span>Set 2</span>
              <strong>{set2.average}</strong>
            </div>
          </div>
          <div className="verdict__delta">
            <strong>{delta > 0 ? `+${delta}` : delta}</strong>
            <span>points</span>
          </div>
          <h2>{verdict.headline}</h2>
          <p>{verdict.detail}</p>
        </section>
      ) : (
        <section className="verdict verdict--steady">
          <div className="verdict__scores verdict__scores--single">
            <div>
              <span>Average score</span>
              <strong>{overall.average}</strong>
            </div>
            <div>
              <span>Best rep</span>
              <strong>{overall.best}</strong>
            </div>
            <div>
              <span>Reps</span>
              <strong>{overall.count}</strong>
            </div>
          </div>
          {mode === 'coaching' ? (
            <p>Session ended early — finish both sets of {REPS_PER_SET} to see the improvement.</p>
          ) : props.previousScore ? (
            <p>
              Last saved score for {displayName}: {props.previousScore} ({overall.average - props.previousScore >= 0 ? '+' : ''}
              {overall.average - props.previousScore})
            </p>
          ) : null}
        </section>
      )}

      <section className="card">
        <h3 className="card__title">What made the score</h3>
        {coachingComplete ? (
          <div className="compare-list">
            <CompareBar label="Elbow depth" before={set1.depth} after={set2.depth} />
            <CompareBar label="Plank line" before={set1.bodyLine} after={set2.bodyLine} />
            <CompareBar label="Elbow tuck" before={set1.elbowFlare} after={set2.elbowFlare} />
          </div>
        ) : (
          <div className="metric-list">
            <MetricBar label="Elbow depth" value={overall.count ? overall.depth : null} />
            <MetricBar label="Plank line" value={overall.count ? overall.bodyLine : null} />
            <MetricBar label="Elbow tuck" value={overall.count ? overall.elbowFlare : null} />
          </div>
        )}
        <p className="fine-print">Score = mostly depth and a straight plank line, plus elbow tuck and hand position.</p>
      </section>

      {ordered.length ? (
        <section className="card">
          <h3 className="card__title">Every rep</h3>
          {mode === 'coaching' ? (
            <>
              <RepTiles label="Set 1" reps={ordered.filter((rep) => rep.attempt === 1)} />
              <RepTiles label="Set 2" reps={ordered.filter((rep) => rep.attempt === 2)} />
            </>
          ) : (
            <RepTiles label="Reps" reps={ordered} />
          )}
        </section>
      ) : null}

      <section className="card">
        <h3 className="card__title">{coachingComplete ? 'Keep working on' : 'Coaching tips'}</h3>
        <ul className="bullet-list">
          {props.focusLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 className="card__title">Save &amp; share</h3>
        {!name.trim() ? (
          <label className="field">
            <span className="field__label">Name for the results sheet</span>
            <input className="input" value={name} onChange={(event) => props.onNameChange(event.target.value)} placeholder="Volunteer name" autoComplete="off" />
          </label>
        ) : null}
        <p className={`upload-status upload-status--${props.uploadState}`} role="status">
          {props.uploadMessage}
        </p>
        <div className="btn-row btn-row--wrap">
          <button className="btn btn--secondary" onClick={props.onSaveLocal} disabled={props.savedLocally || !ordered.length}>
            {props.savedLocally ? 'Saved to this device' : 'Save to this device'}
          </button>
          <button className="btn btn--ghost" onClick={props.onExportNotes} disabled={!ordered.length}>
            Export notes
          </button>
          <button className="btn btn--ghost" onClick={props.onExportCsv} disabled={!ordered.length}>
            Export CSV
          </button>
        </div>
      </section>
    </div>
  );
}

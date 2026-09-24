import { useState } from 'react';
import { BASELINE_ANGLES, BASELINE_METRICS, elbowDegreesForDepthScore, type BaselineMetricKey } from '../lib/baselineStorage';
import type { BaselineAngle, BaselinePoseReference, LogEntry, PoseAnalysis, SavedBaselines } from '../lib/types';
import { LockIcon, UnlockIcon } from './Icons';
import { Sheet } from './Sheet';

interface AdminSheetProps {
  open: boolean;
  onClose: () => void;
  unlocked: boolean;
  onUnlock: (pin: string) => boolean;
  onLock: () => void;
  baselines: SavedBaselines;
  angle: BaselineAngle;
  onAngleChange: (angle: BaselineAngle) => void;
  gradingAngle: BaselineAngle;
  draft: BaselinePoseReference | null;
  onDraftChange: (key: BaselineMetricKey, field: 'targets' | 'tolerances', value: number | null) => void;
  onSeedFromPose: () => void;
  onSave: () => void;
  onClearAll: () => void;
  live: PoseAnalysis | null;
  logs: LogEntry[];
}

const parseNumber = (raw: string) => (raw === '' ? null : Math.max(0, Math.min(100, Number(raw))));

export function AdminSheet(props: AdminSheetProps) {
  const { open, onClose, unlocked } = props;
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [tab, setTab] = useState<'standards' | 'diagnostics'>('standards');

  const submitPin = () => {
    if (props.onUnlock(pin)) {
      setPin('');
      setPinError('');
      return;
    }
    setPinError('That PIN didn’t match. Try again.');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Admin"
      subtitle={unlocked ? 'Unlocked on this device' : 'Enter the admin PIN to set the 100 standards'}
    >
      {!unlocked ? (
        <form
          className="pin-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitPin();
          }}
        >
          <div className="pin-form__badge"><LockIcon size={26} /></div>
          <label className="field">
            <span className="field__label">Admin PIN</span>
            <input
              className="input input--pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              type="password"
              placeholder="••••••"
              aria-invalid={pinError ? true : undefined}
            />
          </label>
          {pinError ? <p className="form-error" role="alert">{pinError}</p> : null}
          <button className="btn btn--primary btn--block" type="submit" disabled={pin.length < 4}>
            <UnlockIcon /> Unlock admin
          </button>
          <p className="fine-print">Admin access stays unlocked on this device until you sign out admin.</p>
        </form>
      ) : (
        <div className="admin">
          <div className="segmented segmented--full" role="tablist" aria-label="Admin sections">
            <button role="tab" aria-selected={tab === 'standards'} className={tab === 'standards' ? 'segmented__item is-active' : 'segmented__item'} onClick={() => setTab('standards')}>
              100 standards
            </button>
            <button role="tab" aria-selected={tab === 'diagnostics'} className={tab === 'diagnostics' ? 'segmented__item is-active' : 'segmented__item'} onClick={() => setTab('diagnostics')}>
              Diagnostics
            </button>
          </div>

          {tab === 'standards' ? <StandardsEditor {...props} /> : <Diagnostics logs={props.logs} />}

          <button className="btn btn--ghost btn--block" onClick={props.onLock}>
            <LockIcon /> Sign out admin
          </button>
        </div>
      )}
    </Sheet>
  );
}

function StandardsEditor({ baselines, angle, onAngleChange, gradingAngle, draft, onDraftChange, onSeedFromPose, onSave, onClearAll, live }: AdminSheetProps) {
  const angleInfo = BASELINE_ANGLES.find((item) => item.angle === angle);
  const metrics = BASELINE_METRICS.filter((metric) => !metric.sideOnly || angle === 'side');
  const saved = baselines.references[angle];

  return (
    <div className="standards">
      <p className="standards__intro">
        Set what a <strong>perfect 100</strong> looks like for each camera angle. Reps within the tolerance get full credit, so near-perfect reps are never flagged.
      </p>

      <div className="angle-tabs" role="tablist" aria-label="Camera angle">
        {BASELINE_ANGLES.map((item) => (
          <button
            key={item.angle}
            role="tab"
            aria-selected={item.angle === angle}
            className={item.angle === angle ? 'angle-tab is-active' : 'angle-tab'}
            onClick={() => onAngleChange(item.angle)}
          >
            <span>{item.label}</span>
            <span className={baselines.references[item.angle] ? 'angle-tab__dot is-saved' : 'angle-tab__dot'} aria-label={baselines.references[item.angle] ? 'saved' : 'not set'} />
          </button>
        ))}
      </div>

      <div className="placement-note">
        <strong>{angleInfo?.label} setup</strong>
        <p>{angleInfo?.placement}</p>
        <p className="placement-note__status">
          {saved ? `Saved ${new Date(saved.createdAt).toLocaleDateString()}` : 'Not saved yet — using built-in scoring.'}
          {angle === gradingAngle ? ' · Active for the current camera view.' : ''}
        </p>
      </div>

      <button className="btn btn--secondary btn--block" onClick={onSeedFromPose} disabled={!live || live.confidence < 0.45}>
        Use current pose as draft
      </button>
      {!live ? <p className="fine-print">Start the camera and hold a good rep to capture live values.</p> : null}

      <div className="standard-grid" role="table" aria-label="100 standard targets">
        <div className="standard-grid__head" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">100 at</span>
          <span role="columnheader">± tol.</span>
        </div>
        {metrics.map((metric) => {
          const target = draft?.targets[metric.key] ?? null;
          const tolerance = draft?.tolerances[metric.key] ?? null;
          const liveValue = live ? live[metric.key] : null;
          return (
            <div key={metric.key} className="standard-row" role="row">
              <div className="standard-row__label" role="cell">
                <strong>{metric.label}</strong>
                <span>
                  {metric.key === 'elbowDepthScore' && target !== null ? `≈ ${elbowDegreesForDepthScore(target)}° elbow bend · ` : ''}
                  {metric.hint}
                </span>
                {liveValue !== null && liveValue !== undefined ? <span className="standard-row__live">Live now: {Math.round(liveValue)}</span> : null}
              </div>
              <input
                role="cell"
                className="input input--num"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                aria-label={`${metric.label} target score`}
                value={target ?? ''}
                onChange={(event) => onDraftChange(metric.key, 'targets', parseNumber(event.target.value))}
              />
              <input
                role="cell"
                className="input input--num"
                type="number"
                inputMode="numeric"
                min={0}
                max={50}
                aria-label={`${metric.label} tolerance`}
                value={tolerance ?? ''}
                onChange={(event) => onDraftChange(metric.key, 'tolerances', parseNumber(event.target.value))}
              />
            </div>
          );
        })}
      </div>
      <p className="fine-print">Values are 0–100 form scores. Example: target 90 with ±10 means any rep scoring 80 or higher on that metric counts as perfect.</p>

      <div className="btn-row">
        <button className="btn btn--primary" onClick={onSave} disabled={!draft}>
          Save {angleInfo?.label.toLowerCase()} 100 standard
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => {
            if (window.confirm('Clear all saved 100 standards on this device?')) onClearAll();
          }}
        >
          Clear all
        </button>
      </div>
    </div>
  );
}

function Diagnostics({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="log-list">
      {logs.length === 0 ? (
        <p className="fine-print">Camera, rep, and coaching events appear here during a session.</p>
      ) : (
        logs.map((entry) => (
          <div key={entry.id} className={`log-item log-item--${entry.kind}`}>
            <span>{new Date(entry.at).toLocaleTimeString()}</span>
            <strong>{entry.message}</strong>
            {entry.details ? <p>{entry.details}</p> : null}
          </div>
        ))
      )}
    </div>
  );
}

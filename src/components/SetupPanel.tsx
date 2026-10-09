import type { FeedbackSetting, WorkflowMode } from '../lib/sessionFlow';
import type { CameraFacing, CameraViewMode } from '../lib/types';
import { CheckIcon, DownloadIcon, PenIcon, RetryIcon, SpeakerIcon } from './Icons';

const feedbackSettings: Array<{ value: FeedbackSetting; label: string; detail: string }> = [
  { value: 'study', label: 'Volunteer', detail: 'Volunteer default: set 1 is control (no coaching), set 2 gets combined audio + visual coaching.' },
  { value: 'control', label: 'Control', detail: 'Both sets: no live feedback — camera and rep count only.' },
  { value: 'visual', label: 'Visual', detail: 'Both sets: skeleton overlay and on-screen form cues.' },
  { value: 'audio', label: 'Audio', detail: 'Both sets: spoken countdown and cues, no skeleton.' },
  { value: 'combined', label: 'Combined', detail: 'Both sets: on-screen cues plus spoken audio.' },
];

interface SetupPanelProps {
  name: string;
  onNameChange: (value: string) => void;
  workflowMode: WorkflowMode;
  onWorkflowModeChange: (mode: WorkflowMode) => void;
  adminUnlocked: boolean;
  feedbackSetting: FeedbackSetting;
  onFeedbackSettingChange: (setting: FeedbackSetting) => void;
  spokenCoaching: boolean;
  onSpokenCoachingChange: (value: boolean) => void;
  tempoCues: boolean;
  onTempoCuesChange: (value: boolean) => void;
  cameraFacing: CameraFacing;
  onCameraFacingChange: (value: CameraFacing) => void;
  cameraView: CameraViewMode;
  onCameraViewChange: (value: CameraViewMode) => void;
  hasSavedStandard: boolean;
  showNameHint: boolean;
  consent: ConsentCardState;
  onOpenConsent: () => void;
  onDownloadConsent: () => void;
  onRetryConsentUpload: () => void;
}

export type ConsentDriveState = 'idle' | 'uploading' | 'done' | 'error';

export interface ConsentCardState {
  signed: boolean;
  needsName: boolean;
  summary: string;
  driveState: ConsentDriveState;
  driveMessage: string;
}

function ConsentCard({ consent, onOpen, onDownload, onRetry }: { consent: ConsentCardState; onOpen: () => void; onDownload: () => void; onRetry: () => void }) {
  return (
    <section className={consent.signed ? 'card consent-card is-signed' : 'card consent-card'} aria-live="polite">
      <div className="consent-card__head">
        <span className="consent-card__badge" aria-hidden="true">{consent.signed ? <CheckIcon /> : <PenIcon />}</span>
        <div>
          <h2 className="card__title">Consent form</h2>
          <p className="consent-card__summary">
            {consent.signed ? consent.summary : 'Required before the camera starts. A parent or guardian signs (or the participant if 18+).'}
          </p>
        </div>
      </div>
      {consent.signed ? (
        <>
          <p className={`consent-card__drive consent-card__drive--${consent.driveState}`}>{consent.driveMessage}</p>
          <div className="btn-row btn-row--wrap">
            <button className="btn btn--secondary btn--small" onClick={onDownload}>
              <DownloadIcon size={16} /> Download PDF
            </button>
            {consent.driveState === 'error' ? (
              <button className="btn btn--ghost btn--small" onClick={onRetry}>
                <RetryIcon size={16} /> Retry Drive upload
              </button>
            ) : null}
            <button className="btn btn--ghost btn--small" onClick={onOpen}>Sign again</button>
          </div>
        </>
      ) : (
        <button className="btn btn--primary btn--block" onClick={onOpen} disabled={consent.needsName}>
          <PenIcon /> Read &amp; sign consent
        </button>
      )}
      {!consent.signed && consent.needsName ? <p className="field__hint">Enter the participant’s name above first.</p> : null}
    </section>
  );
}

export function SpokenTipsSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className={disabled ? 'switch-row is-disabled' : 'switch-row'}>
      <span className="switch-row__icon"><SpeakerIcon /></span>
      <span className="switch-row__text">
        <strong>Spoken form tips</strong>
        <span>{disabled ? 'Needs Audio or Combined mode.' : 'Live-coach voice for depth, plank line, and elbows.'}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function TempoCuesSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className={disabled ? 'switch-row is-disabled' : 'switch-row'}>
      <span className="switch-row__icon"><SpeakerIcon /></span>
      <span className="switch-row__text">
        <strong>Up / Down tempo cues</strong>
        <span>
          {disabled
            ? 'Needs Audio or Combined mode.'
            : 'Real-time “Down” at lockout and “Up” at full depth, in audio modes only (set 2 in the volunteer protocol).'}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function PlacementGuide({ view }: { view: CameraViewMode }) {
  return (
    <svg className="placement" viewBox="0 0 240 96" role="img" aria-label={view === 'side' ? 'Phone beside the athlete at hip height' : 'Phone on the floor in front of the athlete'}>
      <line x1="8" y1="80" x2="232" y2="80" className="placement__floor" />
      <g className="placement__body">
        <circle cx={view === 'side' ? 58 : 150} cy="50" r="8" />
        <line x1={view === 'side' ? 66 : 142} y1="54" x2={view === 'side' ? 180 : 60} y2="68" />
        <line x1={view === 'side' ? 76 : 132} y1="56" x2={view === 'side' ? 76 : 132} y2="80" />
      </g>
      {view === 'side' ? (
        <g className="placement__phone">
          <rect x="112" y="6" width="16" height="26" rx="3" />
          <path d="M120 34 L120 44" className="placement__ray" />
        </g>
      ) : (
        <g className="placement__phone">
          <rect x="200" y="54" width="14" height="24" rx="3" />
          <path d="M198 64 L172 58" className="placement__ray" />
        </g>
      )}
    </svg>
  );
}

export function SetupPanel(props: SetupPanelProps) {
  const selectedSetting = feedbackSettings.find((setting) => setting.value === props.feedbackSetting);
  const audioAllowed = props.feedbackSetting === 'audio' || props.feedbackSetting === 'combined';

  return (
    <div className="setup">
      <header className="setup__intro">
        <h1>Let’s check your push-up form.</h1>
        <p>Set up the phone, do your reps, and see how much coaching helps.</p>
      </header>

      <section className="card">
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="input input--lg"
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="e.g. Connor"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
          />
        </label>
        {props.showNameHint ? <p className="field__hint">Add a name to start — it labels your results and the consent form.</p> : null}
      </section>

      <ConsentCard consent={props.consent} onOpen={props.onOpenConsent} onDownload={props.onDownloadConsent} onRetry={props.onRetryConsentUpload} />

      <section className="card">
        <h2 className="card__title">Session</h2>
        <div className="choice-grid" role="radiogroup" aria-label="Session type">
          <button
            role="radio"
            aria-checked={props.workflowMode === 'coaching'}
            className={props.workflowMode === 'coaching' ? 'choice is-active' : 'choice'}
            onClick={() => props.onWorkflowModeChange('coaching')}
          >
            <span className="choice__tag">Science fair trial</span>
            <strong>Coaching session</strong>
            <span>2 sets of 5 reps with a coaching break. See your before &amp; after.</span>
          </button>
          <button
            role="radio"
            aria-checked={props.workflowMode === 'free'}
            className={props.workflowMode === 'free' ? 'choice is-active' : 'choice'}
            onClick={() => props.onWorkflowModeChange('free')}
          >
            <strong>Free practice</strong>
            <span>Count and score reps at your own pace.</span>
          </button>
        </div>
      </section>

      {props.adminUnlocked ? (
        <section className="card card--admin">
          <h2 className="card__title">
            Feedback mode <span className="admin-tag">Admin</span>
          </h2>
          <div className="segmented segmented--wrap" role="radiogroup" aria-label="Feedback mode">
            {feedbackSettings.map((setting) => (
              <button
                key={setting.value}
                role="radio"
                aria-checked={props.feedbackSetting === setting.value}
                className={props.feedbackSetting === setting.value ? 'segmented__item is-active' : 'segmented__item'}
                onClick={() => props.onFeedbackSettingChange(setting.value)}
              >
                {setting.label}
              </button>
            ))}
          </div>
          <p className="field__hint">{selectedSetting?.detail}</p>
          {props.feedbackSetting !== 'study' ? (
            <SpokenTipsSwitch checked={props.spokenCoaching} onChange={props.onSpokenCoachingChange} disabled={!audioAllowed} />
          ) : null}
          <TempoCuesSwitch
            checked={props.tempoCues}
            onChange={props.onTempoCuesChange}
            disabled={props.feedbackSetting !== 'study' && !audioAllowed}
          />
        </section>
      ) : null}

      <details className="card disclosure">
        <summary>
          <span>
            <strong>Camera setup</strong>
            <span className="disclosure__meta">
              {props.cameraFacing === 'user' ? 'Front camera' : 'Back camera'} · {props.cameraView === 'head-on' ? 'Head-on (front)' : 'Side'} view
            </span>
          </span>
        </summary>
        <div className="disclosure__body">
          <div className="segmented" role="radiogroup" aria-label="Camera">
            {(['user', 'environment'] as const).map((facing) => (
              <button
                key={facing}
                role="radio"
                aria-checked={props.cameraFacing === facing}
                className={props.cameraFacing === facing ? 'segmented__item is-active' : 'segmented__item'}
                onClick={() => props.onCameraFacingChange(facing)}
              >
                {facing === 'user' ? 'Front camera' : 'Back camera'}
              </button>
            ))}
          </div>
          {props.adminUnlocked ? (
            <div className="segmented" role="radiogroup" aria-label="Camera view (admin)">
              {(['head-on', 'side'] as const).map((view) => (
                <button
                  key={view}
                  role="radio"
                  aria-checked={props.cameraView === view}
                  className={props.cameraView === view ? 'segmented__item is-active' : 'segmented__item'}
                  onClick={() => props.onCameraViewChange(view)}
                >
                  {view === 'head-on' ? 'Head-on' : 'Side'}
                </button>
              ))}
            </div>
          ) : null}
          <PlacementGuide view={props.cameraView} />
          <p className="field__hint">
            {props.cameraView === 'head-on'
              ? 'Phone low on the floor about 1.5 m in front, so hands, shoulders, and head stay visible.'
              : 'Phone at hip height about 2 m to the side. Best view for judging the plank line and hip pike.'}
          </p>
          <p className="fine-print">{props.hasSavedStandard ? 'Grading against the saved 100 standard for this view.' : 'Using built-in scoring (no saved 100 standard for this view).'}</p>
        </div>
      </details>
    </div>
  );
}

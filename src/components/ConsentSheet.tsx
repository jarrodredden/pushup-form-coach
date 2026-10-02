import { useState } from 'react';
import {
  ATTESTATION_TEXT,
  CONSENT_SECTIONS,
  consentDateLabel,
  INTRO_TEXT,
  VOLUNTARY_TEXT,
  type ConsentSettings,
  type ConsentSignerRole,
} from '../lib/consent';
import { CheckIcon } from './Icons';
import { Sheet } from './Sheet';
import { SignaturePad } from './SignaturePad';

export interface ConsentSubmission {
  signerRole: ConsentSignerRole;
  signerName: string;
  signatureDataUrl: string;
  assentSignatureDataUrl: string | null;
}

interface ConsentSheetProps {
  open: boolean;
  onClose: () => void;
  participantName: string;
  settings: ConsentSettings;
  onSign: (submission: ConsentSubmission) => Promise<boolean>;
}

export function ConsentSheet({ open, onClose, participantName, settings, onSign }: ConsentSheetProps) {
  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Consent form" subtitle={`Participant: ${participantName}`}>
      <ConsentForm participantName={participantName} settings={settings} onSign={onSign} />
    </Sheet>
  );
}

function ConsentForm({ participantName, settings, onSign }: Pick<ConsentSheetProps, 'participantName' | 'settings' | 'onSign'>) {
  const [signerRole, setSignerRole] = useState<ConsentSignerRole>('guardian');
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [assentSignature, setAssentSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isGuardian = signerRole === 'guardian';
  const printedName = isGuardian ? signerName.trim() : participantName;
  const canSign = Boolean(printedName && signature) && !submitting;

  const chooseRole = (role: ConsentSignerRole) => {
    if (role === signerRole) return;
    setSignerRole(role);
    setSignature(null);
    setAssentSignature(null);
  };

  const submit = async () => {
    if (!signature || !printedName) return;
    setSubmitting(true);
    const ok = await onSign({
      signerRole,
      signerName: printedName,
      signatureDataUrl: signature,
      assentSignatureDataUrl: isGuardian ? assentSignature : null,
    });
    if (!ok) setSubmitting(false);
  };

  return (
    <form
      className="consent"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <article className="consent__doc" aria-label="Human Informed Consent Form">
        <h3>Human Informed Consent Form</h3>
        <dl className="consent__facts">
          <div><dt>Student researcher(s)</dt><dd>{settings.studentResearchers || '—'}</dd></div>
          <div><dt>Title of project</dt><dd>{settings.projectTitle}</dd></div>
        </dl>
        <p className="consent__intro">{INTRO_TEXT}</p>
        <dl className="consent__sections">
          {CONSENT_SECTIONS.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.text}</dd>
            </div>
          ))}
          <div>
            <dt>Questions? Contact</dt>
            <dd>Adult Sponsor: {settings.sponsorName} · {settings.sponsorContact}</dd>
          </div>
        </dl>
        <p><strong>Voluntary participation:</strong> {VOLUNTARY_TEXT}</p>
        <p className="consent__attest">{ATTESTATION_TEXT}</p>
      </article>

      <section className="consent__sign">
        <div className="segmented segmented--full" role="radiogroup" aria-label="Who is signing">
          <button
            type="button"
            role="radio"
            aria-checked={isGuardian}
            className={isGuardian ? 'segmented__item is-active' : 'segmented__item'}
            onClick={() => chooseRole('guardian')}
          >
            Parent / guardian
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isGuardian}
            className={!isGuardian ? 'segmented__item is-active' : 'segmented__item'}
            onClick={() => chooseRole('participant')}
          >
            Participant is 18+
          </button>
        </div>

        <div className="consent__row">
          {isGuardian ? (
            <label className="field">
              <span className="field__label">Parent / guardian printed name</span>
              <input
                className="input"
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                placeholder="Full name"
                autoComplete="off"
                autoCapitalize="words"
                required
              />
            </label>
          ) : (
            <div className="field">
              <span className="field__label">Participant printed name</span>
              <p className="consent__readonly">{participantName}</p>
            </div>
          )}
          <div className="field consent__date">
            <span className="field__label">Date signed</span>
            <p className="consent__readonly">{consentDateLabel(new Date())}</p>
          </div>
        </div>

        <SignaturePad
          key={signerRole}
          label={isGuardian ? 'Parent / guardian signature' : 'Participant signature'}
          onChange={setSignature}
        />
        {isGuardian ? (
          <SignaturePad
            label={`${participantName} — minor assent (optional)`}
            hint="Optional: the participant can sign too, to show their own assent."
            onChange={setAssentSignature}
          />
        ) : null}

        <button className="btn btn--primary btn--xl btn--block" type="submit" disabled={!canSign}>
          <CheckIcon /> {submitting ? 'Saving signed form…' : 'Sign consent form'}
        </button>
        <p className="fine-print">
          Signing makes a PDF of this form with the signature and date. It saves to the project’s Google Drive folder when online, and you can always download a copy.
        </p>
      </section>
    </form>
  );
}

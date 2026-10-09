import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultBaselineReference } from '../lib/baselineStorage';
import { DEFAULT_CONSENT_SETTINGS } from '../lib/consent';
import { showOnScreenDiagnostics } from '../lib/adminDiagnostics';
import { summarizeReps, type JourneyPhase } from '../lib/sessionFlow';
import type { SavedBaselines, SessionRep } from '../lib/types';
import { AdminSheet } from './AdminSheet';
import { ResultsPanel } from './ResultsPanel';
import { StageDiagnostics } from './StageDiagnostics';

const PHASES: JourneyPhase[] = ['setup', 'calibrating', 'countdown', 'set', 'break', 'results'];
/** Diagnostics markup: the stage readout, the per-rep plank debug, and the admin Diagnostics tab / event log. */
const DIAGNOSTICS = /stage__diag|plank-debug|plank line debug|Diagnostics|log-item|Camera preview|stage \d+×\d+|reps (idle|top|bottom|waiting)/;

const noop = () => undefined;
const baselines: SavedBaselines = { updatedAt: '', references: { front: null, side: null, back: null, top: null } };
const rep = (index: number, attempt: number): SessionRep => ({
  index,
  attempt,
  viewMode: 'head-on',
  score: 70 + index,
  notes: [],
  elbowDepthScore: 80,
  bodyLineScore: 75,
  plankDebug: `head-on gap 0.${index}`,
  elbowFlareScore: 90,
  handStackScore: 85,
  headAlignmentScore: 88,
  framingScore: 100,
  hipSagScore: null,
  hipPikeScore: null,
  confidence: 0.9,
  timestamp: index * 2000,
});
const reps = [1, 2, 3, 4, 5].map((i) => rep(i, 1)).concat([6, 7, 8, 9, 10].map((i) => rep(i, 2)));

function stage(admin: { unlocked: boolean; diagnosticsOn: boolean }) {
  return renderToStaticMarkup(<StageDiagnostics visible={showOnScreenDiagnostics(admin)} />);
}

function results(admin: { unlocked: boolean; diagnosticsOn: boolean }) {
  const set1 = summarizeReps(reps.slice(0, 5));
  const set2 = summarizeReps(reps.slice(5));
  return renderToStaticMarkup(
    <ResultsPanel
      mode="coaching"
      name="Sam Rivera"
      onNameChange={noop}
      set1={set1}
      set2={set2}
      overall={summarizeReps(reps)}
      reps={reps}
      focusLines={['Go a little deeper.']}
      previousScore={null}
      uploadState="done"
      uploadMessage="Saved."
      savedLocally={false}
      onSaveLocal={noop}
      onExportNotes={noop}
      onExportCsv={noop}
      showDiagnostics={showOnScreenDiagnostics(admin)}
    />,
  );
}

function adminSheet(unlocked: boolean) {
  return renderToStaticMarkup(
    <AdminSheet
      open
      onClose={noop}
      unlocked={unlocked}
      onUnlock={() => false}
      onLock={noop}
      skipConsent={false}
      onSkipConsentChange={noop}
      noSave={false}
      onNoSaveChange={noop}
      baselines={baselines}
      angle="front"
      onAngleChange={noop}
      gradingAngle="front"
      draft={createDefaultBaselineReference('front')}
      onDraftChange={noop}
      onElbowRangeChange={noop}
      onSeedFromPose={noop}
      onSave={noop}
      onClearAll={noop}
      live={null}
      logs={[{ id: '1', kind: 'system', message: 'Camera preview didn’t fill the stage; re-laid out.', details: 'stage 372×673', at: Date.now() }]}
      reps={reps}
      stageDiagnostics
      onStageDiagnosticsChange={noop}
      pendingResultCount={0}
      onRetryPendingResults={noop}
      consentSettings={DEFAULT_CONSENT_SETTINGS}
      onConsentSettingsChange={noop}
      pendingConsentCount={0}
      onRetryPendingConsents={noop}
      onDownloadPendingConsents={noop}
    />,
  );
}

describe('admin-only diagnostics', () => {
  it('render no diagnostics DOM for a non-admin in any phase, even with the switch left on', () => {
    for (const phase of PHASES) {
      for (const diagnosticsOn of [false, true]) {
        const markup = phase === 'results' ? results({ unlocked: false, diagnosticsOn }) : stage({ unlocked: false, diagnosticsOn });
        expect(markup, `${phase}, switch ${diagnosticsOn ? 'on' : 'off'}`).not.toMatch(DIAGNOSTICS);
      }
    }
    expect(results({ unlocked: false, diagnosticsOn: true })).toContain('Sam Rivera');
  });

  it('stay hidden on an admin-unlocked device until the admin turns them on (no screen auto-shows them)', () => {
    for (const phase of PHASES) {
      const markup = phase === 'results' ? results({ unlocked: true, diagnosticsOn: false }) : stage({ unlocked: true, diagnosticsOn: false });
      expect(markup, phase).not.toMatch(DIAGNOSTICS);
    }
  });

  it('show for the admin with the switch on', () => {
    expect(stage({ unlocked: true, diagnosticsOn: true })).toContain('stage__diag');
    expect(results({ unlocked: true, diagnosticsOn: true })).toContain('plank-debug');
  });

  it('the locked admin sheet shows only the PIN form, never the Diagnostics tab or the event log', () => {
    const locked = adminSheet(false);
    expect(locked).toContain('Admin PIN');
    expect(locked).not.toMatch(DIAGNOSTICS);
    expect(locked).not.toContain('re-laid out');
    expect(adminSheet(true)).toContain('Diagnostics');
  });
});

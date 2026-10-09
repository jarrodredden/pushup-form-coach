import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { AdminSheet } from './components/AdminSheet';
import { ConsentSheet, type ConsentSubmission } from './components/ConsentSheet';
import { HistorySheet } from './components/HistorySheet';
import { CameraIcon, ChevronIcon, HistoryIcon, LockIcon, RetryIcon, StopIcon, UnlockIcon } from './components/Icons';
import { SharePanel } from './components/SharePanel';
import { BreakPanel, CalibratingPanel, LiveFormPanel, type ChecklistItem } from './components/LivePanels';
import { ResultsPanel } from './components/ResultsPanel';
import { SetupPanel, type ConsentDriveState } from './components/SetupPanel';
import { Stepper } from './components/Stepper';
import {
  createBaselineReference,
  createDefaultBaselineReference,
  elbowRangeFor,
  gradingAngleForView,
  loadBaselines,
  saveBaselines,
  scoreAgainstBaseline,
  type BaselineMetricKey,
} from './lib/baselineStorage';
import {
  base64ToBlob,
  buildConsentPdf,
  buildConsentUploadPayload,
  consentDateLabel,
  consentFileName,
  isConsentValidFor,
  loadConsentSettings,
  loadCurrentConsent,
  loadPendingConsents,
  parseConsentUploadResponse,
  saveConsentSettings,
  saveCurrentConsent,
  savePendingConsents,
  withConsentDefaults,
  type ConsentSettings,
  type ConsentUploadResult,
  type SignedConsent,
} from './lib/consent';
import { buildCsv, buildNotesExport, downloadBlob, downloadTextFile } from './lib/export';
import { shouldMirrorPreview } from './lib/mirroring';
import {
  COVERAGE_MIN,
  coverLayout,
  createWatchdog,
  describeStage,
  isIOSDevice,
  pickFrameSize,
  prefersPortraitCamera,
  sameLayout,
  stageCoverage,
  stepWatchdog,
  toStagePoint,
  type Size,
  type StageLayout,
} from './lib/stageLayout';
import { createRepCounter } from './lib/repCounter';
import { createRepMachine, plankPosture, repInProgressMs, stepRep, type PlankPosture } from './lib/repGate';
import { AUTO_START_HOLD_MS, createPositionWatch, MANUAL_START_AFTER_MS, watchPosition } from './lib/autoStart';
import { liveCoachingIssues, shortenCue, weightedRepScore, type CoachingIssueKey } from './lib/coaching';
import { createRollingMedian, elbowTuckScore, type ElbowIdealRange } from './lib/elbowTuck';
import { updatePlankReference, type PlankReference } from './lib/plankLine';
import {
  allFeedbackLines,
  CORRECTIVE_LINES,
  correctionPhrase,
  createFeedbackMemory,
  repFeedback,
  sessionWrapUp,
  SET_ONE_WRAP_UP,
  type CorrectionKey,
} from './lib/repFeedback';
import {
  addRepFrame,
  analyzePose,
  createEmptyRepAccumulator,
  finalizeRep,
  MIN_SIGNAL,
  REP_BOTTOM_ANGLE,
  REP_TOP_ANGLE,
  withElbowNote,
} from './lib/scoring';
import {
  activeStepKey,
  attemptForTrialState,
  coachingFocusLines,
  deriveJourneyPhase,
  feedbackModeFor,
  spokenTipsFor,
  tempoCuesFor,
  tempoCuesLabel,
  type FeedbackSetting,
  formatRestClock,
  journeySteps,
  REPS_PER_SET,
  REST_BREAK_MS,
  restRemainingMs,
  summarizeReps,
  trialStateAfterRep,
  type CalibrationState,
  type CoachingTrialState,
  type WorkflowMode,
} from './lib/sessionFlow';
import { isOfflinePackage, loadPoseAssets } from './lib/poseAssets';
import { loadHistory, saveHistory } from './lib/storage';
import {
  dropResult,
  dueResults,
  enqueueResult,
  loadPendingResults,
  markResultFailed,
  newSessionId,
  nextAttemptAt,
  parseResultUploadResponse,
  savePendingResults,
  type ResultRow,
} from './lib/resultsQueue';
import { clearVoiceQueue, duckVoice, holdVoiceQueue, playVoiceClip, voiceQueueIdle, playVoiceMessage, preloadVoiceClips, resolveVoiceClipNames } from './lib/voiceAudio';
import { createTempoState, stepTempo, summarizeLatency, type TempoCue, type TempoLatency } from './lib/tempoCues';
import { audioOutputLatencyMs, loadTempoCues, playTempoCue, tempoCuesReady } from './lib/tempoAudio';
import type {
  BaselineAngle,
  BaselinePoseReference,
  CameraFacing,
  CameraViewMode,
  LogEntry,
  PoseAnalysis,
  PosePoint,
  SessionEntry,
  SessionRep,
  SessionSummary,
} from './lib/types';

const SESSION_STORAGE_KEY = 'pushup-coach-history';
const LEGACY_SESSION_STORAGE_KEY = 'pushup-form-coach-history';
const SESSION_NAME_KEY = 'pushup-form-coach-name';
const SOUND_WANTED_KEY = 'pushup-coach-sound-wanted';
const ADMIN_UNLOCK_KEY = 'pushup-admin-pin-unlocked';
const STAGE_DIAG_KEY = 'pushup-admin-stage-diagnostics';
const IS_IOS = typeof navigator !== 'undefined' && isIOSDevice(navigator);
/** Watchdog re-attaches allowed per camera stream, so a stubborn device can't flicker forever. */
const MAX_WATCHDOG_REATTACHES = 2;
const ADMIN_PIN = '180180';
const RESULTS_UPLOAD_URL =
  (import.meta.env.VITE_RESULTS_UPLOAD_URL as string | undefined) ??
  'https://script.google.com/macros/s/AKfycbyE8BrKiLi13COPUOqw9oeQObcUP40lrsRkT3jHyeK_BQsMMUWHc9HjZCcF2y0o0Dqw8g/exec';

type UploadState = 'idle' | 'uploading' | 'done' | 'error' | 'waiting';
const UPLOAD_TIMEOUT_MS = 25000;
const UPLOAD_WAITING_MESSAGE = isOfflinePackage
  ? 'Will upload when online. The result is kept on this device (and uploads next time this app is opened with internet); Export notes for a copy now.'
  : 'Will upload when online. The result is kept on this device until it’s saved.';
type Toast = { tone: 'success' | 'error' | 'info'; text: string };

const nowIso = () => new Date().toISOString();
const cameraViewLabel = (view: CameraViewMode) => (view === 'head-on' ? 'front' : 'side');
const NO_POSTURE: PlankPosture = { horizontal: false, armsExtended: false, atTop: false, reason: 'no pose' };
const GET_INTO_POSITION = 'Get into your push-up position';
const GET_BACK_INTO_POSITION = 'Get back into your push-up position';
/** Arms held in this band after the bottom for LOCKOUT_STALL_MS means the rep stopped short of lockout. */
const LOCKOUT_STALL_MIN_ANGLE = 135;
const LOCKOUT_STALL_MS = 1200;

let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;

function createPoseLandmarker() {
  poseLandmarkerPromise ??= loadPoseAssets().then(({ fileset, baseOptions }) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    }),
  );
  poseLandmarkerPromise.catch(() => {
    poseLandmarkerPromise = null;
  });
  return poseLandmarkerPromise;
}

function speak(message: string) {
  playVoiceMessage(message);
}

async function unlockAudioContext(contextRef: { current: AudioContext | null }) {
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return false;
  // iOS mutes Web Audio with the ringer switch by default; the voice clips (media elements) ignore it.
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (audioSession && audioSession.type !== 'playback') {
    try {
      audioSession.type = 'playback';
    } catch {
      // Older WebKit: leave the default session.
    }
  }
  if (!contextRef.current) {
    contextRef.current = new AudioContextCtor({ latencyHint: 'interactive' });
  }
  if (contextRef.current.state === 'suspended') {
    await contextRef.current.resume();
  }
  return true;
}

function playCueTone(context: AudioContext) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.0001;
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  const now = context.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  oscillator.start(now);
  oscillator.stop(now + 0.18);
}

function ConfidenceRing({ value }: { value: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="ring" aria-label={`${clamped}% tracking confidence`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="ring__track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="ring__value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="ring__label">
        <strong>{clamped}%</strong>
        <span>tracking</span>
      </div>
    </div>
  );
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageLayoutRef = useRef<StageLayout | null>(null);
  const stageDprRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);
  const streamSettingsRef = useRef<Size | null>(null);
  const frameMetaRef = useRef<Size | null>(null);
  const frameMetaAtRef = useRef(0);
  const bitmapSizeRef = useRef<Size | null>(null);
  const watchdogRef = useRef(createWatchdog());
  const watchdogReattachesRef = useRef(0);
  const stageFixesRef = useRef(0);
  const stageDiagRef = useRef<HTMLPreElement | null>(null);
  const phaseRef = useRef('');
  const poseRef = useRef<PoseLandmarker | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const readyTimerRef = useRef<number | null>(null);
  const checkingTimerRef = useRef<number | null>(null);
  const goOverlayTimerRef = useRef<number | null>(null);
  const checkingStartedAtRef = useRef<number | null>(null);
  const confidenceSmoothRef = useRef(0);
  const activeFailureRef = useRef({ text: '', frames: 0, startedAt: 0 });
  const runningRef = useRef(false);
  const repAccumulatorRef = useRef(createEmptyRepAccumulator());
  const repMachineRef = useRef(createRepMachine());
  const lockoutStallRef = useRef({ since: 0, cued: false });
  /** Plank posture of the latest pose frame (body horizontal / arms straight). */
  const postureRef = useRef<PlankPosture>(NO_POSTURE);
  /** Set 2 after the rest: waiting for a held plank to start the countdown (ms timestamp), or null. */
  const positionWaitRef = useRef<number | null>(null);
  /** Which set's countdown was started by holding the position (and stops if they leave it). */
  const watchedCountdownRef = useRef<0 | 1 | 2>(0);
  const positionWatchRef = useRef(createPositionWatch());
  const repCounterRef = useRef(createRepCounter());
  const attemptRepCountRef = useRef<Record<1 | 2, number>>({ 1: 0, 2: 0 });
  const frameHandlerRef = useRef<(landmarks: PosePoint[] | undefined, worldLandmarks?: PosePoint[]) => void>(() => undefined);
  const elbowSmootherRef = useRef(createRollingMedian(7));
  const plankReferenceRef = useRef<PlankReference>({});
  const coachingFocusRef = useRef<{ key: CoachingIssueKey | null; resolvedAt: number | null; cue: string }>({
    key: null,
    resolvedAt: null,
    cue: '',
  });
  const stableCalibrationFramesRef = useRef(0);
  const calibrationStateRef = useRef<CalibrationState>('idle');
  const cueLastTextRef = useRef('');
  const cueLastEmittedAtRef = useRef(0);
  const cueHoldUntilRef = useRef(0);
  const repSpeechLockUntilRef = useRef(0);
  const tempoStateRef = useRef(createTempoState(0));
  const tempoLatencyRef = useRef<TempoLatency[]>([]);
  const tempoUnavailableLoggedRef = useRef(false);
  /** performance.now() around the latest detectForVideo call, for tempo-cue latency. */
  const frameTimingRef = useRef({ detectStartedAt: 0, resultAt: 0 });

  const [secureContext, setSecureContext] = useState(window.isSecureContext);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  const [cameraView, setCameraView] = useState<CameraViewMode>('head-on');
  const [feedbackSetting, setFeedbackSetting] = useState<FeedbackSetting>('study');
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'live' | 'error'>('idle');
  const [cameraError, setCameraError] = useState('');
  const [poseReady, setPoseReady] = useState(false);
  const [athleteName, setAthleteName] = useState(() => localStorage.getItem(SESSION_NAME_KEY) ?? '');
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [sessionReps, setSessionReps] = useState<SessionRep[]>([]);
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [currentCue, setCurrentCue] = useState('');
  const [spokenTipsSwitch, setSpokenTipsSwitch] = useState(true);
  const [tempoCuesSwitch, setTempoCuesSwitch] = useState(true);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('coaching');
  const [coachingTrialState, setCoachingTrialState] = useState<CoachingTrialState>('idle');
  const [coachingPaused, setCoachingPaused] = useState(false);
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [restBypassed, setRestBypassed] = useState(false);
  const [positionWaitSince, setPositionWaitSince] = useState<number | null>(null);
  const [positionHoldPct, setPositionHoldPct] = useState(0);
  const [manualStartVisible, setManualStartVisible] = useState(false);
  const [restNow, setRestNow] = useState(() => Date.now());
  const [adminUnlocked, setAdminUnlocked] = useState(() => localStorage.getItem(ADMIN_UNLOCK_KEY) === '1');
  const [adminOpen, setAdminOpen] = useState(false);
  // Admin test-run switches. Never persisted, and cleared on admin sign-out and Next volunteer.
  const [adminSkipConsent, setAdminSkipConsent] = useState(false);
  const [adminNoSave, setAdminNoSave] = useState(false);
  const [sessionNoSave, setSessionNoSave] = useState(false);
  const [stageDiagPinned, setStageDiagPinned] = useState(() => localStorage.getItem(STAGE_DIAG_KEY) === '1');
  const [stageDiagTripped, setStageDiagTripped] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [pendingResultCount, setPendingResultCount] = useState(() => loadPendingResults().length);
  const resultSessionIdRef = useRef(newSessionId());
  const autoQueuedSessionRef = useRef<string | null>(null);
  const resultsFlushingRef = useRef(false);
  const resultsFlushAgainRef = useRef(false);
  const resultsRetryTimerRef = useRef<number | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [consentSettings, setConsentSettings] = useState<ConsentSettings>(() => loadConsentSettings());
  const [currentConsent, setCurrentConsent] = useState<SignedConsent | null>(() => loadCurrentConsent());
  const [pendingConsents, setPendingConsents] = useState<SignedConsent[]>(() => loadPendingConsents());
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentDriveState, setConsentDriveState] = useState<ConsentDriveState>(() =>
    loadCurrentConsent()?.uploaded ? 'done' : loadCurrentConsent() ? 'error' : 'idle',
  );
  const [consentDriveMessage, setConsentDriveMessage] = useState(() =>
    loadCurrentConsent()?.uploaded
      ? 'Saved to the project Google Drive folder.'
      : 'Not in Drive yet — kept on this device for retry. Download a copy to be safe.',
  );
  const [baselineAngle, setBaselineAngle] = useState<BaselineAngle>('front');
  const [baselines, setBaselines] = useState(() => loadBaselines());
  const [baselineDraft, setBaselineDraft] = useState<BaselinePoseReference | null>(
    () => loadBaselines().references.front ?? createDefaultBaselineReference('front'),
  );
  const [history, setHistory] = useState<SessionEntry[]>(() => {
    const stored = loadHistory(SESSION_STORAGE_KEY);
    if (stored.length) return stored;
    const legacy = loadHistory(LEGACY_SESSION_STORAGE_KEY);
    if (legacy.length) {
      saveHistory(SESSION_STORAGE_KEY, legacy);
      return legacy;
    }
    return [];
  });
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(() => localStorage.getItem(SOUND_WANTED_KEY) === '1');
  const [calibrationState, setCalibrationState] = useState<CalibrationState>('idle');
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showGoOverlay, setShowGoOverlay] = useState(false);
  const [checkingElapsedMs, setCheckingElapsedMs] = useState(0);
  const [activeBanner, setActiveBanner] = useState<string | null>(null);

  const previewMirrored = shouldMirrorPreview(cameraFacing);
  const feedbackMode = feedbackModeFor(feedbackSetting, workflowMode, coachingTrialState);
  const spokenCoachingEnabled = spokenTipsFor(feedbackSetting, feedbackMode, spokenTipsSwitch);
  const modeAllowsVisuals = feedbackMode === 'visual' || feedbackMode === 'combined';
  const modeAllowsAudio = feedbackMode === 'audio' || feedbackMode === 'combined';
  const tempoCuesSwitchRef = useRef(tempoCuesSwitch);
  useEffect(() => {
    tempoCuesSwitchRef.current = tempoCuesSwitch;
  }, [tempoCuesSwitch]);
  const gradingAngle = gradingAngleForView(cameraView);
  const feedbackModeRef = useRef(feedbackMode);
  const audioUnlockedRef = useRef(audioUnlocked);
  const spokenCoachingEnabledRef = useRef(spokenCoachingEnabled);
  const workflowModeRef = useRef(workflowMode);
  const coachingTrialStateRef = useRef(coachingTrialState);
  const coachingPausedRef = useRef(coachingPaused);
  const feedbackMemoryRef = useRef(createFeedbackMemory());
  const spokenFormCueRef = useRef<{ key: CorrectionKey | null; at: number }>({ key: null, at: 0 });

  const feedbackSettingRef = useRef(feedbackSetting);
  useEffect(() => {
    feedbackModeRef.current = feedbackMode;
  }, [feedbackMode]);
  useEffect(() => {
    feedbackSettingRef.current = feedbackSetting;
  }, [feedbackSetting]);
  useEffect(() => {
    if (adminUnlocked) return;
    setFeedbackSetting('study');
    setCameraView('head-on');
    setTempoCuesSwitch(true);
  }, [adminUnlocked]);
  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);
  useEffect(() => {
    spokenCoachingEnabledRef.current = spokenCoachingEnabled;
  }, [spokenCoachingEnabled]);
  useEffect(() => {
    workflowModeRef.current = workflowMode;
  }, [workflowMode]);
  useEffect(() => {
    coachingTrialStateRef.current = coachingTrialState;
  }, [coachingTrialState]);
  useEffect(() => {
    coachingPausedRef.current = coachingPaused;
  }, [coachingPaused]);
  useEffect(() => {
    localStorage.setItem(ADMIN_UNLOCK_KEY, adminUnlocked ? '1' : '0');
  }, [adminUnlocked]);
  useEffect(() => {
    saveBaselines(baselines);
  }, [baselines]);
  useEffect(() => {
    setBaselineDraft(baselines.references[baselineAngle] ?? createDefaultBaselineReference(baselineAngle));
  }, [baselineAngle, baselines.references]);
  useEffect(() => {
    calibrationStateRef.current = calibrationState;
  }, [calibrationState]);
  useEffect(() => {
    plankReferenceRef.current = {};
  }, [cameraView]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (calibrationState !== 'checking') {
      if (checkingTimerRef.current !== null) {
        window.clearInterval(checkingTimerRef.current);
        checkingTimerRef.current = null;
      }
      checkingStartedAtRef.current = null;
      setCheckingElapsedMs(0);
      return;
    }

    if (checkingStartedAtRef.current === null) {
      checkingStartedAtRef.current = Date.now();
    }

    if (checkingTimerRef.current !== null) return;

    checkingTimerRef.current = window.setInterval(() => {
      if (checkingStartedAtRef.current !== null) {
        setCheckingElapsedMs(Date.now() - checkingStartedAtRef.current);
      }
    }, 500);

    return () => {
      if (checkingTimerRef.current !== null) {
        window.clearInterval(checkingTimerRef.current);
        checkingTimerRef.current = null;
      }
    };
  }, [calibrationState]);
  useEffect(() => {
    if (coachingTrialState !== 'between-attempts' || restBypassed) return;
    if (restStartedAt === null) {
      setRestStartedAt(Date.now());
      return;
    }
    setRestNow(Date.now());
    if (restRemainingMs(restStartedAt, Date.now()) <= 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setRestNow(now);
      if (restRemainingMs(restStartedAt, now) > 0) return;
      window.clearInterval(timer);
      setToast({ tone: 'success', text: 'Rest complete — get into position for set 2.' });
      pushLog('system', 'Rest complete. Waiting for the push-up position to start set 2.');
      if (audioContextRef.current && audioUnlockedRef.current && feedbackModeRef.current !== 'visual') {
        playCueTone(audioContextRef.current);
      }
      waitForPosition(GET_INTO_POSITION);
    }, 250);
    return () => window.clearInterval(timer);
    // waitForPosition only touches refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachingTrialState, restStartedAt, restBypassed]);

  useEffect(() => {
    if (positionWaitSince === null) return;
    const timer = window.setTimeout(() => setManualStartVisible(true), Math.max(0, positionWaitSince + MANUAL_START_AFTER_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [positionWaitSince]);

  const setCalibration = (next: CalibrationState) => {
    calibrationStateRef.current = next;
    setCalibrationState(next);
  };

  const setTrialState = (next: CoachingTrialState) => {
    coachingTrialStateRef.current = next;
    setCoachingTrialState(next);
  };

  const setPaused = (next: boolean) => {
    coachingPausedRef.current = next;
    setCoachingPaused(next);
  };

  const orderedReps = useMemo(() => [...sessionReps].sort((a, b) => a.index - b.index), [sessionReps]);
  const set1Reps = useMemo(() => orderedReps.filter((rep) => rep.attempt === 1), [orderedReps]);
  const set2Reps = useMemo(() => orderedReps.filter((rep) => rep.attempt === 2), [orderedReps]);
  const set1Summary = useMemo(() => summarizeReps(set1Reps), [set1Reps]);
  const set2Summary = useMemo(() => summarizeReps(set2Reps), [set2Reps]);
  const overallSummary = useMemo(() => summarizeReps(orderedReps), [orderedReps]);
  const coachingComplete = set1Summary.count > 0 && set2Summary.count > 0;

  const phase = deriveJourneyPhase({
    cameraStatus,
    calibrationState,
    workflowMode,
    trialState: coachingTrialState,
    hasResults: sessionReps.length > 0,
  });
  phaseRef.current = phase;
  const skipConsent = adminUnlocked && adminSkipConsent;
  const testRunNoSave = adminUnlocked && adminNoSave;
  /** A session started (or switched) as a test run stays unsaved even if admin signs out on its results. */
  const resultsNotSaved = testRunNoSave || sessionNoSave;
  const steps = journeySteps(workflowMode);
  const stepKey = activeStepKey(phase, workflowMode, coachingTrialState, Boolean(athleteName.trim()));
  const cameraActive = phase === 'calibrating' || phase === 'countdown' || phase === 'set' || phase === 'break';
  /** The rest shows a short preview; getting into position for set 2 brings the full one back. */
  const stageCompact = phase === 'break' && positionWaitSince === null;
  /** Screens where the camera is the point: it gets almost the whole phone screen. */
  const liveStage = cameraActive && !stageCompact;
  const restRemaining = restBypassed ? 0 : restRemainingMs(restStartedAt, restNow);
  const restLocked = coachingTrialState === 'between-attempts' && restRemaining > 0;
  const restClock = formatRestClock(restRemaining);

  const currentAttempt: 0 | 1 | 2 =
    workflowMode !== 'coaching'
      ? 0
      : coachingTrialState === 'attempt-2' || coachingTrialState === 'complete'
        ? 2
        : 1;
  const currentSetReps = workflowMode === 'coaching' ? orderedReps.filter((rep) => rep.attempt === currentAttempt) : orderedReps;
  const lastRep = currentSetReps.at(-1) ?? null;

  const previousScore = useMemo(() => {
    const name = athleteName.trim();
    if (!name) return null;
    return history.find((entry) => entry.name === name && entry.createdAt !== sessionStartedAt)?.afterScore ?? null;
  }, [athleteName, history, sessionStartedAt]);

  const focusLines = useMemo(() => {
    if (workflowMode === 'coaching') return coachingFocusLines(coachingComplete ? set2Summary : set1Summary, cameraView);
    return coachingFocusLines(overallSummary, cameraView);
  }, [cameraView, coachingComplete, overallSummary, set1Summary, set2Summary, workflowMode]);

  const applyBaselineBias = (frame: PoseAnalysis): PoseAnalysis => {
    const reference = baselines.references[gradingAngleForView(frame.viewMode)];
    const smoothedAbduction = elbowSmootherRef.current.push(frame.elbowAbduction);
    const elbowAbduction = smoothedAbduction === null ? null : Math.round(smoothedAbduction);
    const elbowFlareScore = elbowTuckScore(elbowAbduction, elbowRangeFor(reference));
    const notes = withElbowNote(frame.notes, frame.viewMode, elbowFlareScore);
    if (!reference) {
      return {
        ...frame,
        elbowAbduction,
        elbowFlareScore,
        notes,
        overallScore: weightedRepScore(frame.viewMode, {
          depth: frame.elbowDepthScore,
          bodyLine: frame.bodyLineScore,
          elbowFlare: elbowFlareScore,
          handStack: frame.handStackScore,
          headAlignment: frame.headAlignmentScore,
        }),
      };
    }
    const score = (key: BaselineMetricKey, actual: number) => scoreAgainstBaseline(actual, reference.targets[key], reference.tolerances[key]);
    const elbowDepthScore = score('elbowDepthScore', frame.elbowDepthScore);
    const bodyLineScore = frame.bodyLineScore === null ? null : score('bodyLineScore', frame.bodyLineScore);
    const handStackScore = score('handStackScore', frame.handStackScore);
    const headAlignmentScore = score('headAlignmentScore', frame.headAlignmentScore);
    const framingScore = score('framingScore', frame.framingScore);
    return {
      ...frame,
      overallScore: weightedRepScore(frame.viewMode, {
        depth: elbowDepthScore,
        bodyLine: bodyLineScore,
        elbowFlare: elbowFlareScore,
        handStack: handStackScore,
        headAlignment: headAlignmentScore,
      }),
      elbowDepthScore,
      bodyLineScore,
      elbowFlareScore,
      elbowAbduction,
      notes,
      handStackScore,
      headAlignmentScore,
      framingScore,
      hipSagScore: frame.hipSagScore === null ? null : score('hipSagScore', frame.hipSagScore),
      hipPikeScore: frame.hipPikeScore === null ? null : score('hipPikeScore', frame.hipPikeScore),
    };
  };

  const liveMetrics = cameraView === 'head-on'
    ? [
      { label: 'Elbow depth', value: analysis?.elbowDepthScore ?? null },
      { label: 'Plank line', value: analysis?.bodyLineScore ?? null },
      { label: 'Elbow tuck', value: analysis?.elbowFlareScore ?? null },
      { label: 'Hands under shoulders', value: analysis?.handStackScore ?? null },
    ]
    : [
      { label: 'Elbow depth', value: analysis?.elbowDepthScore ?? null },
      { label: 'Plank line', value: analysis?.bodyLineScore ?? null },
      { label: 'Hip sag', value: analysis?.hipSagScore ?? null },
      { label: 'Hip pike (butt up)', value: analysis?.hipPikeScore ?? null },
    ];

  const neutralCoachText = modeAllowsAudio
    ? audioUnlocked
      ? 'Keep the phone steady.'
      : 'Tap Start camera and sound once to unlock cues on iPhone Safari.'
    : 'Control mode shows the camera and calibration gate only.';

  const calibrationChecklist: ChecklistItem[] = analysis
    ? cameraView === 'head-on'
      ? [
          { label: 'Body tracked', ok: analysis.confidence >= 0.72, detail: `${Math.round(analysis.confidence * 100)}%`, required: true },
          { label: 'Hands + torso in frame', ok: analysis.framingScore >= 64, detail: `${analysis.framingScore}%`, required: true },
          { label: 'Hands under shoulders', ok: analysis.handStackScore >= 50, detail: `${analysis.handStackScore}%`, required: false },
          { label: 'Head centered', ok: analysis.headAlignmentScore >= 50, detail: `${analysis.headAlignmentScore}%`, required: false },
        ]
      : [
          { label: 'Body tracked', ok: analysis.confidence >= 0.7, detail: `${Math.round(analysis.confidence * 100)}%`, required: true },
          { label: 'Full body in frame', ok: analysis.framingScore >= 62, detail: `${analysis.framingScore}%`, required: true },
          { label: 'Hip line visible', ok: analysis.hipSagScore !== null && analysis.hipPikeScore !== null, detail: 'side', required: false },
          { label: 'Hands under shoulders', ok: analysis.handStackScore >= 50, detail: `${analysis.handStackScore}%`, required: false },
        ]
    : [];

  const placementTip = cameraView === 'head-on'
    ? 'Phone low on the floor about 1.5 m in front of you. Hands, shoulders, and head should all be on screen.'
    : 'Phone at hip height about 2 m to your side, so shoulders, hips, and ankles fit.';

  useEffect(() => {
    if (!modeAllowsVisuals) {
      setCurrentCue(neutralCoachText);
    }
  }, [audioUnlocked, calibrationState, modeAllowsVisuals, neutralCoachText]);

  const pushLog = (kind: LogEntry['kind'], message: string, details?: string) => {
    setSessionLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        kind,
        message,
        details,
      },
      ...current,
    ].slice(0, 60));
  };

  const clearCalibrationTimers = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
    if (checkingTimerRef.current !== null) {
      window.clearInterval(checkingTimerRef.current);
      checkingTimerRef.current = null;
    }
    if (goOverlayTimerRef.current !== null) {
      window.clearTimeout(goOverlayTimerRef.current);
      goOverlayTimerRef.current = null;
    }
  };

  const resetCalibrationFlow = () => {
    clearCalibrationTimers();
    stableCalibrationFramesRef.current = 0;
    checkingStartedAtRef.current = null;
    setCheckingElapsedMs(0);
    setCalibration('checking');
    setCalibrationConfidence(0);
    setCountdownValue(null);
  };

  const beginCountdown = (options: { announce?: boolean } = {}) => {
    const announce = options.announce ?? true;
    if (countdownTimerRef.current !== null) return;
    if (announce && calibrationStateRef.current === 'counting') return;
    clearCalibrationTimers();
    setCalibration('countdown');
    setCountdownValue(null);
    setCurrentCue(announce ? 'Calibration complete' : 'Get ready');
    let countdown = 5;
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';
    const canSpeakCountdown = currentModeAllowsAudio && audioUnlockedRef.current;
    if (canSpeakCountdown) {
      clearVoiceQueue();
    }
    if (canSpeakCountdown && announce) {
      speak('Calibration complete');
    }

    const startCountdown = () => {
      setCountdownValue(5);
      setCurrentCue('5');
      if (canSpeakCountdown) {
        speak('5');
        speak('4');
        speak('3');
        speak('2');
        speak('1');
        speak(`Let's get started!`);
        speak('Go!');
      }
      countdownTimerRef.current = window.setInterval(() => {
        countdown -= 1;
        if (countdown > 0) {
          setCountdownValue(countdown);
          setCurrentCue(String(countdown));
          return;
        }

        clearCalibrationTimers();
        watchedCountdownRef.current = 0;
        setCountdownValue(null);
        setCalibration('counting');
        setShowGoOverlay(true);
        setActiveBanner(null);
        activeFailureRef.current = { text: '', frames: 0, startedAt: 0 };
        resetRepTracking();
        tempoLatencyRef.current = [];
        pushLog('info', 'Countdown finished. Hold the top of a push-up to start counting.');
        setCurrentCue('Go!');
        goOverlayTimerRef.current = window.setTimeout(() => {
          setShowGoOverlay(false);
          goOverlayTimerRef.current = null;
        }, 1100);
        if (audioContextRef.current) {
          playCueTone(audioContextRef.current);
        }
      }, 1000);
    };

    countdownTimerRef.current = window.setTimeout(startCountdown, announce ? 800 : 300);
  };

  /** Every set starts from nothing: no half-finished rep, no smoothing history, no tempo phase. */
  const resetRepTracking = () => {
    repMachineRef.current = createRepMachine();
    lockoutStallRef.current = { since: 0, cued: false };
    repAccumulatorRef.current = createEmptyRepAccumulator();
    elbowSmootherRef.current.reset();
    tempoStateRef.current = createTempoState(performance.now());
  };

  /** Spoken like the countdown (an instruction, not coaching), whenever the coming set's mode has audio. */
  const speakInstruction = (text: string, mode = feedbackModeRef.current) => {
    if (currentModeAllows(mode).audio && audioUnlockedRef.current) speak(text);
  };
  const setTwoMode = () => feedbackModeFor(feedbackSettingRef.current, workflowModeRef.current, 'attempt-2');

  /** After the rest: holding the top of a push-up starts set 2 (watchSetTwoStart). */
  const waitForPosition = (prompt: string) => {
    const now = Date.now();
    positionWaitRef.current = now;
    positionWatchRef.current = createPositionWatch();
    setPositionWaitSince(now);
    setPositionHoldPct(0);
    setManualStartVisible(false);
    holdCue(prompt, 4000);
    speakInstruction(prompt, setTwoMode());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stopWaitingForPosition = () => {
    positionWaitRef.current = null;
    setPositionWaitSince(null);
    setPositionHoldPct(0);
    setManualStartVisible(false);
  };

  const watchSetTwoStart = () => {
    const posture = postureRef.current;
    const now = Date.now();
    const step = watchPosition(positionWatchRef.current, { atTop: posture.atTop, horizontal: posture.horizontal, now });
    positionWatchRef.current = step.state;
    const { topSince } = step.state;
    const pct = topSince === null ? 0 : Math.min(100, Math.floor(((now - topSince) / AUTO_START_HOLD_MS) * 10) * 10);
    setPositionHoldPct(pct);
    if (step.holding) startSetTwo('auto');
  };

  /** A countdown started by holding the position stops if they drop out of the plank. */
  const watchCountdownPosition = () => {
    const posture = postureRef.current;
    const step = watchPosition(positionWatchRef.current, { atTop: posture.atTop, horizontal: posture.horizontal, now: Date.now() });
    positionWatchRef.current = step.state;
    if (!step.left) return false;
    const set = watchedCountdownRef.current;
    watchedCountdownRef.current = 0;
    clearCalibrationTimers();
    clearVoiceQueue();
    setCountdownValue(null);
    pushLog('info', `Left the push-up position during the countdown (${posture.reason}). Countdown stopped.`);
    if (set === 2) {
      setTrialState('between-attempts');
      setPaused(true);
      setCalibration('counting');
      waitForPosition(GET_BACK_INTO_POSITION);
    } else {
      stableCalibrationFramesRef.current = 0;
      setCalibration('checking');
      holdCue(GET_BACK_INTO_POSITION, 3000);
      speakInstruction(GET_BACK_INTO_POSITION);
    }
    return true;
  };

  const clearSessionData = () => {
    setSessionReps([]);
    setSessionLogs([]);
    setAnalysis(null);
    setCurrentCue('');
    setSessionStartedAt(null);
    setShowGoOverlay(false);
    setActiveBanner(null);
    resultSessionIdRef.current = newSessionId();
    setSessionNoSave(false);
    setUploadState('idle');
    setUploadMessage('');
    setSavedLocally(false);
    setShowShare(false);
    repCounterRef.current.reset();
    attemptRepCountRef.current = { 1: 0, 2: 0 };
    feedbackMemoryRef.current = createFeedbackMemory();
    spokenFormCueRef.current = { key: null, at: 0 };
    resetRepTracking();
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    plankReferenceRef.current = {};
    setRestStartedAt(null);
    setRestBypassed(false);
    stopWaitingForPosition();
    watchedCountdownRef.current = 0;
  };

  const unlockSound = async () => {
    playVoiceClip('ready', 'Ready!');
    preloadVoiceClips([
      'calibration-complete',
      'countdown-1',
      'countdown-2',
      'countdown-3',
      'countdown-4',
      'countdown-5',
      'lets-get-started',
      'go',
      'back-up-for-hands-and-torso',
      ...[GET_INTO_POSITION, GET_BACK_INTO_POSITION].flatMap((line) => resolveVoiceClipNames(line) ?? []),
      ...allFeedbackLines()
        .filter((line) => !line.includes('improved by'))
        .flatMap((line) => resolveVoiceClipNames(line) ?? []),
    ]);
    setAudioUnlocked(true);
    localStorage.setItem(SOUND_WANTED_KEY, '1');
    const unlocked = await unlockAudioContext(audioContextRef);
    if (unlocked && audioContextRef.current) {
      const context = audioContextRef.current;
      void loadTempoCues(context).then((ready) =>
        pushLog('info', ready ? `Tempo cues ready (audio output latency ≈ ${Math.round(audioOutputLatencyMs(context))} ms).` : 'Tempo cues could not be decoded.'),
      );
    }
    if (unlocked && modeAllowsAudio) {
      pushLog('info', 'Sound unlocked.');
      if (audioContextRef.current) {
        playCueTone(audioContextRef.current);
      }
    }
  };

  const isCalibrationReady = (frame: PoseAnalysis) => {
    if (cameraView === 'head-on') {
      return frame.confidence >= 0.72 && frame.framingScore >= 64;
    }
    return frame.confidence >= 0.7 && frame.framingScore >= 62;
  };

  const getRequiredFailureText = (frame: PoseAnalysis) => {
    const hint = frame.setupHint?.toLowerCase() ?? '';
    if (!hint) return null;
    if (hint.includes('hands') && hint.includes('torso')) return 'Move back — hands and torso not visible';
    if (hint.includes('hands')) return 'Move back — hands not visible';
    if (hint.includes('torso')) return 'Move back — torso not visible';
    if (hint.includes('shoulders')) return 'Move back — shoulders not visible';
    if (hint.includes('full side profile')) return 'Move back — full body not visible';
    if (frame.confidence < 0.65) return 'Hold still — need a clearer view';
    return null;
  };

  const buildSessionSummary = () => {
    const coachingScores = workflowMode === 'coaching' && coachingComplete;
    const beforeScore = coachingScores ? set1Summary.average : previousScore ?? 0;
    const afterScore = coachingScores ? set2Summary.average : overallSummary.average;
    return {
      id: `${Date.now()}`,
      name: athleteName.trim() || 'Anonymous',
      dateIso: sessionStartedAt ?? nowIso(),
      reps: overallSummary.count,
      averageScore: overallSummary.average,
      bestScore: overallSummary.best,
      beforeScore,
      afterScore,
      spokenCoachingEnabled,
      notes: [...new Set([...focusLines, ...sessionReps.flatMap((rep) => rep.notes)])].slice(0, 8),
    };
  };

  const buildSessionEntry = (): SessionEntry => {
    const summary = buildSessionSummary();
    return {
      id: summary.id,
      name: summary.name,
      createdAt: summary.dateIso,
      reps: summary.reps,
      averageScore: summary.averageScore,
      bestScore: summary.bestScore,
      beforeScore: summary.beforeScore,
      afterScore: summary.afterScore,
      mode: feedbackMode,
      cameraFacing,
      cameraView,
      notes: summary.notes,
    };
  };

  const currentModeAllows = (mode = feedbackModeRef.current) => ({
    visuals: mode === 'visual' || mode === 'combined',
    audio: mode === 'audio' || mode === 'combined',
  });

  const canSpeakTips = () => spokenCoachingEnabledRef.current && currentModeAllows().audio && audioUnlockedRef.current;

  /** Live spoken form cue: rotated phrasing, never the line just spoken, and spaced out from rep cues. */
  const speakFormCue = (key: CorrectionKey) => {
    if (!canSpeakTips()) return;
    const now = Date.now();
    if (now < repSpeechLockUntilRef.current) return;
    const last = spokenFormCueRef.current;
    if (last.key === key && now - last.at < 6000) return;
    const phrase = correctionPhrase(feedbackMemoryRef.current, key);
    feedbackMemoryRef.current = phrase.memory;
    spokenFormCueRef.current = { key, at: now };
    repSpeechLockUntilRef.current = now + 2500;
    pushLog('cue', phrase.text);
    speak(phrase.text);
  };

  const renderAnalysisCue = (cue: string, formKey?: CorrectionKey) => {
    const shortCue = shortenCue(cue);
    const now = Date.now();
    if (now < cueHoldUntilRef.current) return;
    const isNewCue = shortCue !== cueLastTextRef.current;
    const cooldownExpired = now - cueLastEmittedAtRef.current >= 5000;
    if (!isNewCue && !cooldownExpired) return;

    cueLastTextRef.current = shortCue;
    cueLastEmittedAtRef.current = now;
    if (currentModeAllows().visuals) {
      setCurrentCue(shortCue);
    }

    if (formKey) {
      speakFormCue(formKey);
      return;
    }
    if (!canSpeakTips() || now < repSpeechLockUntilRef.current) return;
    pushLog('cue', shortCue);
    speak(shortCue);
  };

  /** Shows a cue and keeps live cues from replacing it for a moment. */
  const holdCue = (text: string, holdMs = 2500) => {
    cueLastTextRef.current = text;
    cueLastEmittedAtRef.current = Date.now();
    cueHoldUntilRef.current = Date.now() + holdMs;
    setCurrentCue(text);
  };

  const updateCoachingFocus = (frame: PoseAnalysis) => {
    const now = Date.now();
    // Depth is judged per rep (it reads 0 at every top), and straight arms at the top say nothing about elbow tuck.
    const issues = liveCoachingIssues(frame, calibrationStateRef.current === 'counting').filter(
      (issue) => issue.key !== 'depth' && (issue.key !== 'elbowFlare' || frame.elbowAngle <= 140),
    );
    const formKey = (key: CoachingIssueKey) => (key === 'setup' ? undefined : key);
    const active = coachingFocusRef.current;
    const activeIssue = active.key ? issues.find((issue) => issue.key === active.key) : null;

    if (activeIssue) {
      coachingFocusRef.current = { key: activeIssue.key, resolvedAt: null, cue: activeIssue.cue };
      renderAnalysisCue(activeIssue.cue, formKey(activeIssue.key));
      return;
    }

    if (!active.key) {
      const nextIssue = issues[0];
      if (nextIssue) {
        coachingFocusRef.current = { key: nextIssue.key, resolvedAt: null, cue: nextIssue.cue };
        renderAnalysisCue(nextIssue.cue, formKey(nextIssue.key));
      }
      return;
    }

    if (active.resolvedAt === null) {
      coachingFocusRef.current = { ...active, resolvedAt: now };
      return;
    }

    if (now - active.resolvedAt < 6000) {
      return;
    }

    const nextIssue = issues[0];
    if (nextIssue) {
      coachingFocusRef.current = { key: nextIssue.key, resolvedAt: null, cue: nextIssue.cue };
      renderAnalysisCue(nextIssue.cue, formKey(nextIssue.key));
      return;
    }

    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
  };

  const finishRep = (analysisFrame: PoseAnalysis) => {
    const accumulator = repAccumulatorRef.current;
    repAccumulatorRef.current = createEmptyRepAccumulator();
    if (!accumulator.bottomFrames.length) return;
    const nextRepIndex = repCounterRef.current.next();
    const rep = finalizeRep(accumulator, analysisFrame, nextRepIndex);
    if (!rep) return;
    const attempt = workflowModeRef.current === 'coaching' ? attemptForTrialState(coachingTrialStateRef.current) : 0;
    rep.feedbackMode = feedbackModeRef.current;
    rep.tempoCues = tempoCuesActive();
    if (attempt) {
      rep.attempt = attempt;
      attemptRepCountRef.current[attempt] += 1;
    }
    setSessionReps((current) => [rep, ...current].slice(0, 50));
    pushLog(
      'rep',
      `Rep ${rep.index}${attempt ? ` (set ${attempt})` : ''} scored ${rep.score}/100`,
      [
        `depth ${rep.elbowDepthScore} · plank ${rep.bodyLineScore ?? 'n/a'} · elbow ${rep.elbowFlareScore}${rep.elbowAbduction === undefined ? '' : ` (${rep.elbowAbduction}°)`}`,
        `plank: ${rep.plankDebug ?? 'n/a'}`,
        ...rep.notes,
      ].join(' • '),
    );
    const nextTrialState = attempt ? trialStateAfterRep(coachingTrialStateRef.current, attemptRepCountRef.current[attempt]) : coachingTrialStateRef.current;
    const setFinished = nextTrialState !== coachingTrialStateRef.current;
    const allows = currentModeAllows();
    const canSpeak = allows.audio && audioUnlockedRef.current;

    // A set's last rep goes straight to the wrap-up; a correction can't be used once the set is over.
    if (feedbackModeRef.current !== 'control' && !setFinished) {
      const feedback = repFeedback(feedbackMemoryRef.current, rep);
      feedbackMemoryRef.current = feedback.memory;
      if (feedback.text && allows.visuals) holdCue(feedback.text);
      if (canSpeak) {
        repSpeechLockUntilRef.current = Date.now() + 3000;
        if (spokenCoachingEnabledRef.current) {
          if (feedback.text) {
            spokenFormCueRef.current = { key: feedback.key === 'neutral' ? null : feedback.key, at: Date.now() };
            pushLog('cue', feedback.text);
            speak(feedback.text);
          }
        } else {
          speak(`Rep ${attempt ? attemptRepCountRef.current[attempt] : nextRepIndex}`);
        }
      }
    }

    if (!attempt || !setFinished) return;
    logTempoSummary(`set ${attempt}`);
    setTrialState(nextTrialState);
    setPaused(true);
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    feedbackMemoryRef.current = createFeedbackMemory();
    if (nextTrialState === 'between-attempts') {
      const startedAt = Date.now();
      setRestStartedAt(startedAt);
      setRestNow(startedAt);
      setRestBypassed(false);
      pushLog('system', `Set 1 complete. ${formatRestClock(REST_BREAK_MS)} rest before set 2.`);
      // Nothing from set 1's coaching carries into the rest.
      clearVoiceQueue();
      setActiveBanner(null);
      activeFailureRef.current = { text: '', frames: 0, startedAt: 0 };
      spokenFormCueRef.current = { key: null, at: 0 };
      holdCue('Set 1 done — nice work! Rest 2 minutes and watch the ideal form.', 6000);
      const breakMode = feedbackModeFor(feedbackSettingRef.current, workflowModeRef.current, 'between-attempts');
      if (currentModeAllows(breakMode).audio && audioUnlockedRef.current) {
        speak(SET_ONE_WRAP_UP);
      }
    } else {
      const setAverage = (reps: SessionRep[]) => summarizeReps(reps).average;
      const set1Average = setAverage(sessionReps.filter((item) => item.attempt === 1));
      const set2Average = setAverage([rep, ...sessionReps.filter((item) => item.attempt === 2)]);
      const wrapUp = sessionWrapUp(set2Average - set1Average);
      pushLog('system', `Set 2 complete. Set 1 ${set1Average} → set 2 ${set2Average}.`);
      holdCue(wrapUp, 6000);
      if (canSpeak) speak(wrapUp);
    }
  };

  const tempoCuesActive = () => tempoCuesFor(feedbackModeRef.current, tempoCuesSwitchRef.current) && audioUnlockedRef.current;

  /** Real-time Up/Down: played straight from the pose frame that crosses the threshold, no queue. */
  const stepTempoCues = (frame: PoseAnalysis) => {
    if (!tempoCuesActive()) return;
    const attempt = workflowModeRef.current === 'coaching' ? attemptForTrialState(coachingTrialStateRef.current) : 0;
    // A rep that reached the bottom completes at this lockout; if it's the set's last, no Down follows.
    const repsAfterThisTop = attempt ? attemptRepCountRef.current[attempt] + (repMachineRef.current.sawBottom ? 1 : 0) : 0;
    const step = stepTempo(tempoStateRef.current, {
      elbowAngle: frame.elbowAngle,
      depthScore: frame.elbowDepthScore,
      now: performance.now(),
      allowDown: !attempt || repsAfterThisTop < REPS_PER_SET,
      speechBusy: !voiceQueueIdle(),
    });
    tempoStateRef.current = step.state;
    if (!step.cue) return;
    const context = audioContextRef.current;
    const durationMs = context ? playTempoCue(context, step.cue) : null;
    const startedAt = performance.now();
    if (!context || durationMs === null) {
      if (!tempoUnavailableLoggedRef.current) {
        tempoUnavailableLoggedRef.current = true;
        pushLog('info', `Tempo cue skipped: ${tempoCuesReady(context) ? 'audio context not running' : 'clips not decoded yet'}.`);
      }
      return;
    }
    // Coaching lines wait for the gap after the cue; one already playing is ducked under it.
    duckVoice(durationMs + 150);
    holdVoiceQueue(durationMs + 120);
    const timing = frameTimingRef.current;
    const sample: TempoLatency = {
      cue: step.cue,
      poseToStartMs: startedAt - timing.resultAt,
      inferenceMs: timing.resultAt - timing.detectStartedAt,
      outputMs: audioOutputLatencyMs(context),
    };
    tempoLatencyRef.current.push(sample);
    logTempoCue(step.cue, sample);
  };

  const logTempoCue = (cue: TempoCue, sample: TempoLatency) => {
    pushLog(
      'cue',
      `Tempo “${cue === 'up' ? 'Up' : 'Down'}”`,
      `pose → play ${sample.poseToStartMs.toFixed(1)} ms + audio output ${Math.round(sample.outputMs)} ms (pose inference ${Math.round(sample.inferenceMs)} ms)`,
    );
  };

  const logTempoSummary = (label: string) => {
    const summary = summarizeLatency(tempoLatencyRef.current);
    tempoLatencyRef.current = [];
    if (!summary) return;
    pushLog(
      'info',
      `Tempo cues ${label}: ${summary.count} played, pose → sound median ${summary.medianMs} ms, max ${summary.maxMs} ms (+ pose inference ~${summary.medianInferenceMs} ms).`,
    );
  };

  const updateRepState = (frame: PoseAnalysis) => {
    if (calibrationStateRef.current !== 'counting') return;
    const { elbowAngle, confidence } = frame;
    const now = Date.now();
    if (confidence < MIN_SIGNAL) return;
    const previous = repMachineRef.current;
    // No Up/Down while they're still getting into position.
    if (previous.armed) stepTempoCues(frame);

    const posture = postureRef.current;
    const step = stepRep(previous, { elbowAngle, horizontal: posture.horizontal, now });
    repMachineRef.current = step.state;
    if (step.accumulate) repAccumulatorRef.current = addRepFrame(repAccumulatorRef.current, frame, REP_BOTTOM_ANGLE);

    switch (step.event) {
      case 'armed':
        repAccumulatorRef.current = createEmptyRepAccumulator();
        pushLog('system', 'Top position locked in. Counting reps.');
        return;
      case 'top':
        repAccumulatorRef.current = createEmptyRepAccumulator();
        return;
      case 'disarmed':
        repAccumulatorRef.current = createEmptyRepAccumulator();
        lockoutStallRef.current = { since: 0, cued: false };
        tempoStateRef.current = createTempoState(performance.now());
        pushLog('info', `Left the plank (${posture.reason}). Hold the top of a push-up to count again.`);
        return;
      case 'rejected-fast':
      case 'rejected-posture':
        repAccumulatorRef.current = createEmptyRepAccumulator();
        lockoutStallRef.current = { since: 0, cued: false };
        pushLog(
          'info',
          step.event === 'rejected-fast'
            ? `Rep not counted: down and up in ${repInProgressMs(previous, now)} ms is too fast to be real.`
            : 'Rep not counted: the body wasn’t in a plank for most of it.',
        );
        return;
      case 'rep':
        lockoutStallRef.current = { since: 0, cued: false };
        finishRep(frame);
        return;
      default:
        break;
    }

    const stall = lockoutStallRef.current;
    const stalledShort = step.state.sawBottom && elbowAngle >= LOCKOUT_STALL_MIN_ANGLE && elbowAngle < REP_TOP_ANGLE;
    stall.since = stalledShort ? stall.since || now : 0;
    if (stalledShort && !stall.cued && now - stall.since >= LOCKOUT_STALL_MS && feedbackModeRef.current !== 'control') {
      stall.cued = true;
      if (currentModeAllows().visuals) holdCue(CORRECTIVE_LINES.lockout[0], 2000);
      speakFormCue('lockout');
    }
  };

  const isResting = () => workflowModeRef.current === 'coaching' && coachingTrialStateRef.current === 'between-attempts';

  const processAnalysis = (frame: PoseAnalysis) => {
    setAnalysis(frame);
    const smoothConfidence = confidenceSmoothRef.current
      ? confidenceSmoothRef.current * 0.85 + frame.confidence * 0.15
      : frame.confidence;
    confidenceSmoothRef.current = smoothConfidence;
    setCalibrationConfidence(Math.round(smoothConfidence * 100));

    // The rest between sets is coaching-free: the live pose triggers no cues, banners, or speech.
    // Once it's over the pose is only watched for the push-up position that starts set 2.
    if (isResting()) {
      if (positionWaitRef.current !== null) watchSetTwoStart();
      return;
    }
    if (calibrationStateRef.current === 'countdown' && watchedCountdownRef.current && watchCountdownPosition()) return;

    const isCounting = calibrationStateRef.current === 'counting';
    const lostTrackingText = 'Move back — body lost';
    const lostTracking = frame.confidence < 0.32 || frame.framingScore < 20;
    const failureText = isCounting ? (lostTracking ? lostTrackingText : null) : getRequiredFailureText(frame);
    if (failureText) {
      if (activeFailureRef.current.text === failureText) {
        activeFailureRef.current.frames += 1;
      } else {
        activeFailureRef.current = { text: failureText, frames: 1, startedAt: Date.now() };
      }
      const persistMs = Date.now() - activeFailureRef.current.startedAt;
      if (activeFailureRef.current.frames >= 30 || persistMs >= 1000) {
        setActiveBanner(failureText);
        renderAnalysisCue(failureText);
      }
    } else {
      activeFailureRef.current = { text: '', frames: 0, startedAt: 0 };
      setActiveBanner(null);
    }

    if (frame.confidence < MIN_SIGNAL) {
      setCurrentCue(frame.setupHint ?? 'Move your whole body into frame.');
      return;
    }

    const currentModeAllowsVisuals = feedbackModeRef.current === 'visual' || feedbackModeRef.current === 'combined';
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';

    if (calibrationStateRef.current !== 'counting') {
      const ready = isCalibrationReady(frame);
      if (ready && !postureRef.current.atTop && calibrationStateRef.current !== 'countdown') {
        stableCalibrationFramesRef.current = 0;
        if (calibrationStateRef.current === 'ready') setCalibration('checking');
        setCurrentCue('Hold the top of a push-up');
      } else if (ready) {
        stableCalibrationFramesRef.current += 1;
        if (stableCalibrationFramesRef.current >= 3 && calibrationStateRef.current === 'checking') {
          setCalibration('ready');
          setCurrentCue('Ready');
        }
      } else {
        stableCalibrationFramesRef.current = 0;
        if (calibrationStateRef.current !== 'countdown') {
          setCalibration('checking');
          setCountdownValue(null);
          setCurrentCue(frame.setupHint ?? 'Finding you…');
        }
      }
      return;
    }

    if (workflowModeRef.current === 'coaching' && coachingPausedRef.current) return;

    if (feedbackModeRef.current !== 'control') {
      updateCoachingFocus(frame);
    }
    if (!currentModeAllowsVisuals && currentModeAllowsAudio) {
      setCurrentCue(audioUnlockedRef.current ? 'Audio cues active.' : 'Tap Start camera and sound for audio cues.');
    } else if (!currentModeAllowsVisuals) {
      setCurrentCue('Control mode: camera only.');
    }
    updateRepState(frame);
  };

  /** The stream size the preview is laid out with (see pickFrameSize for why it isn't just videoWidth). */
  const currentFrameSize = () => {
    const video = videoRef.current;
    if (!video) return null;
    return pickFrameSize({
      element: { width: video.videoWidth, height: video.videoHeight },
      frame: frameMetaRef.current,
      bitmap: bitmapSizeRef.current,
      settings: streamSettingsRef.current,
    });
  };

  const probeBitmapSize = async () => {
    const video = videoRef.current;
    if (!video || !runningRef.current || video.readyState < 2 || typeof createImageBitmap !== 'function') return;
    try {
      const bitmap = await createImageBitmap(video);
      if (bitmap.width > 0 && bitmap.height > 0) bitmapSizeRef.current = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      // Some WebKit builds can't snapshot a camera stream; requestVideoFrameCallback covers those.
    }
  };

  /** Re-attaching srcObject makes WebKit rebuild the video layer and re-read the stream size. */
  const reattachStream = (reason: string) => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || !runningRef.current) return;
    frameMetaRef.current = null;
    bitmapSizeRef.current = null;
    video.srcObject = null;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    stageLayoutRef.current = null;
    layoutStage();
    window.setTimeout(() => void probeBitmapSize(), 300);
    pushLog('system', `Camera preview re-attached (${reason}).`, stageDiagnosticsText());
  };

  const stageDiagnosticsText = () => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return '';
    const stageBox = stage.getBoundingClientRect();
    const inner = { left: stageBox.left + stage.clientLeft, top: stageBox.top + stage.clientTop, width: stage.clientWidth, height: stage.clientHeight };
    const box = video.getBoundingClientRect();
    const videoRect = { left: box.left - inner.left, top: box.top - inner.top, width: box.width, height: box.height };
    return describeStage({
      phase: phaseRef.current,
      fixes: stageFixesRef.current,
      stage: { width: inner.width, height: inner.height },
      stream: currentFrameSize(),
      element: { width: video.videoWidth, height: video.videoHeight },
      frame: frameMetaRef.current,
      bitmap: bitmapSizeRef.current,
      settings: streamSettingsRef.current,
      videoRect,
      coverage: stageCoverage(videoRect, { left: 0, top: 0, width: inner.width, height: inner.height }),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visualViewport: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height } : null,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      orientation: screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
      readyState: video.readyState,
      paused: video.paused,
    });
  };

  /**
   * Sizes the video and the overlay from one cover transform of the stream into the stage. Runs on
   * every pose-loop tick, every watchdog tick, and on stream/stage/viewport/orientation changes, so a
   * size change can never leave the two layers out of step.
   */
  const layoutStage = () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!stage || !video || !canvas) return null;
    const size = currentFrameSize();
    const next = coverLayout(stage.clientWidth, stage.clientHeight, size?.width ?? 0, size?.height ?? 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (sameLayout(next, stageLayoutRef.current) && dpr === stageDprRef.current) return next;
    stageLayoutRef.current = next;
    stageDprRef.current = dpr;
    if (!next) return null;
    Object.assign(video.style, { width: `${next.width}px`, height: `${next.height}px`, left: `${next.offsetX}px`, top: `${next.offsetY}px` });
    canvas.style.width = `${next.stageWidth}px`;
    canvas.style.height = `${next.stageHeight}px`;
    canvas.width = Math.round(next.stageWidth * dpr);
    canvas.height = Math.round(next.stageHeight * dpr);
    return next;
  };

  const drawSkeleton = (landmarks: PosePoint[] | null | undefined) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const layout = layoutStage();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!layout || !landmarks?.length) return;
    ctx.setTransform(stageDprRef.current, 0, 0, stageDprRef.current, 0, 0);
    // Landmarks stay in raw camera coordinates for scoring; mirroring happens only when drawing.
    const at = (point: PosePoint) => toStagePoint(point, layout, previewMirrored);
    const radius = Math.max(3, Math.min(layout.stageWidth, layout.stageHeight) / 110);
    ctx.lineWidth = Math.max(2.5, radius * 0.9);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(190, 255, 92, 0.85)';
    ctx.fillStyle = '#f4ffe0';

    const joints: Array<[number, number]> = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 24], [12, 23],
    ];

    for (const [a, b] of joints) {
      const start = landmarks[a];
      const end = landmarks[b];
      if (!start || !end) continue;
      if ((start.visibility ?? 0) < 0.3 || (end.visibility ?? 0) < 0.3) continue;
      const from = at(start);
      const to = at(end);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    for (const point of landmarks) {
      if ((point.visibility ?? 0) < 0.3) continue;
      const { x, y } = at(point);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;
    const relayout = () => {
      stageLayoutRef.current = null;
      layoutStage();
    };
    const onOrientation = () => {
      relayout();
      // iOS reports the new viewport a beat after the event, and its video layer can keep the old fit.
      window.setTimeout(() => {
        relayout();
        if (IS_IOS) reattachStream('orientation change');
      }, 300);
    };
    const onStreamResize = () => {
      // The decoded-frame readings belong to the old size until the next frame/probe.
      frameMetaRef.current = null;
      bitmapSizeRef.current = null;
      relayout();
      window.setTimeout(() => void probeBitmapSize(), 150);
    };
    video.addEventListener('loadedmetadata', onStreamResize);
    video.addEventListener('resize', onStreamResize);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', onOrientation);
    window.visualViewport?.addEventListener('resize', relayout);
    screen.orientation?.addEventListener?.('change', onOrientation);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
    observer?.observe(stage);
    return () => {
      video.removeEventListener('loadedmetadata', onStreamResize);
      video.removeEventListener('resize', onStreamResize);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('orientationchange', onOrientation);
      window.visualViewport?.removeEventListener('resize', relayout);
      screen.orientation?.removeEventListener?.('change', onOrientation);
      observer?.disconnect();
    };
    // layoutStage and reattachStream only read refs, so the first render's copies stay correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showStageDiag = adminUnlocked && (stageDiagPinned || stageDiagTripped);

  useEffect(() => {
    localStorage.setItem(STAGE_DIAG_KEY, stageDiagPinned ? '1' : '0');
  }, [stageDiagPinned]);

  // Decoded-frame size probes plus the preview watchdog, for as long as the camera is live.
  useEffect(() => {
    if (cameraStatus !== 'live') return;
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;
    let cancelled = false;
    let frameHandle: number | null = null;
    const watchFrames = () => {
      if (typeof video.requestVideoFrameCallback !== 'function') return;
      if (frameHandle !== null) video.cancelVideoFrameCallback(frameHandle);
      const onFrame: VideoFrameRequestCallback = (_now, meta) => {
        if (cancelled) return;
        if (meta.width > 0 && meta.height > 0) frameMetaRef.current = { width: meta.width, height: meta.height };
        frameMetaAtRef.current = performance.now();
        frameHandle = video.requestVideoFrameCallback(onFrame);
      };
      frameMetaAtRef.current = performance.now();
      frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    watchFrames();
    const probes = [400, 1200, 2500, 5000].map((ms) => window.setTimeout(() => void probeBitmapSize(), ms));
    const probeTimer = window.setInterval(() => void probeBitmapSize(), 5000);

    let ticks = 0;
    let lastElement = '';
    const tick = () => {
      ticks += 1;
      const now = performance.now();
      // A re-attached stream can drop pending frame callbacks on some engines.
      if (!video.paused && now - frameMetaAtRef.current > 1000) watchFrames();
      const element = `${video.videoWidth}x${video.videoHeight}`;
      if (element !== lastElement) {
        if (lastElement) {
          bitmapSizeRef.current = null;
          window.setTimeout(() => void probeBitmapSize(), 150);
        }
        lastElement = element;
      }
      const layout = layoutStage();
      if (!stage.clientWidth || !stage.clientHeight) {
        watchdogRef.current = createWatchdog();
        return;
      }
      const stageBox = stage.getBoundingClientRect();
      const inner = { left: stageBox.left + stage.clientLeft, top: stageBox.top + stage.clientTop, width: stage.clientWidth, height: stage.clientHeight };
      const coverage = stageCoverage(video.getBoundingClientRect(), inner);
      const size = currentFrameSize();
      const mismatch = !size || size.source !== 'element';
      const bad = !layout || mismatch || coverage.x < COVERAGE_MIN || coverage.y < COVERAGE_MIN;
      const step = stepWatchdog(watchdogRef.current, bad, now);
      watchdogRef.current = step.state;
      if (step.action === 'relayout') {
        stageFixesRef.current += 1;
        stageLayoutRef.current = null;
        layoutStage();
        setStageDiagTripped(true);
        if (stageFixesRef.current <= 10) pushLog('system', 'Camera preview didn’t fill the stage; re-laid out.', stageDiagnosticsText());
      } else if (step.action === 'reattach' && watchdogReattachesRef.current < MAX_WATCHDOG_REATTACHES) {
        watchdogReattachesRef.current += 1;
        stageFixesRef.current += 1;
        reattachStream('watchdog');
      }
      if (stageDiagRef.current && ticks % 3 === 0) stageDiagRef.current.textContent = stageDiagnosticsText();
    };
    const watchdogTimer = window.setInterval(tick, 100);
    return () => {
      cancelled = true;
      if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
      probes.forEach((id) => window.clearTimeout(id));
      window.clearInterval(probeTimer);
      window.clearInterval(watchdogTimer);
    };
    // Everything it touches is a ref or a stable setter; it only needs to restart with the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraStatus]);

  // Screen changes resize the stage (the break shows a shorter preview). Log the numbers once the
  // layout settles, and on iOS rebuild the video layer so it can't keep the previous screen's fit.
  const screenKey = stageCompact ? `${phase} (compact)` : phase;
  const previousScreenRef = useRef({ key: screenKey, compact: stageCompact });
  useEffect(() => {
    const previous = previousScreenRef.current;
    previousScreenRef.current = { key: screenKey, compact: stageCompact };
    if (cameraStatus !== 'live' || previous.key === screenKey || !cameraActive) return;
    const timers: number[] = [];
    if (IS_IOS && previous.compact !== stageCompact) timers.push(window.setTimeout(() => reattachStream(`${previous.key} → ${screenKey}`), 120));
    timers.push(window.setTimeout(() => pushLog('info', `Preview on ${screenKey} screen.`, stageDiagnosticsText()), 700));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey]);

  useEffect(() => {
    frameHandlerRef.current = (landmarks, worldLandmarks) => {
      drawSkeleton(modeAllowsVisuals && (!isResting() || positionWaitRef.current !== null) ? landmarks : null);
      const size = currentFrameSize();
      const aspect = size ? size.width / size.height : 0.75;
      const plankReference = plankReferenceRef.current;
      const frame = applyBaselineBias(analyzePose(landmarks, cameraView, { worldLandmarks, aspect, plankReference }));
      const posture = plankPosture(landmarks, cameraView, aspect, frame.elbowAngle);
      postureRef.current = posture;
      const inPlank = calibrationStateRef.current !== 'idle' && calibrationStateRef.current !== 'checking' && !isResting() && posture.atTop;
      if (cameraView === 'head-on' && inPlank && frame.confidence >= 0.72) {
        plankReferenceRef.current = updatePlankReference(plankReference, landmarks, aspect);
      }
      processAnalysis(frame);
    };
  });

  const stopCamera = () => {
    runningRef.current = false;
    clearCalibrationTimers();
    stopWaitingForPosition();
    watchedCountdownRef.current = 0;
    setCalibration('idle');
    setCountdownValue(null);
    setCalibrationConfidence(0);
    setActiveBanner(null);
    stableCalibrationFramesRef.current = 0;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    streamSettingsRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setShowGoOverlay(false);
  };

  // Must stay synchronous up to unlockSound() so iOS treats the Ready clip as part of the tap gesture.
  const startCamera = async () => {
    if (!poseRef.current || !videoRef.current) {
      setCameraError('Pose model is not ready yet.');
      return;
    }
    setCameraStatus('loading');
    setCameraError('');
    stopCamera();
    resetCalibrationFlow();
    plankReferenceRef.current = {};
    void unlockSound();
    try {
      const portraitPhone = prefersPortraitCamera({
        coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      // A portrait phone streams portrait video; asking for 16:9 landscape made iOS report 1280×720
      // settings for a 720×1280 stream.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: portraitPhone
          ? { facingMode: { ideal: cameraFacing }, width: { ideal: 720 }, height: { ideal: 1280 } }
          : { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } },
      });
      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      streamSettingsRef.current = settings?.width && settings.height ? { width: settings.width, height: settings.height } : null;
      frameMetaRef.current = null;
      bitmapSizeRef.current = null;
      watchdogRef.current = createWatchdog();
      watchdogReattachesRef.current = 0;
      if (settings?.width && settings.height) pushLog('info', `Camera stream ${settings.width}×${settings.height}.`);
      const video = videoRef.current;
      // React only sets the muted property; iOS inline autoplay looks for the attributes.
      video.muted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setCameraStatus('live');
      setSessionStartedAt((current) => current ?? nowIso());
      pushLog('system', `Camera started (${cameraFacing}).`);
      const loop = () => {
        if (!runningRef.current || !poseRef.current || !videoRef.current) return;
        const videoEl = videoRef.current;
        layoutStage();
        if (videoEl.readyState >= 2) {
          const detectStartedAt = performance.now();
          const result = poseRef.current.detectForVideo(videoEl, detectStartedAt);
          frameTimingRef.current = { detectStartedAt, resultAt: performance.now() };
          frameHandlerRef.current(result.landmarks[0] as PosePoint[] | undefined, result.worldLandmarks?.[0] as PosePoint[] | undefined);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (error) {
      console.error(error);
      setCameraStatus('error');
      setCameraError('Camera access was blocked. Allow camera access in the browser and try again.');
      pushLog('system', 'Camera access failed.');
      stopCamera();
    }
  };

  const startSession = () => {
    if (!skipConsent && !isConsentValidFor(currentConsent, athleteName)) {
      setConsentOpen(Boolean(athleteName.trim()));
      return;
    }
    if (workflowMode === 'coaching') {
      clearSessionData();
      setTrialState('attempt-1');
      setPaused(false);
    } else {
      clearSessionData();
      setTrialState('idle');
      setPaused(false);
    }
    setSessionNoSave(testRunNoSave);
    if (skipConsent && !isConsentValidFor(currentConsent, athleteName)) pushLog('system', 'Admin test run: consent form skipped.');
    if (testRunNoSave) pushLog('system', 'Admin test run: results will not be saved to the sheet.');
    void startCamera();
  };

  /** `auto`: the push-up position was held, and the countdown stops if they leave it. */
  const startSetTwo = (source: 'auto' | 'manual' = 'manual') => {
    if (restLocked) return;
    stopWaitingForPosition();
    attemptRepCountRef.current[2] = 0;
    resetRepTracking();
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    setTrialState('attempt-2');
    setPaused(false);
    pushLog('system', source === 'auto' ? 'Set 2 starting: push-up position held.' : 'Set 2 started from the button.');
    beginCountdown({ announce: false });
    watchedCountdownRef.current = source === 'auto' ? 2 : 0;
    positionWatchRef.current = createPositionWatch();
  };

  const skipRestAsAdmin = () => {
    if (!adminUnlocked || !restLocked) return;
    setRestBypassed(true);
    pushLog('system', `Admin skipped the rest with ${restClock} left.`);
    setToast({ tone: 'info', text: 'Admin: rest skipped for testing.' });
    waitForPosition(GET_INTO_POSITION);
  };

  const stopSession = () => {
    logTempoSummary('this session');
    stopCamera();
    setCameraStatus('idle');
    pushLog('system', 'Session stopped.');
  };

  const resetForRetry = () => {
    stopCamera();
    setCameraStatus('idle');
    clearSessionData();
    setTrialState('idle');
    setPaused(false);
  };

  const openShare = () => {
    setShowShare(true);
    pushLog('system', 'Session finished. Showing the share page.');
    window.scrollTo({ top: 0 });
  };

  const nextVolunteer = () => {
    setAdminSkipConsent(false);
    setAdminNoSave(false);
    resetForRetry();
    setAthleteName('');
    updateCurrentConsent(null);
    setConsentDriveState('idle');
    setConsentDriveMessage('');
  };

  useEffect(() => {
    if (coachingTrialState !== 'complete' || !runningRef.current) return;
    const timer = window.setTimeout(() => {
      stopCamera();
      setCameraStatus('idle');
    }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachingTrialState]);

  const saveCurrentSession = () => {
    if (!sessionReps.length) return;
    if (!athleteName.trim()) {
      setToast({ tone: 'error', text: 'Add a name before saving.' });
      return;
    }
    const entry = buildSessionEntry();
    const nextHistory = [entry, ...history].slice(0, 25);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
    setSavedLocally(true);
    setToast({ tone: 'success', text: 'Saved to this device.' });
    pushLog('system', 'Session saved locally.');
  };

  const buildUploadRow = () => {
    const mode = workflowMode === 'coaching' ? 'coaching_session' : 'free_practice';
    const coaching = mode === 'coaching_session';
    const setFeedback = (reps: SessionRep[], trialState: CoachingTrialState) =>
      reps.find((rep) => rep.feedbackMode)?.feedbackMode ?? feedbackModeFor(feedbackSetting, workflowMode, trialState);
    const set1Feedback = coaching ? setFeedback(set1Reps, 'attempt-1') : setFeedback(orderedReps, 'idle');
    const set2Feedback = coaching ? setFeedback(set2Reps, 'attempt-2') : '';
    const cameraLabel = cameraViewLabel(orderedReps[0]?.viewMode ?? cameraView);
    const tempoCues = tempoCuesLabel(orderedReps);
    const protocol = `[set1=${set1Feedback}${set2Feedback ? ` set2=${set2Feedback}` : ''} tempo=${tempoCues} camera=${cameraLabel}]`;
    const notesSummary = [...new Set([...focusLines, ...sessionReps.flatMap((rep) => rep.notes)])].slice(0, 6).join('; ');
    return {
      timestamp: nowIso(),
      volunteer_name: athleteName.trim() || 'Anonymous',
      mode,
      attempt1_score: coaching ? set1Summary.average || '' : overallSummary.average,
      attempt2_score: coaching ? set2Summary.average || '' : '',
      delta: coaching && coachingComplete ? set2Summary.average - set1Summary.average : '',
      reps: overallSummary.count,
      // Also in the notes so sheets on the previous Apps Script version still record the protocol.
      notes_summary: `${protocol} ${notesSummary}`.trim(),
      device_user_agent: navigator.userAgent.slice(0, 120),
      set1_feedback: set1Feedback,
      set2_feedback: set2Feedback,
      camera_view: cameraLabel,
      tempo_cues: tempoCues,
    };
  };

  /** Status line for the session on screen; uploads of earlier sessions finish quietly in the background. */
  const setSessionUploadStatus = (sessionId: string, state: UploadState, message: string) => {
    if (sessionId !== resultSessionIdRef.current) return;
    setUploadState(state);
    setUploadMessage(message);
  };

  const postResultRow = async (row: ResultRow) => {
    if (!navigator.onLine) return { ok: false, duplicate: false, error: 'offline' };
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timeout = window.setTimeout(() => controller?.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(RESULTS_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(row),
        signal: controller?.signal,
      });
      if (!response.ok) return { ok: false, duplicate: false, error: `HTTP ${response.status}` };
      return parseResultUploadResponse(await response.json().catch(() => null));
    } catch (error) {
      console.error(error);
      return { ok: false, duplicate: false, error: navigator.onLine ? 'network blocked or timed out' : 'offline' };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  /**
   * Uploads queued result rows one at a time. Runs when a session finishes, on page load, when the
   * browser comes back online, on a manual retry (force), and on its own backoff timer.
   */
  const flushResults = async (force = false) => {
    if (resultsFlushingRef.current) {
      resultsFlushAgainRef.current ||= force;
      return;
    }
    if (resultsRetryTimerRef.current !== null) {
      window.clearTimeout(resultsRetryTimerRef.current);
      resultsRetryTimerRef.current = null;
    }
    resultsFlushingRef.current = true;
    let queue = loadPendingResults();
    try {
      for (const item of dueResults(queue, Date.now(), force)) {
        if (!navigator.onLine) {
          setSessionUploadStatus(item.sessionId, 'waiting', UPLOAD_WAITING_MESSAGE);
          continue;
        }
        setSessionUploadStatus(item.sessionId, 'uploading', 'Saving to results sheet…');
        const result = await postResultRow(item.row);
        // Re-read: a new session may have been queued while this one was in flight.
        queue = loadPendingResults();
        if (result.ok) {
          queue = savePendingResults(dropResult(queue, item.sessionId));
          setSessionUploadStatus(item.sessionId, 'done', 'Saved ✓');
          pushLog('system', result.duplicate ? 'Result was already in the sheet; duplicate skipped.' : 'Result saved to the Google Sheet.', item.sessionId);
          continue;
        }
        const error = result.error ?? 'upload failed';
        queue = savePendingResults(markResultFailed(queue, item.sessionId, error, Date.now()));
        if (error === 'offline') {
          setSessionUploadStatus(item.sessionId, 'waiting', UPLOAD_WAITING_MESSAGE);
        } else {
          setSessionUploadStatus(item.sessionId, 'error', `Couldn’t reach the results sheet (${error}). Retrying automatically; the result is kept on this device until it’s saved.`);
        }
        pushLog('system', `Result upload failed: ${error}. Will retry.`, item.sessionId);
      }
    } finally {
      resultsFlushingRef.current = false;
    }
    setPendingResultCount(queue.length);
    if (resultsFlushAgainRef.current) {
      const again = resultsFlushAgainRef.current;
      resultsFlushAgainRef.current = false;
      void flushResults(again);
      return;
    }
    const next = nextAttemptAt(queue);
    if (next !== null && navigator.onLine) {
      resultsRetryTimerRef.current = window.setTimeout(() => void flushResults(), Math.max(500, next - Date.now()));
    }
  };

  const queueCurrentResult = () => {
    if (resultsNotSaved || !athleteName.trim() || !sessionReps.length) return;
    const sessionId = resultSessionIdRef.current;
    autoQueuedSessionRef.current = sessionId;
    setPendingResultCount(savePendingResults(enqueueResult(loadPendingResults(), sessionId, buildUploadRow(), Date.now())).length);
    setSessionUploadStatus(sessionId, navigator.onLine ? 'uploading' : 'waiting', navigator.onLine ? 'Saving to results sheet…' : UPLOAD_WAITING_MESSAGE);
    void flushResults(true);
  };

  /** Manual upload/retry. Same session_id as the automatic upload, so it can't add a second row. */
  const uploadResult = () => {
    if (resultsNotSaved) return;
    if (!athleteName.trim()) {
      setToast({ tone: 'error', text: 'Add a name before uploading.' });
      return;
    }
    const sessionId = resultSessionIdRef.current;
    if (loadPendingResults().some((item) => item.sessionId === sessionId)) {
      setSessionUploadStatus(sessionId, 'uploading', 'Saving to results sheet…');
      void flushResults(true);
    } else {
      queueCurrentResult();
    }
  };

  useEffect(() => {
    if (testRunNoSave && phase !== 'setup') setSessionNoSave(true);
  }, [testRunNoSave, phase]);

  // Set 2 done: save the row right away, without waiting for a tap.
  useEffect(() => {
    if (workflowMode !== 'coaching' || coachingTrialState !== 'complete' || !coachingComplete) return;
    if (autoQueuedSessionRef.current === resultSessionIdRef.current) return;
    if (resultsNotSaved) {
      autoQueuedSessionRef.current = resultSessionIdRef.current;
      pushLog('system', 'Admin test run: result not uploaded.');
      return;
    }
    queueCurrentResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowMode, coachingTrialState, coachingComplete]);

  // Rows left over from a closed page or a dropped connection go up on load and when back online.
  useEffect(() => {
    void flushResults(true);
    const onOnline = () => void flushResults(true);
    const onOffline = () => {
      if (loadPendingResults().some((item) => item.sessionId === resultSessionIdRef.current)) {
        setSessionUploadStatus(resultSessionIdRef.current, 'waiting', UPLOAD_WAITING_MESSAGE);
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (resultsRetryTimerRef.current !== null) window.clearTimeout(resultsRetryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCurrentConsent = (next: SignedConsent | null) => {
    saveCurrentConsent(next);
    setCurrentConsent(next);
  };

  const updatePendingConsents = (update: (current: SignedConsent[]) => SignedConsent[]) => {
    setPendingConsents((current) => savePendingConsents(update(current)));
  };

  const postConsentToDrive = async (consent: SignedConsent): Promise<ConsentUploadResult> => {
    if (!navigator.onLine) return { ok: false, error: 'offline' };
    try {
      const response = await fetch(RESULTS_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(buildConsentUploadPayload(consent)),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      return parseConsentUploadResponse(await response.json().catch(() => null));
    } catch (error) {
      console.error(error);
      return { ok: false, error: navigator.onLine ? 'network blocked' : 'offline' };
    }
  };

  const uploadConsent = async (consent: SignedConsent) => {
    setConsentDriveState('uploading');
    setConsentDriveMessage('Saving the signed PDF to the project Google Drive folder…');
    const result = await postConsentToDrive(consent);
    if (result.ok) {
      const uploaded = { ...consent, uploaded: true };
      setCurrentConsent((current) => {
        if (current?.id !== consent.id) return current;
        saveCurrentConsent(uploaded);
        return uploaded;
      });
      updatePendingConsents((current) => current.filter((item) => item.id !== consent.id));
      setConsentDriveState('done');
      setConsentDriveMessage('Saved to the project Google Drive folder.');
      pushLog('system', `Consent PDF saved to Drive (${consent.fileName}).`);
      return;
    }
    const queued = { ...consent, scriptOutdated: Boolean(result.scriptOutdated) };
    updatePendingConsents((current) => [...current.filter((item) => item.id !== consent.id), queued]);
    setConsentDriveState('error');
    setConsentDriveMessage(
      result.error === 'offline'
        ? 'Offline — the signed PDF is kept on this device and uploads to Drive once you’re back online. Download a copy to be safe.'
        : `Couldn’t save to Drive: ${result.error}. The PDF is kept on this device for retry — download a copy to be safe.`,
    );
    pushLog('system', `Consent Drive upload failed: ${result.error}`);
  };

  const retryPendingConsents = async (manual = false) => {
    const queue = loadPendingConsents();
    if (!queue.length || !navigator.onLine) return;
    let remaining = queue;
    for (const consent of queue) {
      if (consent.scriptOutdated && !manual) continue;
      const result = await postConsentToDrive(consent);
      if (!result.ok) {
        remaining = remaining.map((item) => (item.id === consent.id ? { ...item, scriptOutdated: Boolean(result.scriptOutdated) } : item));
        continue;
      }
      remaining = remaining.filter((item) => item.id !== consent.id);
      setCurrentConsent((current) => {
        if (current?.id !== consent.id) return current;
        const uploaded = { ...current, uploaded: true };
        saveCurrentConsent(uploaded);
        setConsentDriveState('done');
        setConsentDriveMessage('Saved to the project Google Drive folder.');
        return uploaded;
      });
    }
    setPendingConsents(savePendingConsents(remaining));
    if (remaining.length < queue.length) {
      setToast({ tone: 'success', text: `${queue.length - remaining.length} signed consent PDF${queue.length - remaining.length === 1 ? '' : 's'} saved to Drive.` });
    }
  };

  const signConsent = async (submission: ConsentSubmission) => {
    const participantName = athleteName.trim();
    if (!participantName) return false;
    const signedAt = new Date();
    const id = `${signedAt.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const { jsPDF } = await import('jspdf');
      const pdfBase64 = await buildConsentPdf(
        { id, participantName, ...submission, signedAtIso: signedAt.toISOString(), settings: withConsentDefaults(consentSettings) },
        jsPDF,
      );
      const signed: SignedConsent = {
        id,
        participantName,
        signerRole: submission.signerRole,
        signerName: submission.signerName,
        signedAtIso: signedAt.toISOString(),
        fileName: consentFileName(participantName, signedAt),
        pdfBase64,
        uploaded: false,
      };
      updateCurrentConsent(signed);
      setConsentOpen(false);
      setToast({ tone: 'success', text: 'Consent signed. You can start the camera.' });
      pushLog('system', `Consent signed by ${submission.signerName} for ${participantName}.`);
      void uploadConsent(signed);
      return true;
    } catch (error) {
      console.error(error);
      setToast({ tone: 'error', text: 'Couldn’t create the consent PDF. Try again.' });
      return false;
    }
  };

  const downloadConsent = () => {
    if (!currentConsent) return;
    downloadBlob(currentConsent.fileName, base64ToBlob(currentConsent.pdfBase64, 'application/pdf'));
  };

  const retryConsentUpload = () => {
    if (currentConsent) void uploadConsent(currentConsent);
  };

  const updateConsentSettings = (next: ConsentSettings) => {
    setConsentSettings(next);
    saveConsentSettings(next);
  };

  const downloadPendingConsents = () => {
    for (const consent of pendingConsents) {
      downloadBlob(consent.fileName, base64ToBlob(consent.pdfBase64, 'application/pdf'));
    }
  };

  const deleteHistoryEntry = (id: string) => {
    const nextHistory = history.filter((entry) => entry.id !== id);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  };

  const unlockAdmin = (pin: string) => {
    if (pin.trim() !== ADMIN_PIN) {
      pushLog('system', 'Admin PIN rejected.');
      return false;
    }
    setAdminUnlocked(true);
    pushLog('system', 'Admin PIN accepted.');
    return true;
  };

  const lockAdmin = () => {
    setAdminSkipConsent(false);
    setAdminNoSave(false);
    setAdminUnlocked(false);
    localStorage.removeItem(ADMIN_UNLOCK_KEY);
    setAdminOpen(false);
    setToast({ tone: 'info', text: 'Signed out of admin.' });
  };

  const updateDraft = (key: BaselineMetricKey, field: 'targets' | 'tolerances', value: number | null) => {
    setBaselineDraft((current) => {
      if (!current) return current;
      if (field === 'tolerances') {
        return { ...current, tolerances: { ...current.tolerances, [key]: value ?? 0 } };
      }
      return { ...current, targets: { ...current.targets, [key]: value } as BaselinePoseReference['targets'] };
    });
  };

  const updateElbowRange = (range: ElbowIdealRange) => {
    setBaselineDraft((current) => (current ? { ...current, elbowIdealRange: { min: Math.max(0, Math.min(90, range.min)), max: Math.max(0, Math.min(90, range.max)) } } : current));
  };

  const seedDraftFromPose = () => {
    if (!analysis) return;
    const seeded = createBaselineReference(baselineAngle, analysis, `${baselineAngle} 100 standard`);
    setBaselineDraft((current) =>
      current ? { ...seeded, tolerances: current.tolerances, elbowIdealRange: elbowRangeFor(current) } : seeded,
    );
    setToast({ tone: 'info', text: 'Draft filled from the live pose. Review, then save.' });
  };

  const saveStandard = () => {
    if (!baselineDraft) return;
    const reference = { ...baselineDraft, elbowIdealRange: elbowRangeFor(baselineDraft), angle: baselineAngle, createdAt: nowIso() };
    setBaselines((current) => ({
      updatedAt: nowIso(),
      references: { ...current.references, [baselineAngle]: reference },
    }));
    setToast({ tone: 'success', text: `${baselineAngle[0].toUpperCase()}${baselineAngle.slice(1)} 100 standard saved.` });
    pushLog('system', `Saved ${baselineAngle} 100 standard.`);
  };

  const clearStandards = () => {
    setBaselines({ updatedAt: nowIso(), references: { front: null, back: null, side: null, top: null } });
    setToast({ tone: 'info', text: 'All 100 standards cleared.' });
  };

  const exportNotes = () => {
    if (!sessionReps.length) return;
    const summary = buildSessionSummary();
    downloadTextFile(
      `pushup-session-${summary.id}-notes.md`,
      buildNotesExport({ ...summary, mode: feedbackMode, cameraView, spokenCoachingEnabled, tempoCues: tempoCuesLabel(orderedReps) }, orderedReps),
      'text/markdown',
    );
  };

  const exportCsv = () => {
    if (!sessionReps.length) return;
    const summary: SessionSummary = buildSessionSummary();
    downloadTextFile(`pushup-session-${summary.id}.csv`, buildCsv(summary, orderedReps, sessionLogs), 'text/csv');
  };

  const closeAdmin = useCallback(() => setAdminOpen(false), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const closeConsent = useCallback(() => setConsentOpen(false), []);

  useEffect(() => {
    localStorage.setItem(SESSION_NAME_KEY, athleteName);
  }, [athleteName]);

  useEffect(() => {
    setSecureContext(window.isSecureContext);
  }, []);

  useEffect(() => {
    void retryPendingConsents();
    const onOnline = () => void retryPendingConsents();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (calibrationState !== 'ready') {
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
      return;
    }

    if (readyTimerRef.current !== null) return;

    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null;
      beginCountdown();
      watchedCountdownRef.current = 1;
      positionWatchRef.current = createPositionWatch();
    }, 500);

    return () => {
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationState]);

  useEffect(() => {
    let cancelled = false;
    if (!secureContext) {
      setCameraError('Camera access requires HTTPS or localhost.');
      return;
    }

    (async () => {
      try {
        if (!poseRef.current) {
          poseRef.current = await createPoseLandmarker();
        }
        if (!cancelled) setPoseReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setPoseReady(false);
          setCameraError(
            isOfflinePackage
              ? 'The pose model failed to load. Re-extract the whole offline folder and open index.html again.'
              : 'The pose model failed to load. Check the connection and refresh.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [secureContext]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsName = !athleteName.trim();
  const consentSigned = isConsentValidFor(currentConsent, athleteName);
  const consentSummary = consentSigned && currentConsent
    ? `Signed by ${currentConsent.signerName}${currentConsent.signerRole === 'guardian' ? ' (parent/guardian)' : ' (participant, 18+)'} on ${consentDateLabel(new Date(currentConsent.signedAtIso))}.`
    : '';
  const phaseChip =
    phase === 'calibrating'
      ? 'Finding you'
      : phase === 'countdown'
        ? 'Get ready'
        : phase === 'break'
          ? restLocked
            ? `Rest ${restClock}`
            : positionWaitSince !== null
              ? 'Get in position'
              : 'Coaching break'
          : workflowMode === 'coaching'
            ? `Set ${currentAttempt} of 2`
            : 'Free practice';
  const showAlert = Boolean(activeBanner) && phase !== 'countdown';
  const showCue = modeAllowsVisuals && !showAlert && (phase === 'set' || phase === 'break' || phase === 'calibrating') && currentCue;

  const renderDock = () => {
    switch (phase) {
      case 'setup':
        return (
          <>
            {!poseReady || needsName || !(consentSigned || skipConsent) ? (
              <p className="dock__hint">
                {!poseReady ? 'Loading the pose coach…' : needsName ? 'Add your name above to start.' : 'Sign the consent form above to start.'}
              </p>
            ) : null}
            <button className="btn btn--primary btn--xl btn--block" onClick={startSession} disabled={!poseReady || !secureContext || needsName || !(consentSigned || skipConsent)}>
              <CameraIcon /> Start camera and sound
            </button>
          </>
        );
      case 'calibrating':
        return (
          <div className="btn-row">
            <button className="btn btn--ghost" onClick={stopSession}>Cancel</button>
            {checkingElapsedMs >= 3000 ? (
              <button className="btn btn--primary btn--grow" onClick={() => beginCountdown()}>
                Start anyway
              </button>
            ) : (
              <span className="dock__status">Hold a push-up position…</span>
            )}
          </div>
        );
      case 'countdown':
      case 'set':
        return (
          <button className="btn btn--stop btn--xl btn--block" onClick={stopSession}>
            <StopIcon /> Stop session
          </button>
        );
      case 'break':
        return (
          <div className="btn-row">
            <button className="btn btn--ghost" onClick={stopSession}>End</button>
            {restLocked ? (
              <button className="btn btn--primary btn--xl btn--grow" disabled aria-label={`Set 2 unlocks after rest, ${restClock} left`}>
                <LockIcon /> Rest {restClock}
              </button>
            ) : positionWaitSince === null || manualStartVisible ? (
              <>
                {positionWaitSince !== null ? <span className="dock__status">Hold the top of a push-up…</span> : null}
                <button className="btn btn--secondary" onClick={() => startSetTwo()}>
                  Start set 2
                </button>
              </>
            ) : (
              <span className="dock__status">Get into your push-up position — set 2 starts when you hold it.</span>
            )}
          </div>
        );
      case 'results':
        if (showShare) {
          return (
            <div className="btn-row">
              <button className="btn btn--ghost" onClick={() => setShowShare(false)}>
                Back to results
              </button>
              <button className="btn btn--primary btn--xl btn--grow" onClick={nextVolunteer}>
                Next volunteer
              </button>
            </div>
          );
        }
        return (
          <div className="btn-row">
            <button className="btn btn--ghost" onClick={resetForRetry} aria-label="Try again with the same name">
              <RetryIcon /> Try again
            </button>
            <button className="btn btn--primary btn--xl btn--grow" onClick={openShare}>
              Finish <ChevronIcon />
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`app app--${phase}${phase === 'break' && !stageCompact ? ' is-positioning' : ''}${liveStage ? ' is-live' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 15h4l2-5 3 9 2.5-6H21" /></svg>
          </span>
          <span className="brand__name">Form Coach</span>
          {isOfflinePackage ? <span className="brand__tag">Offline</span> : null}
        </div>
        <div className="topbar__actions">
          {!cameraActive ? (
            <button className="icon-button icon-button--labeled" onClick={() => setHistoryOpen(true)} aria-label={`History, ${history.length} saved`}>
              <HistoryIcon />
              <span>History</span>
              {history.length ? <span className="count-badge">{history.length}</span> : null}
            </button>
          ) : null}
          <button
            className={adminUnlocked ? 'icon-button icon-button--labeled is-admin' : 'icon-button icon-button--labeled'}
            onClick={() => setAdminOpen(true)}
            aria-label={adminUnlocked ? 'Admin tools (unlocked)' : 'Admin'}
          >
            {adminUnlocked ? <UnlockIcon /> : <LockIcon />}
            <span>Admin</span>
          </button>
        </div>
      </header>

      {(resultsNotSaved || skipConsent) && !liveStage ? (
        <div className="test-run-bar" role="status">
          {resultsNotSaved ? <span className="test-run-badge">Test run – results not saved</span> : null}
          {skipConsent ? <span className="test-run-badge test-run-badge--consent">Consent skipped (admin)</span> : null}
        </div>
      ) : null}

      <Stepper steps={steps} activeKey={stepKey} />

      <main className="layout">
        <section className={cameraActive ? 'stage-col' : 'stage-col is-dormant'} aria-hidden={!cameraActive}>
          <div className="stage" ref={stageRef}>
            <video
              ref={videoRef}
              className={previewMirrored ? 'stage__video mirror' : 'stage__video'}
              playsInline
              muted
              autoPlay
              disablePictureInPicture
              controls={false}
            />
            <canvas ref={canvasRef} className="stage__overlay" />
            {showStageDiag ? <pre ref={stageDiagRef} className="stage__diag" aria-hidden="true" /> : null}
            <div className="stage__scrim" aria-hidden="true" />

            <div className="stage__top">
              <span className={`chip chip--${phase}`}>{phaseChip}</span>
              {phase === 'set' || phase === 'break' ? (
                <div className="rep-counter" aria-live="polite">
                  <strong>{currentSetReps.length}</strong>
                  <span>{workflowMode === 'coaching' ? `of ${REPS_PER_SET}` : 'reps'}</span>
                </div>
              ) : null}
              {lastRep && (phase === 'set' || phase === 'break') ? (
                <span className="chip chip--score">Last {lastRep.score}</span>
              ) : (
                <span className="chip chip--ghost">{cameraView === 'head-on' ? 'Head-on' : 'Side'}</span>
              )}
            </div>

            {(resultsNotSaved || skipConsent) && liveStage ? (
              <div className="stage__badges" role="status">
                {resultsNotSaved ? <span className="test-run-badge">Test run · not saved</span> : null}
                {skipConsent ? <span className="test-run-badge test-run-badge--consent">Consent skipped</span> : null}
              </div>
            ) : null}

            {workflowMode === 'coaching' && phase === 'set' ? (
              <div className="set-dots" aria-hidden="true">
                {Array.from({ length: REPS_PER_SET }, (_, index) => (
                  <span key={index} className={index < currentSetReps.length ? 'set-dot is-done' : 'set-dot'} />
                ))}
              </div>
            ) : null}

            {showAlert ? <div className="stage__alert" role="alert">{activeBanner}</div> : null}

            {phase === 'calibrating' ? (
              <div className="stage__center">
                <ConfidenceRing value={calibrationConfidence} />
                <p className="stage__caption">{calibrationState === 'ready' ? 'Locked in — hold still' : 'Hold the top of a push-up'}</p>
              </div>
            ) : null}

            {phase === 'countdown' ? (
              <div className="stage__center" aria-live="assertive">
                {countdownValue === null ? (
                  <p className="stage__announce">{currentAttempt === 2 ? 'Set 2 — get ready' : 'Calibration complete'}</p>
                ) : (
                  <span key={countdownValue} className="countdown-number">{countdownValue}</span>
                )}
              </div>
            ) : null}

            {phase === 'break' && positionWaitSince !== null && positionHoldPct > 0 ? (
              <div className="stage__center" aria-live="polite">
                <p className="stage__caption">Hold it…</p>
                <div className="hold-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={positionHoldPct}>
                  <span style={{ width: `${positionHoldPct}%` }} />
                </div>
              </div>
            ) : null}

            {showGoOverlay ? (
              <div className="go-overlay" aria-hidden="true">
                <div className="go-overlay__text">GO</div>
              </div>
            ) : null}

            {showCue ? (
              <div className="stage__bottom">
                <p key={currentCue} className="cue-bubble">{currentCue}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel-col">
          {cameraError || !secureContext ? (
            <div className="alert" role="alert">
              {!secureContext ? 'Camera access is blocked on plain http:// addresses. Open the app over https:// or localhost.' : cameraError}
            </div>
          ) : null}

          {phase === 'setup' ? (
            <SetupPanel
              name={athleteName}
              onNameChange={setAthleteName}
              workflowMode={workflowMode}
              onWorkflowModeChange={setWorkflowMode}
              adminUnlocked={adminUnlocked}
              feedbackSetting={feedbackSetting}
              onFeedbackSettingChange={setFeedbackSetting}
              spokenCoaching={spokenTipsSwitch}
              onSpokenCoachingChange={setSpokenTipsSwitch}
              tempoCues={tempoCuesSwitch}
              onTempoCuesChange={setTempoCuesSwitch}
              cameraFacing={cameraFacing}
              onCameraFacingChange={setCameraFacing}
              cameraView={cameraView}
              onCameraViewChange={setCameraView}
              hasSavedStandard={Boolean(baselines.references[gradingAngle])}
              showNameHint={needsName}
              consent={{
                signed: consentSigned,
                needsName,
                summary: consentSummary,
                driveState: consentDriveState,
                driveMessage: consentDriveMessage,
              }}
              onOpenConsent={() => setConsentOpen(true)}
              onDownloadConsent={downloadConsent}
              onRetryConsentUpload={retryConsentUpload}
            />
          ) : null}

          {phase === 'calibrating' ? (
            <CalibratingPanel checklist={calibrationChecklist} tip={placementTip} waitingForBody={!analysis || analysis.confidence < MIN_SIGNAL} />
          ) : null}

          {phase === 'countdown' || phase === 'set' ? (
            <LiveFormPanel
              title={workflowMode === 'coaching' ? `Set ${currentAttempt} · live form` : 'Live form'}
              metrics={liveMetrics}
              visualsAllowed={modeAllowsVisuals}
              setReps={currentSetReps}
            />
          ) : null}

          {phase === 'break' ? (
            <BreakPanel
              restRemainingMs={restRemaining}
              restTotalMs={REST_BREAK_MS}
              restClock={restClock}
              adminUnlocked={adminUnlocked}
              onAdminSkipRest={skipRestAsAdmin}
              set1={set1Summary}
              focusLines={coachingFocusLines(set1Summary, cameraView)}
              visualsAllowed={modeAllowsVisuals}
              spokenCoaching={spokenCoachingEnabled}
              onSpokenCoachingChange={setSpokenTipsSwitch}
              audioAllowed={modeAllowsAudio}
              showSpokenSwitch={adminUnlocked && feedbackSetting !== 'study'}
            />
          ) : null}

          {phase === 'results' && showShare ? <SharePanel name={athleteName} /> : null}
          {phase === 'results' && !showShare ? (
            <ResultsPanel
              mode={workflowMode}
              name={athleteName}
              onNameChange={setAthleteName}
              set1={set1Summary}
              set2={set2Summary}
              overall={overallSummary}
              reps={orderedReps}
              focusLines={focusLines}
              previousScore={previousScore}
              uploadState={uploadState}
              uploadMessage={
                resultsNotSaved ? 'Test run — this result is not saved to the results sheet.' : uploadMessage || 'Upload adds one row to the shared science-fair results sheet.'
              }
              savedLocally={savedLocally}
              onSaveLocal={saveCurrentSession}
              onExportNotes={exportNotes}
              onExportCsv={exportCsv}
              adminUnlocked={adminUnlocked}
              onUpload={!resultsNotSaved && (uploadState === 'error' || uploadState === 'idle') ? uploadResult : undefined}
            />
          ) : null}

          <div className="dock">{renderDock()}</div>
        </section>
      </main>

      <AdminSheet
        open={adminOpen}
        onClose={closeAdmin}
        unlocked={adminUnlocked}
        onUnlock={unlockAdmin}
        onLock={lockAdmin}
        skipConsent={adminSkipConsent}
        onSkipConsentChange={setAdminSkipConsent}
        noSave={adminNoSave}
        onNoSaveChange={setAdminNoSave}
        baselines={baselines}
        angle={baselineAngle}
        onAngleChange={setBaselineAngle}
        gradingAngle={gradingAngle}
        draft={baselineDraft}
        onDraftChange={updateDraft}
        onElbowRangeChange={updateElbowRange}
        onSeedFromPose={seedDraftFromPose}
        onSave={saveStandard}
        onClearAll={clearStandards}
        live={cameraStatus === 'live' ? analysis : null}
        logs={sessionLogs}
        reps={sessionReps}
        stageDiagnostics={stageDiagPinned}
        onStageDiagnosticsChange={setStageDiagPinned}
        pendingResultCount={pendingResultCount}
        onRetryPendingResults={() => void flushResults(true)}
        consentSettings={consentSettings}
        onConsentSettingsChange={updateConsentSettings}
        pendingConsentCount={pendingConsents.length}
        onRetryPendingConsents={() => void retryPendingConsents(true)}
        onDownloadPendingConsents={downloadPendingConsents}
      />
      <ConsentSheet
        open={consentOpen && Boolean(athleteName.trim())}
        onClose={closeConsent}
        participantName={athleteName.trim()}
        settings={withConsentDefaults(consentSettings)}
        onSign={signConsent}
      />
      <HistorySheet open={historyOpen} onClose={closeHistory} history={history} onDelete={deleteHistoryEntry} onClearAll={clearHistory} />

      {toast ? (
        <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

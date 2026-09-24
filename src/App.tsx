import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { AdminSheet } from './components/AdminSheet';
import { HistorySheet } from './components/HistorySheet';
import { CameraIcon, HistoryIcon, LockIcon, RetryIcon, StopIcon, UnlockIcon, UploadIcon } from './components/Icons';
import { BreakPanel, CalibratingPanel, LiveFormPanel, type ChecklistItem } from './components/LivePanels';
import { ResultsPanel } from './components/ResultsPanel';
import { SetupPanel } from './components/SetupPanel';
import { Stepper } from './components/Stepper';
import {
  createBaselineReference,
  createDefaultBaselineReference,
  gradingAngleForView,
  loadBaselines,
  saveBaselines,
  scoreAgainstBaseline,
  type BaselineMetricKey,
} from './lib/baselineStorage';
import { buildCsv, buildNotesExport, downloadTextFile } from './lib/export';
import { shouldMirrorPreview } from './lib/mirroring';
import { createRepCounter } from './lib/repCounter';
import { analyzePose, createEmptyRepAccumulator, finalizeRep, MIN_SIGNAL } from './lib/scoring';
import {
  activeStepKey,
  attemptForTrialState,
  coachingFocusLines,
  deriveJourneyPhase,
  journeySteps,
  REPS_PER_SET,
  summarizeReps,
  trialStateAfterRep,
  type CalibrationState,
  type CoachingTrialState,
  type WorkflowMode,
} from './lib/sessionFlow';
import { loadHistory, saveHistory } from './lib/storage';
import { playVoiceClip, playVoiceMessage, preloadVoiceClips } from './lib/voiceAudio';
import type {
  BaselineAngle,
  BaselinePoseReference,
  CameraFacing,
  CameraViewMode,
  FeedbackMode,
  LogEntry,
  PoseAnalysis,
  PosePoint,
  SessionEntry,
  SessionRep,
  SessionSummary,
} from './lib/types';

const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const POSE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const SESSION_STORAGE_KEY = 'pushup-coach-history';
const LEGACY_SESSION_STORAGE_KEY = 'pushup-form-coach-history';
const SESSION_NAME_KEY = 'pushup-form-coach-name';
const SOUND_WANTED_KEY = 'pushup-coach-sound-wanted';
const ADMIN_UNLOCK_KEY = 'pushup-admin-pin-unlocked';
const ADMIN_PIN = '180180';
const RESULTS_UPLOAD_URL =
  (import.meta.env.VITE_RESULTS_UPLOAD_URL as string | undefined) ??
  'https://script.google.com/macros/s/AKfycbyE8BrKiLi13COPUOqw9oeQObcUP40lrsRkT3jHyeK_BQsMMUWHc9HjZCcF2y0o0Dqw8g/exec';

type CoachingIssueKey = 'setup' | 'depth' | 'elbowFlare' | 'handStack' | 'headAlignment' | 'hips';
type UploadState = 'idle' | 'uploading' | 'done' | 'error';
type Toast = { tone: 'success' | 'error' | 'info'; text: string };

const nowIso = () => new Date().toISOString();
const freshRepState = () => ({ sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 });

function speak(message: string) {
  playVoiceMessage(message);
}

function shortenCue(message: string) {
  const normalized = message.trim();
  const replacements: Array<[RegExp, string]> = [
    [/^lower a little deeper.*$/i, 'Go a little deeper'],
    [/^lower deeper.*$/i, 'Go a little deeper'],
    [/^tuck the elbows in.*$/i, 'Tuck elbows in'],
    [/^stack the hands.*$/i, 'Hands under shoulders'],
    [/^keep the head centered.*$/i, 'Keep head centered'],
    [/^back up or lower the phone.*$/i, 'Back up for hands and torso'],
    [/^move back or lower the phone.*$/i, 'Back up for hands and torso'],
    [/^keep the hips from sagging.*$/i, 'Keep hips level'],
    [/^keep the hips level and avoid piking.*$/i, 'Keep hips level'],
    [/^clean head-on rep.*$/i, 'Good rep'],
    [/^clean side-view rep.*$/i, 'Good rep'],
    [/^audio cues are unlocked.*$/i, 'Audio unlocked'],
    [/^tap enable sound.*$/i, 'Tap Start camera and sound'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(normalized)) return replacement;
  }
  const words = normalized.split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : normalized;
}

const repEncouragements = {
  low: ['You’ve got this — drop a bit lower next one.', 'Shake it off — next one’s yours.', 'Nice try — a little deeper next rep.', 'Keep going — just a bit lower.', 'You can do it — one more notch deeper.'],
  mid: ['Good rep — a little more depth and you’re golden.', 'Nice work — keep that one coming.', 'Solid — a touch deeper next time.', 'Good job — that’s moving the right way.', 'Strong rep — keep chasing the depth.'],
  high: ['Nice! That was a strong one.', 'Yes! Deep and solid!', 'Great one — keep that energy.', 'Awesome rep — that was clean.', 'Big rep — you’re flying now.'],
};

async function unlockAudioContext(contextRef: { current: AudioContext | null }) {
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return false;
  if (!contextRef.current) {
    contextRef.current = new AudioContextCtor();
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
  const streamRef = useRef<MediaStream | null>(null);
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
  const repStateRef = useRef(freshRepState());
  const repCounterRef = useRef(createRepCounter());
  const attemptRepCountRef = useRef<Record<1 | 2, number>>({ 1: 0, 2: 0 });
  const frameHandlerRef = useRef<(landmarks: PosePoint[] | undefined) => void>(() => undefined);
  const coachingFocusRef = useRef<{ key: CoachingIssueKey | null; resolvedAt: number | null; cue: string }>({
    key: null,
    resolvedAt: null,
    cue: '',
  });
  const stableCalibrationFramesRef = useRef(0);
  const calibrationStateRef = useRef<CalibrationState>('idle');
  const cueLastTextRef = useRef('');
  const cueLastEmittedAtRef = useRef(0);
  const repSpeechLockUntilRef = useRef(0);

  const [secureContext, setSecureContext] = useState(window.isSecureContext);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  const [cameraView, setCameraView] = useState<CameraViewMode>('head-on');
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>('combined');
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'live' | 'error'>('idle');
  const [cameraError, setCameraError] = useState('');
  const [poseReady, setPoseReady] = useState(false);
  const [athleteName, setAthleteName] = useState(() => localStorage.getItem(SESSION_NAME_KEY) ?? '');
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [sessionReps, setSessionReps] = useState<SessionRep[]>([]);
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [currentCue, setCurrentCue] = useState('');
  const [spokenCoachingEnabled, setSpokenCoachingEnabled] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('coaching');
  const [coachingTrialState, setCoachingTrialState] = useState<CoachingTrialState>('idle');
  const [coachingPaused, setCoachingPaused] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(() => localStorage.getItem(ADMIN_UNLOCK_KEY) === '1');
  const [adminOpen, setAdminOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [savedLocally, setSavedLocally] = useState(false);
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
  const [showGoOverlay, setShowGoOverlay] = useState(false);
  const [checkingElapsedMs, setCheckingElapsedMs] = useState(0);
  const [activeBanner, setActiveBanner] = useState<string | null>(null);

  const previewMirrored = shouldMirrorPreview(cameraFacing);
  const modeAllowsVisuals = feedbackMode === 'visual' || feedbackMode === 'combined';
  const modeAllowsAudio = feedbackMode === 'audio' || feedbackMode === 'combined';
  const gradingAngle = gradingAngleForView(cameraView);
  const feedbackModeRef = useRef(feedbackMode);
  const audioUnlockedRef = useRef(audioUnlocked);
  const spokenCoachingEnabledRef = useRef(spokenCoachingEnabled);
  const workflowModeRef = useRef(workflowMode);
  const coachingTrialStateRef = useRef(coachingTrialState);
  const coachingPausedRef = useRef(coachingPaused);
  const repEncouragementTickRef = useRef(0);

  useEffect(() => {
    feedbackModeRef.current = feedbackMode;
  }, [feedbackMode]);
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
  const steps = journeySteps(workflowMode);
  const stepKey = activeStepKey(phase, workflowMode, coachingTrialState);
  const cameraActive = phase === 'calibrating' || phase === 'countdown' || phase === 'set' || phase === 'break';

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
    if (workflowMode === 'coaching') return coachingFocusLines(coachingComplete ? set2Summary : set1Summary);
    return coachingFocusLines(overallSummary);
  }, [coachingComplete, overallSummary, set1Summary, set2Summary, workflowMode]);

  const applyBaselineBias = (frame: PoseAnalysis): PoseAnalysis => {
    const reference = baselines.references[gradingAngleForView(frame.viewMode)];
    if (!reference) return frame;
    const score = (key: BaselineMetricKey, actual: number) => scoreAgainstBaseline(actual, reference.targets[key], reference.tolerances[key]);
    const elbowDepthScore = score('elbowDepthScore', frame.elbowDepthScore);
    const bodyLineScore = score('bodyLineScore', frame.bodyLineScore);
    const elbowFlareScore = score('elbowFlareScore', frame.elbowFlareScore);
    const handStackScore = score('handStackScore', frame.handStackScore);
    const headAlignmentScore = score('headAlignmentScore', frame.headAlignmentScore);
    const framingScore = score('framingScore', frame.framingScore);
    return {
      ...frame,
      overallScore: Math.round(
        elbowDepthScore * 0.35 +
          bodyLineScore * 0.3 +
          elbowFlareScore * 0.12 +
          handStackScore * 0.1 +
          headAlignmentScore * 0.08 +
          framingScore * 0.05,
      ),
      elbowDepthScore,
      bodyLineScore,
      elbowFlareScore,
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
        setCountdownValue(null);
        setCalibration('counting');
        setShowGoOverlay(true);
        repStateRef.current = freshRepState();
        repAccumulatorRef.current = createEmptyRepAccumulator();
        pushLog('info', 'Countdown finished. Counting started.');
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

  const clearSessionData = () => {
    setSessionReps([]);
    setSessionLogs([]);
    setAnalysis(null);
    setCurrentCue('');
    setSessionStartedAt(null);
    setShowGoOverlay(false);
    setActiveBanner(null);
    setUploadState('idle');
    setUploadMessage('');
    setSavedLocally(false);
    repCounterRef.current.reset();
    attemptRepCountRef.current = { 1: 0, 2: 0 };
    repEncouragementTickRef.current = 0;
    repAccumulatorRef.current = createEmptyRepAccumulator();
    repStateRef.current = freshRepState();
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
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
      'go-a-little-deeper',
      'tuck-elbows-in',
      'hands-under-shoulders',
      'keep-head-centered',
      'keep-hips-level',
      'back-up-for-hands-and-torso',
      'move-back-or-lower-the-phone',
      'good-rep-a-little-more-depth-and-youre-golden',
      'nice-that-was-a-strong-one',
      'yes-deep-and-solid',
      'great-one-keep-that-energy',
      'awesome-rep-that-was-clean',
      'big-rep-youre-flying-now',
      'good-job-thats-moving-the-right-way',
      'nice-work-keep-that-one-coming',
      'solid-a-touch-deeper-next-time',
      'strong-rep-keep-chasing-the-depth',
      'youve-got-this-drop-a-bit-lower-next-one',
      'shake-it-off-next-ones-yours',
      'nice-try-a-little-deeper-next-rep',
      'keep-going-just-a-bit-lower',
      'you-can-do-it-one-more-notch-deeper',
    ]);
    setAudioUnlocked(true);
    localStorage.setItem(SOUND_WANTED_KEY, '1');
    const unlocked = await unlockAudioContext(audioContextRef);
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

  const buildCoachingIssues = (frame: PoseAnalysis) => {
    const issues: Array<{ key: CoachingIssueKey; cue: string }> = [];
    const counting = calibrationStateRef.current === 'counting';
    const setupCue = frame.setupHint ?? 'Move back so hands and torso stay in frame.';
    const setupNeeded = counting
      ? frame.confidence < 0.32 || frame.framingScore < 20
      : frame.viewMode === 'head-on'
        ? frame.confidence < 0.72 || frame.framingScore < 64 || frame.handStackScore < 72
        : frame.confidence < 0.7 || frame.framingScore < 62 || frame.handStackScore < 72;
    if (setupNeeded) {
      issues.push({ key: 'setup', cue: setupCue });
      return issues;
    }

    if (frame.viewMode === 'head-on') {
      if (frame.elbowDepthScore < 55) issues.push({ key: 'depth', cue: 'Go a little deeper.' });
      if (frame.bodyLineScore < 74) issues.push({ key: 'hips', cue: 'Keep the hips lower and the body straighter.' });
      if (frame.elbowFlareScore < 68) issues.push({ key: 'elbowFlare', cue: 'Tuck the elbows in.' });
      if (frame.handStackScore < 72) issues.push({ key: 'handStack', cue: 'Hands under shoulders.' });
      if (frame.headAlignmentScore < 70) issues.push({ key: 'headAlignment', cue: 'Keep the head centered.' });
      return issues;
    }

    if (frame.elbowDepthScore < 58) issues.push({ key: 'depth', cue: 'Go a little deeper.' });
    if (frame.bodyLineScore < 74 || (frame.hipSagScore ?? 100) < 72 || (frame.hipPikeScore ?? 100) < 72) issues.push({ key: 'hips', cue: 'Keep the hips level and the body straighter.' });
    if (frame.handStackScore < 72) issues.push({ key: 'handStack', cue: 'Hands under shoulders.' });
    if (frame.elbowFlareScore < 70) issues.push({ key: 'elbowFlare', cue: 'Tuck the elbows in.' });
    return issues;
  };

  const renderAnalysisCue = (cue: string) => {
    const shortCue = shortenCue(cue);
    const now = Date.now();
    const isNewCue = shortCue !== cueLastTextRef.current;
    const cooldownExpired = now - cueLastEmittedAtRef.current >= 5000;
    if (!isNewCue && !cooldownExpired) return;

    cueLastTextRef.current = shortCue;
    cueLastEmittedAtRef.current = now;
    const currentModeAllowsVisuals = feedbackModeRef.current === 'visual' || feedbackModeRef.current === 'combined';
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';

    if (currentModeAllowsVisuals) {
      setCurrentCue(shortCue);
    }

    if (!spokenCoachingEnabledRef.current || !currentModeAllowsAudio || !audioUnlockedRef.current || Date.now() < repSpeechLockUntilRef.current) {
      return;
    }

    pushLog('cue', shortCue);
    speak(shortCue);
  };

  const updateCoachingFocus = (frame: PoseAnalysis) => {
    const now = Date.now();
    const issues = buildCoachingIssues(frame);
    const active = coachingFocusRef.current;
    const activeIssue = active.key ? issues.find((issue) => issue.key === active.key) : null;

    if (activeIssue) {
      coachingFocusRef.current = { key: activeIssue.key, resolvedAt: null, cue: activeIssue.cue };
      renderAnalysisCue(activeIssue.cue);
      return;
    }

    if (!active.key) {
      const nextIssue = issues[0];
      if (nextIssue) {
        coachingFocusRef.current = { key: nextIssue.key, resolvedAt: null, cue: nextIssue.cue };
        renderAnalysisCue(nextIssue.cue);
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
      renderAnalysisCue(nextIssue.cue);
      return;
    }

    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    if (modeAllowsVisuals) {
      setCurrentCue('Looking good!');
    }
  };

  const finishRep = (analysisFrame: PoseAnalysis) => {
    const nextRepIndex = repCounterRef.current.next();
    const rep = finalizeRep(repAccumulatorRef.current, analysisFrame, nextRepIndex);
    repAccumulatorRef.current = createEmptyRepAccumulator();
    if (!rep) return;
    const attempt = workflowModeRef.current === 'coaching' ? attemptForTrialState(coachingTrialStateRef.current) : 0;
    if (attempt) {
      rep.attempt = attempt;
      attemptRepCountRef.current[attempt] += 1;
    }
    setSessionReps((current) => [rep, ...current].slice(0, 50));
    pushLog('rep', `Rep ${rep.index}${attempt ? ` (set ${attempt})` : ''} scored ${rep.score}/100`, rep.notes.join(' • '));
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';
    if (currentModeAllowsAudio && audioUnlockedRef.current) {
      repSpeechLockUntilRef.current = Date.now() + 900;
      if (spokenCoachingEnabledRef.current) {
        const band = rep.score < 50 ? 'low' : rep.score <= 65 ? 'mid' : 'high';
        const phrasePool = repEncouragements[band];
        const phrase = phrasePool[repEncouragementTickRef.current % phrasePool.length];
        repEncouragementTickRef.current += 1;
        speak(phrase);
      } else {
        speak(`Rep ${attempt ? attemptRepCountRef.current[attempt] : nextRepIndex}`);
      }
    }

    if (!attempt) return;
    const nextTrialState = trialStateAfterRep(coachingTrialStateRef.current, attemptRepCountRef.current[attempt]);
    if (nextTrialState === coachingTrialStateRef.current) return;
    setTrialState(nextTrialState);
    setPaused(true);
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    if (nextTrialState === 'between-attempts') {
      pushLog('system', 'Set 1 complete. Coaching break.');
      setCurrentCue('Set 1 done! Adjust your form, then start set 2.');
    } else {
      pushLog('system', 'Set 2 complete.');
      setCurrentCue('Session complete!');
    }
  };

  const updateRepState = (frame: PoseAnalysis) => {
    if (calibrationStateRef.current !== 'counting') return;
    const { elbowAngle, confidence } = frame;
    const now = Date.now();
    if (confidence < MIN_SIGNAL) return;

    const state = repStateRef.current;
    const topThreshold = 158;
    const downThreshold = 120;

    if (!state.sawTop) {
      state.topStableFrames = elbowAngle >= topThreshold ? state.topStableFrames + 1 : 0;
      if (state.topStableFrames >= 3) {
        state.sawTop = true;
        state.sawBottom = false;
        state.bottomStableFrames = 0;
        repAccumulatorRef.current = createEmptyRepAccumulator();
        pushLog('system', 'Top position locked in.');
      }
      return;
    }

    repAccumulatorRef.current = {
      ...repAccumulatorRef.current,
      samples: repAccumulatorRef.current.samples + 1,
      depth: repAccumulatorRef.current.depth + frame.elbowDepthScore,
      bodyLine: repAccumulatorRef.current.bodyLine + frame.bodyLineScore,
      elbowFlare: repAccumulatorRef.current.elbowFlare + frame.elbowFlareScore,
      headAlignment: repAccumulatorRef.current.headAlignment + frame.headAlignmentScore,
      framing: repAccumulatorRef.current.framing + frame.framingScore,
      hipSag: repAccumulatorRef.current.hipSag + (frame.hipSagScore ?? 0),
      hipPike: repAccumulatorRef.current.hipPike + (frame.hipPikeScore ?? 0),
      handStack: repAccumulatorRef.current.handStack + frame.handStackScore,
      bestOverall: Math.max(repAccumulatorRef.current.bestOverall, frame.overallScore),
      worstOverall: repAccumulatorRef.current.samples === 0 ? frame.overallScore : Math.min(repAccumulatorRef.current.worstOverall, frame.overallScore),
      notes: [...new Set([
        ...repAccumulatorRef.current.notes,
        ...frame.notes.filter((note) => note !== frame.setupHint),
      ])].slice(0, 8),
    };

    if (elbowAngle <= downThreshold) {
      state.bottomStableFrames += 1;
      state.topStableFrames = 0;
      if (state.bottomStableFrames >= 3) {
        state.sawBottom = true;
      }
    } else if (elbowAngle >= topThreshold) {
      state.topStableFrames += 1;
      state.bottomStableFrames = 0;
    } else {
      state.topStableFrames = 0;
      state.bottomStableFrames = 0;
    }

    if (state.sawBottom && state.topStableFrames >= 3 && now - state.lastRepAt > 550) {
      state.lastRepAt = now;
      state.sawTop = false;
      state.sawBottom = false;
      state.topStableFrames = 0;
      state.bottomStableFrames = 0;
      finishRep(frame);
    }
  };

  const processAnalysis = (frame: PoseAnalysis) => {
    setAnalysis(frame);
    const smoothConfidence = confidenceSmoothRef.current
      ? confidenceSmoothRef.current * 0.85 + frame.confidence * 0.15
      : frame.confidence;
    confidenceSmoothRef.current = smoothConfidence;
    setCalibrationConfidence(Math.round(smoothConfidence * 100));

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
      if (isCalibrationReady(frame)) {
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

    if (workflowModeRef.current === 'coaching' && coachingPausedRef.current) {
      if (feedbackModeRef.current !== 'control') {
        updateCoachingFocus(frame);
      }
      return;
    }

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

  const drawSkeleton = (landmarks: PosePoint[] | null | undefined) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;
    if (!ctx || !video) {
      return;
    }
    const width = video.videoWidth || canvas.width;
    const height = video.videoHeight || canvas.height;
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Keep scoring on raw camera coordinates; the preview mirror is applied to both layers together.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks?.length) return;
    ctx.lineWidth = Math.max(3, canvas.width / 200);
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
      ctx.beginPath();
      ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
      ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
      ctx.stroke();
    }

    for (const point of landmarks) {
      if ((point.visibility ?? 0) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 200), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  useEffect(() => {
    frameHandlerRef.current = (landmarks) => {
      drawSkeleton(modeAllowsVisuals ? landmarks : null);
      processAnalysis(applyBaselineBias(analyzePose(landmarks, cameraView)));
    };
  });

  const stopCamera = () => {
    runningRef.current = false;
    clearCalibrationTimers();
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
    void unlockSound();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setCameraStatus('live');
      setSessionStartedAt((current) => current ?? nowIso());
      pushLog('system', `Camera started (${cameraFacing}).`);
      const loop = () => {
        if (!runningRef.current || !poseRef.current || !videoRef.current) return;
        const videoEl = videoRef.current;
        if (videoEl.readyState >= 2) {
          const result = poseRef.current.detectForVideo(videoEl, performance.now());
          frameHandlerRef.current(result.landmarks[0] as PosePoint[] | undefined);
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
    if (workflowMode === 'coaching') {
      if (!athleteName.trim()) return;
      clearSessionData();
      setTrialState('attempt-1');
      setPaused(false);
    } else {
      clearSessionData();
      setTrialState('idle');
      setPaused(false);
    }
    void startCamera();
  };

  const startSetTwo = () => {
    attemptRepCountRef.current[2] = 0;
    repStateRef.current = freshRepState();
    repAccumulatorRef.current = createEmptyRepAccumulator();
    coachingFocusRef.current = { key: null, resolvedAt: null, cue: '' };
    setTrialState('attempt-2');
    setPaused(false);
    pushLog('system', 'Set 2 started.');
    beginCountdown({ announce: false });
  };

  const stopSession = () => {
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

  const nextVolunteer = () => {
    resetForRetry();
    setAthleteName('');
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
    const notesSummary = [...new Set([...focusLines, ...sessionReps.flatMap((rep) => rep.notes)])].slice(0, 6).join('; ');
    return {
      timestamp: nowIso(),
      volunteer_name: athleteName.trim() || 'Anonymous',
      mode,
      attempt1_score: mode === 'coaching_session' ? set1Summary.average || '' : overallSummary.average,
      attempt2_score: mode === 'coaching_session' ? set2Summary.average || '' : '',
      delta: mode === 'coaching_session' && coachingComplete ? set2Summary.average - set1Summary.average : '',
      reps: overallSummary.count,
      notes_summary: notesSummary,
      device_user_agent: navigator.userAgent.slice(0, 120),
    };
  };

  const uploadResult = async () => {
    if (!athleteName.trim()) {
      setToast({ tone: 'error', text: 'Add a name before uploading.' });
      return;
    }
    setUploadState('uploading');
    setUploadMessage('Uploading to the results sheet…');
    try {
      const response = await fetch(RESULTS_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(buildUploadRow()),
      });
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }
      setUploadState('done');
      setUploadMessage('Uploaded to the shared results sheet.');
      setToast({ tone: 'success', text: 'Result uploaded to the sheet.' });
      pushLog('system', 'Result uploaded to Google Sheet.');
    } catch (error) {
      console.error(error);
      setUploadState('error');
      setUploadMessage('Upload failed — check the connection and try again. Export notes still works offline.');
      setToast({ tone: 'error', text: 'Upload failed. Try again.' });
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
    setToast({ tone: 'success', text: 'Admin unlocked on this device.' });
    pushLog('system', 'Admin PIN accepted.');
    return true;
  };

  const lockAdmin = () => {
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

  const seedDraftFromPose = () => {
    if (!analysis) return;
    const seeded = createBaselineReference(baselineAngle, analysis, `${baselineAngle} 100 standard`);
    setBaselineDraft((current) => (current ? { ...seeded, tolerances: current.tolerances } : seeded));
    setToast({ tone: 'info', text: 'Draft filled from the live pose. Review, then save.' });
  };

  const saveStandard = () => {
    if (!baselineDraft) return;
    const reference = { ...baselineDraft, angle: baselineAngle, createdAt: nowIso() };
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
      buildNotesExport({ ...summary, mode: feedbackMode, cameraView, spokenCoachingEnabled }, orderedReps),
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

  useEffect(() => {
    localStorage.setItem(SESSION_NAME_KEY, athleteName);
  }, [athleteName]);

  useEffect(() => {
    setSecureContext(window.isSecureContext);
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
          const resolver = await FilesetResolver.forVisionTasks(POSE_WASM_URL);
          poseRef.current = await PoseLandmarker.createFromOptions(resolver, {
            baseOptions: {
              modelAssetPath: POSE_MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.45,
            minPosePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
        }
        if (!cancelled) setPoseReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setPoseReady(false);
          setCameraError('The pose model failed to load. Check the connection and refresh.');
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

  const needsName = workflowMode === 'coaching' && !athleteName.trim();
  const phaseChip =
    phase === 'calibrating'
      ? 'Finding you'
      : phase === 'countdown'
        ? 'Get ready'
        : phase === 'break'
          ? 'Coaching break'
          : workflowMode === 'coaching'
            ? `Set ${currentAttempt} of 2`
            : 'Free practice';
  const showCue = modeAllowsVisuals && (phase === 'set' || phase === 'break' || phase === 'calibrating') && currentCue;

  const renderDock = () => {
    switch (phase) {
      case 'setup':
        return (
          <>
            {!poseReady || needsName ? (
              <p className="dock__hint">{!poseReady ? 'Loading the pose coach…' : 'Add your name above to start.'}</p>
            ) : null}
            <button className="btn btn--primary btn--xl btn--block" onClick={startSession} disabled={!poseReady || !secureContext || needsName}>
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
            <button className="btn btn--primary btn--xl btn--grow" onClick={startSetTwo}>
              Start set 2
            </button>
          </div>
        );
      case 'results':
        return (
          <div className="btn-row">
            <button className="btn btn--ghost" onClick={resetForRetry} aria-label="Try again with the same name">
              <RetryIcon /> Try again
            </button>
            {uploadState === 'done' ? (
              <button className="btn btn--primary btn--xl btn--grow" onClick={nextVolunteer}>
                Next volunteer
              </button>
            ) : (
              <button
                className="btn btn--primary btn--xl btn--grow"
                onClick={uploadResult}
                disabled={uploadState === 'uploading' || !athleteName.trim() || !sessionReps.length}
              >
                <UploadIcon /> {uploadState === 'uploading' ? 'Uploading…' : uploadState === 'error' ? 'Retry upload' : 'Upload result'}
              </button>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`app app--${phase}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 15h4l2-5 3 9 2.5-6H21" /></svg>
          </span>
          <span className="brand__name">Form Coach</span>
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

      <Stepper steps={steps} activeKey={stepKey} />

      <main className="layout">
        <section className={cameraActive ? 'stage-col' : 'stage-col is-dormant'} aria-hidden={!cameraActive}>
          <div className="stage">
            <video ref={videoRef} className={previewMirrored ? 'stage__video mirror' : 'stage__video'} playsInline muted autoPlay />
            <canvas ref={canvasRef} className={previewMirrored ? 'stage__overlay mirror' : 'stage__overlay'} />
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

            {workflowMode === 'coaching' && phase === 'set' ? (
              <div className="set-dots" aria-hidden="true">
                {Array.from({ length: REPS_PER_SET }, (_, index) => (
                  <span key={index} className={index < currentSetReps.length ? 'set-dot is-done' : 'set-dot'} />
                ))}
              </div>
            ) : null}

            {activeBanner && phase !== 'countdown' ? <div className="stage__alert" role="alert">{activeBanner}</div> : null}

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
              {!secureContext ? 'Camera access needs HTTPS. Open the Vercel link instead of a local file.' : cameraError}
            </div>
          ) : null}

          {phase === 'setup' ? (
            <SetupPanel
              name={athleteName}
              onNameChange={setAthleteName}
              workflowMode={workflowMode}
              onWorkflowModeChange={setWorkflowMode}
              feedbackMode={feedbackMode}
              onFeedbackModeChange={setFeedbackMode}
              spokenCoaching={spokenCoachingEnabled}
              onSpokenCoachingChange={setSpokenCoachingEnabled}
              cameraFacing={cameraFacing}
              onCameraFacingChange={setCameraFacing}
              cameraView={cameraView}
              onCameraViewChange={setCameraView}
              hasSavedStandard={Boolean(baselines.references[gradingAngle])}
              showNameHint={needsName}
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
              set1={set1Summary}
              focusLines={coachingFocusLines(set1Summary)}
              metrics={liveMetrics}
              visualsAllowed={modeAllowsVisuals}
              spokenCoaching={spokenCoachingEnabled}
              onSpokenCoachingChange={setSpokenCoachingEnabled}
              audioAllowed={modeAllowsAudio}
            />
          ) : null}

          {phase === 'results' ? (
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
              uploadMessage={uploadMessage || 'Upload adds one row to the shared science-fair results sheet.'}
              savedLocally={savedLocally}
              onSaveLocal={saveCurrentSession}
              onExportNotes={exportNotes}
              onExportCsv={exportCsv}
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
        baselines={baselines}
        angle={baselineAngle}
        onAngleChange={setBaselineAngle}
        gradingAngle={gradingAngle}
        draft={baselineDraft}
        onDraftChange={updateDraft}
        onSeedFromPose={seedDraftFromPose}
        onSave={saveStandard}
        onClearAll={clearStandards}
        live={cameraStatus === 'live' ? analysis : null}
        logs={sessionLogs}
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

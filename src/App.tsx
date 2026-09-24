import { useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { buildCsv, buildNotesExport, downloadTextFile } from './lib/export';
import { blendBaselineScore, createBaselineReference, loadBaselines, saveBaselines } from './lib/baselineStorage';
import { shouldMirrorPreview } from './lib/mirroring';
import { createRepCounter } from './lib/repCounter';
import { analyzePose, createEmptyRepAccumulator, finalizeRep, MIN_SIGNAL } from './lib/scoring';
import { loadHistory, saveHistory } from './lib/storage';
import { supabase, supabaseEnabled, type AuthSession } from './lib/supabaseClient';
import { playVoiceClip, playVoiceMessage, preloadVoiceClips } from './lib/voiceAudio';
import {
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

const cameraOptions: { label: string; value: CameraFacing }[] = [
  { label: 'Front camera', value: 'user' },
  { label: 'Back camera', value: 'environment' },
];

const viewOptions: { label: string; value: CameraViewMode; helper: string }[] = [
  {
    label: 'Head-on',
    value: 'head-on',
    helper: 'Default for phone demos. Put the phone low and in front so hands, torso, and head stay visible.',
  },
  {
    label: 'Side',
    value: 'side',
    helper: 'Advanced option. Use a tripod or extra room if you want the side-view hip-line cues.',
  },
];

const feedbackOptions: { label: string; value: FeedbackMode }[] = [
  { label: 'Control', value: 'control' },
  { label: 'Visual', value: 'visual' },
  { label: 'Audio', value: 'audio' },
  { label: 'Combined', value: 'combined' },
];

type CoachingIssueKey = 'setup' | 'depth' | 'elbowFlare' | 'handStack' | 'headAlignment' | 'hips';
type WorkflowMode = 'free' | 'coaching';
type CoachingTrialState = 'idle' | 'attempt-1' | 'between-attempts' | 'attempt-2' | 'complete';
type UserRole = 'admin' | 'standard_user' | 'local_admin';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const qualityLabel = (value: number) => {
  if (value >= 88) return 'elite';
  if (value >= 75) return 'solid';
  if (value >= 60) return 'in progress';
  return 'needs work';
};
const nowIso = () => new Date().toISOString();

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

function Metric({ label, value }: { label: string; value: number | null }) {
  const actualValue = value ?? 0;
  const color = actualValue >= 85 ? 'good' : actualValue >= 70 ? 'mid' : 'bad';
  return (
    <div className="metric">
      <div className="metric__head">
        <span>{label}</span>
        <strong>{value === null ? '—' : Math.round(value)}</strong>
      </div>
      <div className="metric__bar">
        <span className={color} style={{ width: `${clamp(actualValue, 0, 100)}%` }} />
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
  const repStateRef = useRef({ sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 });
  const repCounterRef = useRef(createRepCounter());
  const coachingFocusRef = useRef<{ key: CoachingIssueKey | null; resolvedAt: number | null; cue: string }>({
    key: null,
    resolvedAt: null,
    cue: '',
  });
  const frameCounterRef = useRef(0);
  const stableCalibrationFramesRef = useRef(0);
  const calibrationStateRef = useRef<'idle' | 'checking' | 'ready' | 'countdown' | 'counting'>('idle');
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
  const [reps, setReps] = useState(0);
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [currentCue, setCurrentCue] = useState('');
  const [spokenCoachingEnabled, setSpokenCoachingEnabled] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('free');
  const [coachingTrialState, setCoachingTrialState] = useState<CoachingTrialState>('idle');
  const [coachingPaused, setCoachingPaused] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authRole, setAuthRole] = useState<UserRole>('local_admin');
  const [authReady, setAuthReady] = useState(!supabaseEnabled);
  const [baselineAngle, setBaselineAngle] = useState<'front' | 'back' | 'side' | 'top'>('front');
  const [baselines, setBaselines] = useState(() => loadBaselines());
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
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(() => localStorage.getItem(SOUND_WANTED_KEY) === '1');
  const [calibrationState, setCalibrationState] = useState<'idle' | 'checking' | 'ready' | 'countdown' | 'counting'>('idle');
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [showGoOverlay, setShowGoOverlay] = useState(false);
  const [checkingElapsedMs, setCheckingElapsedMs] = useState(0);
  const [activeBanner, setActiveBanner] = useState<string | null>(null);
  const previewMirrored = shouldMirrorPreview(cameraFacing);
  const canManageBaselines = authRole === 'admin' || authRole === 'local_admin';
  const activeViewHelper = viewOptions.find((option) => option.value === cameraView)?.helper ?? '';
  const modeAllowsVisuals = feedbackMode === 'visual' || feedbackMode === 'combined';
  const modeAllowsAudio = feedbackMode === 'audio' || feedbackMode === 'combined';
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
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    const client = supabase;
    let cancelled = false;
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setAuthSession(data.session);
      void syncProfileRole(data.session).then((role) => {
        if (!cancelled) {
          setAuthRole(role);
        }
      });
      setAuthReady(true);
    });
    const { data } = client.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      setAuthSession(session);
      if (session?.user) {
        const { data: profile } = await client.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
        setAuthRole((profile?.role as UserRole | undefined) ?? 'standard_user');
      } else {
        setAuthRole('local_admin');
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    saveBaselines(baselines);
  }, [baselines]);
  useEffect(() => {
    calibrationStateRef.current = calibrationState;
  }, [calibrationState]);
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

  const currentSummary = useMemo(() => {
    const totalScore = sessionReps.reduce((sum, rep) => sum + rep.score, 0);
    const bestScore = sessionReps.reduce((best, rep) => Math.max(best, rep.score), 0);
    const averageScore = sessionReps.length ? Math.round(totalScore / sessionReps.length) : analysis?.overallScore ?? 0;
    return {
      averageScore,
      bestScore,
      quality: qualityLabel(averageScore),
    };
  }, [analysis?.overallScore, sessionReps]);

  const attemptReps = (attempt: 1 | 2) => sessionReps.filter((rep) => rep.attempt === attempt);
  const attemptSummary = (attempt: 1 | 2) => {
    const repsForAttempt = attemptReps(attempt);
    const total = repsForAttempt.reduce((sum, rep) => sum + rep.score, 0);
    const average = repsForAttempt.length ? Math.round(total / repsForAttempt.length) : 0;
    return {
      reps: repsForAttempt.length,
      average,
      best: repsForAttempt.reduce((best, rep) => Math.max(best, rep.score), 0),
    };
  };
  const coachingAttemptOne = attemptSummary(1);
  const coachingAttemptTwo = attemptSummary(2);
  const coachingDelta = coachingAttemptTwo.average - coachingAttemptOne.average;
  const coachingSummaryLines = useMemo(() => {
    const latest = sessionReps.filter((rep) => rep.attempt === (coachingTrialState === 'complete' ? 2 : 1));
    const avgDepth = latest.length ? latest.reduce((sum, rep) => sum + rep.elbowDepthScore, 0) / latest.length : 0;
    const avgBody = latest.length ? latest.reduce((sum, rep) => sum + rep.bodyLineScore, 0) / latest.length : 0;
    const avgElbows = latest.length ? latest.reduce((sum, rep) => sum + rep.elbowFlareScore, 0) / latest.length : 0;
    const summary: string[] = [];
    if (avgDepth < 68) summary.push('Depth: go a little deeper.');
    if (avgBody < 74) summary.push('Body line: keep the body straighter.');
    if (avgElbows < 72) summary.push('Elbows: tuck them in a little more.');
    if (!summary.length) summary.push('Looks strong — keep the same shape and depth.');
    return summary;
  }, [coachingTrialState, sessionReps]);

  const applyBaselineBias = (frame: PoseAnalysis): PoseAnalysis => {
    const reference = baselines.references[frame.viewMode === 'side' ? 'side' : baselineAngle];
    if (!reference) return frame;
    return {
      ...frame,
      overallScore: blendBaselineScore(frame.overallScore, reference.bodyLineScore ? reference.bodyLineScore : null, 16),
      elbowDepthScore: blendBaselineScore(frame.elbowDepthScore, reference.elbowDepthScore, 12),
      bodyLineScore: blendBaselineScore(frame.bodyLineScore, reference.bodyLineScore, 12),
      elbowFlareScore: blendBaselineScore(frame.elbowFlareScore, reference.elbowFlareScore, 10),
      handStackScore: blendBaselineScore(frame.handStackScore, reference.handStackScore, 10),
      headAlignmentScore: blendBaselineScore(frame.headAlignmentScore, reference.headAlignmentScore, 10),
      framingScore: blendBaselineScore(frame.framingScore, reference.framingScore, 10),
    };
  };

  const beforeAfter = useMemo(() => {
    const before = baselineScore ?? history.filter((item) => item.name === athleteName.trim()).at(-1)?.afterScore ?? 0;
    const after = currentSummary.averageScore;
    return {
      before,
      after,
      delta: after - before,
    };
  }, [athleteName, baselineScore, currentSummary.averageScore, history]);

  const metricDefinitions = cameraView === 'head-on'
    ? [
      { label: 'Elbow depth', value: analysis?.elbowDepthScore ?? null },
      { label: 'Body line', value: analysis?.bodyLineScore ?? null },
      { label: 'Elbow flare', value: analysis?.elbowFlareScore ?? null },
      { label: 'Hands stacked', value: analysis?.handStackScore ?? null },
      { label: 'Framing', value: analysis?.framingScore ?? null },
    ]
    : [
      { label: 'Elbow depth', value: analysis?.elbowDepthScore ?? null },
      { label: 'Body line', value: analysis?.bodyLineScore ?? null },
      { label: 'Hip sag', value: analysis?.hipSagScore ?? null },
      { label: 'Hip pike', value: analysis?.hipPikeScore ?? null },
      { label: 'Hands stacked', value: analysis?.handStackScore ?? null },
    ];

  const calibrationStatusText =
    calibrationState === 'countdown'
      ? countdownValue === null
        ? 'Calibration complete'
        : `Begin in ${countdownValue}`
      : calibrationState === 'ready'
        ? 'Ready'
        : calibrationState === 'counting'
          ? 'Counting'
          : 'Calibrating...';

  const neutralCoachText = modeAllowsAudio
    ? audioUnlocked
      ? 'Keep the phone steady.'
      : 'Tap Start camera and sound once to unlock cues on iPhone Safari.'
    : 'Control mode shows the camera and calibration gate only.';
  const calibrationHintCopy = 'You do not need 100% — Ready around 80% with a full body in frame.';
  const calibrationChecklist = analysis
    ? cameraView === 'head-on'
      ? [
          { label: 'Confidence (required)', ok: analysis.confidence >= 0.72, detail: `${Math.round(analysis.confidence * 100)}%` },
          { label: 'Hands + torso in frame (required)', ok: analysis.framingScore >= 64, detail: `${analysis.framingScore}%` },
          { label: 'Hands under shoulders (coach)', ok: analysis.handStackScore >= 50, detail: `${analysis.handStackScore}%` },
          { label: 'Head centered (coach)', ok: analysis.headAlignmentScore >= 50, detail: `${analysis.headAlignmentScore}%` },
        ]
      : [
          { label: 'Confidence (required)', ok: analysis.confidence >= 0.7, detail: `${Math.round(analysis.confidence * 100)}%` },
          { label: 'Full body in frame (required)', ok: analysis.framingScore >= 62, detail: `${analysis.framingScore}%` },
          { label: 'Hip line visible (coach)', ok: analysis.hipSagScore !== null && analysis.hipPikeScore !== null, detail: 'side-view' },
          { label: 'Hands under shoulders (coach)', ok: analysis.handStackScore >= 50, detail: `${analysis.handStackScore}%` },
        ]
    : [];

  useEffect(() => {
    if (!modeAllowsVisuals) {
      setCurrentCue(neutralCoachText);
    }
  }, [audioUnlocked, calibrationState, modeAllowsVisuals, neutralCoachText]);

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
    setCalibrationState('checking');
    setCalibrationConfidence(0);
    setCountdownValue(null);
  };

  const beginCountdown = () => {
    if (calibrationState === 'counting' || countdownTimerRef.current !== null) return;
    clearCalibrationTimers();
    setCalibrationState('countdown');
    setCountdownValue(null);
    setCurrentCue('Calibration complete');
    let countdown = 5;
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';
    const canSpeakCountdown = currentModeAllowsAudio && audioUnlockedRef.current;
    if (canSpeakCountdown) {
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
        setCalibrationState('counting');
        setShowGoOverlay(true);
        repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 };
        repAccumulatorRef.current = createEmptyRepAccumulator();
        pushLog('info', 'Calibration complete. Counting started.');
        setCurrentCue('go');
        if (goOverlayTimerRef.current !== null) {
          window.clearTimeout(goOverlayTimerRef.current);
        }
        goOverlayTimerRef.current = window.setTimeout(() => {
          setShowGoOverlay(false);
          goOverlayTimerRef.current = null;
        }, 900);
        if (audioContextRef.current) {
          playCueTone(audioContextRef.current);
        }
      }, 1000);
    };

    countdownTimerRef.current = window.setTimeout(startCountdown, 800);
  };

  const resetCoachingTrial = () => {
    setWorkflowMode('coaching');
    setCoachingTrialState('attempt-1');
    setCoachingPaused(false);
    setSessionReps([]);
    setSessionLogs([]);
    setReps(0);
    setAnalysis(null);
    setSessionStartedAt(null);
    repCounterRef.current.reset();
    repEncouragementTickRef.current = 0;
    repAccumulatorRef.current = createEmptyRepAccumulator();
    repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 };
    frameCounterRef.current = 0;
  };

  const startFreePractice = async () => {
    setWorkflowMode('free');
    setCoachingTrialState('idle');
    setCoachingPaused(false);
    await startCamera();
  };

  const startCoachingSession = async () => {
    resetCoachingTrial();
    await startCamera();
  };

  const continueCoachingAttempt = () => {
    setCoachingPaused(false);
    setCoachingTrialState((current) => (current === 'between-attempts' ? 'attempt-2' : current));
    repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 };
    repAccumulatorRef.current = createEmptyRepAccumulator();
    repCounterRef.current.reset();
    setCurrentCue('Try attempt 2.');
    pushLog('system', 'Attempt 2 started.');
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
      pushLog('info', 'Sound unlocked for iPhone Safari.');
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
    if (hint.includes('hands') && hint.includes('torso')) return 'MOVE BACK: Hands and torso not visible';
    if (hint.includes('hands')) return 'MOVE BACK: Hands not visible';
    if (hint.includes('torso')) return 'MOVE BACK: Torso not visible';
    if (hint.includes('shoulders')) return 'MOVE BACK: Shoulders not visible';
    if (hint.includes('full side profile')) return 'MOVE BACK: Full body not visible';
    if (frame.confidence < 0.65) return 'HOLD STILL: Need a clearer body';
    return null;
  };

  const buildSessionSummary = () => ({
    id: `${Date.now()}`,
    name: athleteName.trim() || 'Anonymous',
    dateIso: sessionStartedAt ?? nowIso(),
    reps,
    averageScore: currentSummary.averageScore,
    bestScore: currentSummary.bestScore,
    beforeScore: beforeAfter.before,
    afterScore: beforeAfter.after,
    spokenCoachingEnabled,
    notes: [...new Set([...sessionReps.flatMap((rep) => rep.notes), ...(analysis?.notes ?? [])])].slice(0, 8),
  });

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
      setCurrentCue('Good rep.');
    }
  };

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

  const processAnalysis = (frame: PoseAnalysis) => {
    setAnalysis(frame);
    const smoothConfidence = confidenceSmoothRef.current
      ? confidenceSmoothRef.current * 0.85 + frame.confidence * 0.15
      : frame.confidence;
    confidenceSmoothRef.current = smoothConfidence;
    setCalibrationConfidence(Math.round(smoothConfidence * 100));

    const isCounting = calibrationStateRef.current === 'counting';
    const lostTrackingText = 'MOVE BACK: Body lost';
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
      setCurrentCue(frame.setupHint ?? 'Move the full body into frame.');
      return;
    }

    const currentModeAllowsVisuals = feedbackModeRef.current === 'visual' || feedbackModeRef.current === 'combined';
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';

    if (calibrationStateRef.current !== 'counting') {
      if (isCalibrationReady(frame)) {
        stableCalibrationFramesRef.current += 1;
        if (stableCalibrationFramesRef.current >= 3 && calibrationStateRef.current === 'checking') {
          setCalibrationState('ready');
          setCurrentCue('Ready');
        }
      } else {
        stableCalibrationFramesRef.current = 0;
        if (calibrationStateRef.current !== 'countdown') {
          setCalibrationState('checking');
          setCountdownValue(null);
          setCurrentCue(frame.setupHint ?? 'Calibrating camera view...');
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

  const finishRep = (analysisFrame: PoseAnalysis) => {
    const nextRepIndex = repCounterRef.current.next();
    const rep = finalizeRep(repAccumulatorRef.current, analysisFrame, nextRepIndex);
    if (!rep) return;
    const nextAttempt = coachingTrialStateRef.current === 'attempt-2' ? 2 : coachingTrialStateRef.current === 'between-attempts' ? 2 : coachingTrialStateRef.current === 'idle' ? 0 : 1;
    if (nextAttempt) {
      rep.attempt = nextAttempt;
    }
    setReps(nextRepIndex);
    setSessionReps((current) => [rep, ...current].slice(0, 50));
    pushLog('rep', `Rep ${rep.index} scored ${rep.score}/100`, rep.notes.join(' • '));
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
        speak(`Rep ${nextRepIndex}`);
      }
    }
    if (workflowModeRef.current === 'coaching') {
      const attemptNumber = rep.attempt ?? 1;
      const attemptCount = sessionReps.filter((item) => item.attempt === attemptNumber).length + 1;
      if (attemptNumber === 1 && attemptCount >= 5) {
        setCoachingPaused(true);
        setCoachingTrialState('between-attempts');
        pushLog('system', 'Attempt 1 complete. Review coaching feedback before attempt 2.');
        setCurrentCue('Review the coaching feedback, then start attempt 2.');
        return;
      }
      if (attemptNumber === 2 && attemptCount >= 5) {
        setCoachingPaused(true);
        setCoachingTrialState('complete');
        pushLog('system', 'Attempt 2 complete. Compare the results.');
        setCurrentCue('Compare the two attempts.');
      }
    }
    repAccumulatorRef.current = createEmptyRepAccumulator();
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
    ctx.lineWidth = Math.max(2, canvas.width / 240);
    ctx.strokeStyle = 'rgba(123, 245, 255, 0.78)';
    ctx.fillStyle = '#8ffaff';

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
      ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(2.4, canvas.width / 220), 0, Math.PI * 2);
      ctx.fill();
    }
  };

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
      if (workflowModeRef.current === 'coaching') {
        setCoachingTrialState('attempt-1');
        setCoachingPaused(false);
      }
      pushLog('system', `Camera started (${cameraFacing}).`);
      const loop = async () => {
        if (!runningRef.current || !poseRef.current || !videoRef.current) return;
        const videoEl = videoRef.current;
        if (videoEl.readyState >= 2) {
          const result = poseRef.current.detectForVideo(videoEl, performance.now());
          const landmarks = result.landmarks[0] as PosePoint[] | undefined;
          drawSkeleton(modeAllowsVisuals ? landmarks : null);
          const frame = applyBaselineBias(analyzePose(landmarks, cameraView));
          processAnalysis(frame);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (error) {
      console.error(error);
      setCameraStatus('error');
      setCameraError('Camera access failed. Grant permission and try again.');
      pushLog('system', 'Camera access failed.');
      stopCamera();
    }
  };

  const stopCamera = () => {
    runningRef.current = false;
    clearCalibrationTimers();
    setCalibrationState('idle');
    setCountdownValue(null);
    setCalibrationConfidence(0);
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
    if (cameraStatus === 'live') setCameraStatus('idle');
    setShowGoOverlay(false);
  };

  const stopSession = () => {
    stopCamera();
    runningRef.current = false;
    setCameraStatus('idle');
    pushLog('system', 'Session stopped.');
  };

  const resetSet = () => {
    stopCamera();
    setSessionReps([]);
    setSessionLogs([]);
    setReps(0);
    setAnalysis(null);
    setCurrentCue('');
    setSessionStartedAt(null);
    setShowGoOverlay(false);
    setCurrentCue('');
    repCounterRef.current.reset();
    repEncouragementTickRef.current = 0;
    repAccumulatorRef.current = createEmptyRepAccumulator();
    repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0, topStableFrames: 0, bottomStableFrames: 0 };
    frameCounterRef.current = 0;
    pushLog('system', 'Set reset.');
  };

  const saveCurrentSession = () => {
    if (!sessionReps.length && !analysis) return;
    const summary: SessionEntry = buildSessionEntry();
    const nextHistory = [summary, ...history].slice(0, 25);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
    setBaselineScore(summary.afterScore);
    pushLog('system', 'Session saved locally.');
    if (supabase && authSession?.user) {
      void supabase.from('session_results').insert({
        user_id: authSession.user.id,
        session_json: {
          summary,
          reps: sessionReps,
        },
      });
    }
  };

  const deleteHistoryEntry = (id: string) => {
    const nextHistory = history.filter((entry) => entry.id !== id);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
    pushLog('system', 'Deleted a saved session.');
  };

  const clearHistory = () => {
    if (!history.length) return;
    setHistory([]);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    pushLog('system', 'Cleared saved sessions.');
  };

  const syncProfileRole = async (session: AuthSession | null) => {
    if (!supabase || !session?.user) return 'local_admin' as UserRole;
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    return (data?.role as UserRole | undefined) ?? 'standard_user';
  };

  const signIn = async () => {
    if (!supabase) {
      setAuthMessage('Supabase env vars are missing. Using local admin mode for the demo.');
      setAuthRole('local_admin');
      setAdminMode(true);
      return;
    }
    setAuthLoading(true);
    setAuthMessage('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setAuthMessage(error.message);
      setAuthLoading(false);
      return;
    }
    const role = await syncProfileRole(data.session);
    setAuthRole(role);
    setAdminMode(role === 'admin');
    setAuthMessage(`Signed in as ${role}.`);
    setAuthLoading(false);
  };

  const signUp = async () => {
    if (!supabase) {
      setAuthMessage('Supabase env vars are missing. Use local admin mode for now.');
      setAuthRole('local_admin');
      setAdminMode(true);
      return;
    }
    setAuthLoading(true);
    setAuthMessage('');
    const { data, error } = await supabase.auth.signUp({
      email: authEmail.trim(),
      password: authPassword,
    });
    if (error) {
      setAuthMessage(error.message);
      setAuthLoading(false);
      return;
    }
    const role = await syncProfileRole(data.session ?? null);
    if (data.session) {
      setAuthRole(role);
      setAdminMode(role === 'admin');
      setAuthMessage(`Account created. Signed in as ${role}.`);
    } else {
      setAuthMessage('Account created. Check email if confirmation is enabled.');
    }
    setAuthLoading(false);
  };

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setAuthSession(null);
    setAuthRole('local_admin');
    setAdminMode(true);
    setAuthMessage('Signed out.');
  };

  const exportNotes = () => {
    if (!sessionReps.length && !analysis) return;
    const summary = buildSessionSummary();
    downloadTextFile(
      `pushup-session-${summary.id}-notes.md`,
      buildNotesExport({
        ...summary,
        mode: feedbackMode,
        cameraView,
        spokenCoachingEnabled,
      }, sessionReps),
      'text/markdown',
    );
  };

  const exportCsv = () => {
    if (!sessionReps.length && !analysis) return;
    const summary: SessionSummary = buildSessionSummary();
    downloadTextFile(`pushup-session-${summary.id}.csv`, buildCsv(summary, sessionReps, sessionLogs), 'text/csv');
  };

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
          setCameraError('Pose model failed to load. Try again.');
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

  return (
    <main className="shell">
      <section className="hero">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Push-up form coach</p>
            <h1>Camera coaching for cleaner reps.</h1>
          </div>
          <div className="pill">{secureContext ? 'secure context ready' : 'needs HTTPS'}</div>
        </div>
      </section>

      <section className="layout">
        <div className="camera-card">
          <div className="video-frame">
            <video
              ref={videoRef}
              className={previewMirrored ? 'video mirror' : 'video'}
              playsInline
              muted
              autoPlay
            />
            <canvas ref={canvasRef} className={previewMirrored ? 'overlay mirror' : 'overlay'} />
            <div className="rep-counter">
              <span className="rep-counter__label">reps</span>
              <strong>{reps}</strong>
            </div>
            <div className="status-badges">
              <span>{cameraStatus === 'live' ? 'live' : cameraStatus}</span>
              <span>camera</span>
              <span>{cameraView}</span>
              <span>{feedbackMode}</span>
            </div>
            {activeBanner ? <div className="urgent-banner">{activeBanner}</div> : null}
            <div className="calibration-overlay">
              <span className={calibrationState === 'countdown' || calibrationState === 'counting' ? 'calibration-overlay__badge calibration-overlay__badge--ready' : 'calibration-overlay__badge'}>
                {calibrationStatusText}
              </span>
              <span className="calibration-overlay__meter">{`${Math.round(calibrationConfidence)}% confidence`}</span>
            </div>
            {showGoOverlay ? (
              <div className="go-overlay" aria-hidden="true">
                <div className="go-overlay__text">GO</div>
              </div>
            ) : null}
          </div>

          <div className="controls card">
            <div className="control-row">
              {cameraOptions.map((option) => (
                <button key={option.value} className={cameraFacing === option.value ? 'button button--active' : 'button'} onClick={() => setCameraFacing(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>

            <div className="control-row">
              {viewOptions.map((option) => (
                <button
                  key={option.value}
                  className={cameraView === option.value ? 'button button--active' : 'button'}
                  onClick={() => setCameraView(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="setup-copy">{activeViewHelper}</p>

            <div className="control-row">
              {feedbackOptions.map((option) => (
                <button key={option.value} className={feedbackMode === option.value ? 'button button--active' : 'button'} onClick={() => setFeedbackMode(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>

            <div className="control-row">
              <button className={workflowMode === 'free' ? 'button button--active' : 'button'} onClick={() => setWorkflowMode('free')}>
                Free practice
              </button>
              <button
                className={workflowMode === 'coaching' ? 'button button--active' : 'button'}
                onClick={() => {
                  resetCoachingTrial();
                }}
              >
                Coaching session
              </button>
            </div>

            <div className="field-row">
              <label>
                Athlete name
                <input value={athleteName} onChange={(event) => setAthleteName(event.target.value)} placeholder="Optional name" />
              </label>
              <label>
                Session history
                <input value={`${history.length} saved`} readOnly />
              </label>
            </div>

            <div className="session-action-row">
              {cameraStatus === 'live' ? (
                <button className="button button--primary button--stop" onClick={stopSession}>
                  Stop session
                </button>
              ) : sessionReps.length || analysis ? (
                <button className="button button--primary" onClick={resetSet}>
                  Try again
                </button>
              ) : null}
            </div>

            <div className="action-row">
              <button className="button button--primary" onClick={workflowMode === 'coaching' ? startCoachingSession : startFreePractice} disabled={!poseReady || !secureContext}>
                {workflowMode === 'coaching' ? 'Start coaching session' : 'Start camera and sound'}
              </button>
              <button
                className={spokenCoachingEnabled ? 'button button--active' : 'button'}
                onClick={() => setSpokenCoachingEnabled((value) => !value)}
              >
                {spokenCoachingEnabled ? 'Form coaching (spoken): on' : 'Form coaching (spoken): off'}
              </button>
            </div>

            <div className="action-row secondary">
              <button className="button button--primary" onClick={exportNotes} disabled={!sessionReps.length && !analysis}>
                Export notes
              </button>
              <button className="button" onClick={saveCurrentSession} disabled={!sessionReps.length && !analysis}>
                Save local score
              </button>
              <button className="button" onClick={exportCsv} disabled={!sessionReps.length && !analysis}>
                Export CSV
              </button>
            </div>

            <div className="card coaching-flow-card">
              <div className="card-head">
                <h2>Admin baseline</h2>
                <span className="pill">{canManageBaselines ? 'admin' : 'standard user'}</span>
              </div>
              <p className="muted">Capture a good reference per angle. Baselines are local now and can sync from Supabase later.</p>
              <div className="action-row">
                <button
                  className="button"
                  onClick={() => {
                    if (!supabaseEnabled) {
                      setAdminMode((value) => !value);
                    }
                  }}
                  disabled={supabaseEnabled}
                >
                  {adminMode ? 'Local admin on' : 'Local admin mode'}
                </button>
              </div>
              <div className="control-row">
                {(['front', 'back', 'side', 'top'] as const).map((angle) => (
                  <button key={angle} className={baselineAngle === angle ? 'button button--active' : 'button'} onClick={() => setBaselineAngle(angle)}>
                    {angle}
                  </button>
                ))}
              </div>
              <div className="action-row">
                <button
                  className="button button--primary"
                  disabled={!canManageBaselines || !analysis}
                  onClick={() => {
                    if (!analysis) return;
                    setBaselines((current) => ({
                      updatedAt: nowIso(),
                      references: {
                        ...current.references,
                        [baselineAngle]: createBaselineReference(baselineAngle, analysis, `${baselineAngle} baseline`),
                      },
                    }));
                    if (supabase && authSession?.user && canManageBaselines) {
                      void supabase.from('baselines').upsert({
                        angle: baselineAngle,
                        label: `${baselineAngle} baseline`,
                        pose: createBaselineReference(baselineAngle, analysis, `${baselineAngle} baseline`),
                        created_by: authSession.user.id,
                        active: true,
                      });
                    }
                    pushLog('system', `Saved ${baselineAngle} baseline locally.`);
                  }}
                >
                  Save current baseline
                </button>
                <button
                  className="button"
                  disabled={!canManageBaselines}
                  onClick={() => {
                    setBaselines({
                      updatedAt: nowIso(),
                      references: { front: null, back: null, side: null, top: null },
                    });
                    pushLog('system', 'Cleared local baselines.');
                  }}
                >
                  Clear baselines
                </button>
              </div>
              <div className="summary-list">
                {(['front', 'back', 'side', 'top'] as const).map((angle) => (
                  <div key={angle} className="muted">
                    {angle}: {baselines.references[angle] ? 'saved' : 'empty'}
                  </div>
                ))}
              </div>
            </div>

            <div className="card coaching-flow-card">
              <div className="card-head">
                <h2>Sign in</h2>
                <span className="pill">{authReady ? (supabaseEnabled ? 'Supabase on' : 'Local demo') : 'Loading auth'}</span>
              </div>
              <p className="muted">
                Email/password auth unlocks admin baselines and saved results. When Supabase env vars are missing, the app keeps the demo working with local admin mode.
              </p>
              <div className="field-row">
                <label>
                  Email
                  <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" />
                </label>
                <label>
                  Password
                  <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="••••••••" />
                </label>
              </div>
              <div className="action-row">
                <button className="button button--primary" disabled={authLoading} onClick={signIn}>
                  Sign in
                </button>
                <button className="button" disabled={authLoading} onClick={signUp}>
                  Sign up
                </button>
                <button className="button" disabled={authLoading && !authSession} onClick={signOut}>
                  Sign out
                </button>
              </div>
              <p className="muted">{authSession ? `Signed in as ${authSession.user.email ?? 'unknown'} (${authRole})` : 'Signed out'}</p>
              {authMessage ? <p className="metric-copy">{authMessage}</p> : null}
            </div>

            {workflowMode === 'coaching' ? (
              <div className="card coaching-flow-card">
                <div className="card-head">
                  <h2>Coaching session</h2>
                  <span className="pill">{coachingTrialState === 'complete' ? 'done' : coachingTrialState}</span>
                </div>
                <p className="muted">Attempt 1 and attempt 2 are exactly 5 push-ups each. Keep the camera live between attempts to coach the form.</p>
                <div className="score-grid score-grid--compact">
                  <div>
                    <span className="muted">Attempt 1</span>
                    <strong>{coachingAttemptOne.reps}/5</strong>
                    <span className="muted">{coachingAttemptOne.average || '—'} avg</span>
                  </div>
                  <div>
                    <span className="muted">Attempt 2</span>
                    <strong>{coachingAttemptTwo.reps}/5</strong>
                    <span className="muted">{coachingAttemptTwo.average || '—'} avg</span>
                  </div>
                  <div>
                    <span className="muted">Delta</span>
                    <strong>{coachingAttemptOne.reps && coachingAttemptTwo.reps ? `${coachingDelta >= 0 ? '+' : ''}${coachingDelta}` : '—'}</strong>
                  </div>
                </div>
                <ul className="summary-list">
                  {coachingSummaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {coachingTrialState === 'between-attempts' ? (
                  <button className="button button--primary" onClick={continueCoachingAttempt}>
                    Start attempt 2
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="insights">
          <article className="card score-card">
            {modeAllowsVisuals ? (
              <>
                <div className="score-grid">
                  <div>
                    <span className="muted">Overall</span>
                    <strong>{analysis ? `${analysis.overallScore}` : '—'}</strong>
                  </div>
                  <div>
                    <span className="muted">Quality</span>
                    <strong>{currentSummary.quality}</strong>
                  </div>
                  <div>
                    <span className="muted">Confidence</span>
                    <strong>{analysis ? `${Math.round(analysis.confidence * 100)}%` : '—'}</strong>
                  </div>
                  <div>
                    <span className="muted">Pose</span>
                    <strong>{analysis?.phase ?? 'idle'}</strong>
                  </div>
                </div>
                {calibrationState !== 'counting' ? (
                  <div className="checklist">
                    <p className="metric-copy">{calibrationHintCopy}</p>
                    {calibrationChecklist.map((item) => (
                      <div key={item.label} className={item.ok ? 'checklist__item checklist__item--ok' : 'checklist__item checklist__item--bad'}>
                        <span>{item.ok ? '●' : '○'}</span>
                        <strong>{item.label}</strong>
                        <em>{item.detail}</em>
                      </div>
                    ))}
                    {checkingElapsedMs >= 3000 ? (
                      <button className="button button--primary" onClick={beginCountdown}>
                        Start anyway
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="metrics">
                  {metricDefinitions.map((metric) => (
                    <Metric key={metric.label} label={metric.label} value={metric.value} />
                  ))}
                </div>
                <p className="metric-copy">
                  {cameraView === 'head-on'
                    ? 'Head-on view emphasizes depth and body line first. It uses a hip-height proxy for straightness, so Side view is best for judging plank line exactly.'
                    : 'Side view keeps the classic hip sag / hip pike body-line cues, and the score weights depth + body line the most.'}
                </p>
              </>
            ) : (
              <div className="calibration-panel">
                <div className="score-grid">
                  <div>
                    <span className="muted">Status</span>
                    <strong>{calibrationStatusText}</strong>
                  </div>
                  <div>
                    <span className="muted">Frame confidence</span>
                    <strong>{`${Math.round(calibrationConfidence)}%`}</strong>
                  </div>
                  <div>
                    <span className="muted">View</span>
                    <strong>{cameraView}</strong>
                  </div>
                </div>
                <div className="checklist">
                  <p className="metric-copy">{calibrationHintCopy}</p>
                  {calibrationChecklist.map((item) => (
                    <div key={item.label} className={item.ok ? 'checklist__item checklist__item--ok' : 'checklist__item checklist__item--bad'}>
                      <span>{item.ok ? '●' : '○'}</span>
                      <strong>{item.label}</strong>
                      <em>{item.detail}</em>
                    </div>
                  ))}
                  {checkingElapsedMs >= 3000 ? (
                    <button className="button button--primary" onClick={beginCountdown}>
                      Start anyway
                    </button>
                  ) : null}
                </div>
                <div className="metric-copy">{neutralCoachText}</div>
              </div>
            )}
          </article>

          <article className="card coaching-card">
            <div className="card-head">
              <h2>After-set coaching</h2>
              <span>{sessionReps.length ? `${sessionReps.length} scored reps` : 'Ready for a set'}</span>
            </div>
            <div className="before-after">
              <div>
                <span className="muted">Before</span>
                <strong>{beforeAfter.before}</strong>
              </div>
              <div>
                <span className="muted">After</span>
                <strong>{beforeAfter.after}</strong>
              </div>
              <div>
                <span className="muted">Delta</span>
                <strong className={clamp(beforeAfter.delta, -999, 999) >= 0 ? 'positive' : 'negative'}>{beforeAfter.delta >= 0 ? '+' : ''}{beforeAfter.delta}</strong>
              </div>
            </div>
            <p className="cue">
              {modeAllowsVisuals
                ? currentCue || 'Start a set to unlock feedback and comparisons.'
                : neutralCoachText}
            </p>
            <ul className="notes">
              {(modeAllowsVisuals && analysis?.notes.length
                ? analysis.notes
                : [
                    calibrationStatusText,
                    modeAllowsAudio ? (audioUnlocked ? 'Sound is unlocked and ready.' : 'Tap Start camera and sound for a spoken countdown on iPhone Safari.') : 'No visual coaching in Control mode.',
                    cameraView === 'head-on' ? 'Head-on is the recommended mobile demo.' : 'Side view is optional and needs a wider tripod setup.',
                  ]).slice(0, 3).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </article>

          <article className="card history-card">
            <div className="card-head">
              <h2>Local score history</h2>
              <span>Saved on this device only</span>
            </div>
            <div className="history-actions">
              <button className="button" onClick={clearHistory} disabled={!history.length}>
                Clear all
              </button>
              <span className="muted">{history.length ? `${history.length} saved` : 'No saved sessions yet.'}</span>
            </div>
            <div className="history-list">
              {history.length === 0 ? null : history.map((entry) => (
                <details key={entry.id} className="history-item">
                  <summary className="history-item__summary">
                    <div>
                      <strong>{entry.name}</strong>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="history-item__stats">
                      <strong>{entry.reps} reps</strong>
                      <span>{entry.afterScore} / 100 · {entry.cameraView}</span>
                    </div>
                  </summary>
                  <div className="history-item__body">
                    <div className="history-item__notes">
                      <strong>Notes</strong>
                      {entry.notes.length ? (
                        <ul>
                          {entry.notes.map((note, index) => (
                            <li key={`${entry.id}-${index}`}>{note}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No notes yet.</p>
                      )}
                    </div>
                    <button className="button" onClick={() => deleteHistoryEntry(entry.id)}>
                      Delete
                    </button>
                  </div>
                </details>
              ))}
            </div>
          </article>

          <article className="card log-card">
            <div className="card-head">
              <h2>Always-on log</h2>
              <span>{sessionLogs.length} events</span>
            </div>
            <div className="log-list">
              {sessionLogs.length === 0 ? (
                <p className="muted">Camera and coaching events appear here.</p>
              ) : (
                sessionLogs.map((entry) => (
                  <div key={entry.id} className={`log-item log-item--${entry.kind}`}>
                    <span>{new Date(entry.at).toLocaleTimeString()}</span>
                    <strong>{entry.message}</strong>
                    {entry.details ? <p>{entry.details}</p> : null}
                  </div>
                ))
              )}
            </div>
          </article>

        </div>
      </section>

      {!secureContext ? <div className="banner">Camera access is blocked until the app is served over HTTPS or localhost.</div> : null}
      {cameraError ? <div className="banner banner--warn">{cameraError}</div> : null}
      {!poseReady ? <div className="banner">Loading pose model...</div> : null}
    </main>
  );
}

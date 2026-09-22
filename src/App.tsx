import { useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createDemoPose } from './lib/demo';
import { buildCsv, downloadTextFile, exportSessionJson } from './lib/export';
import { shouldMirrorPreview } from './lib/mirroring';
import { analyzePose, createEmptyRepAccumulator, finalizeRep, MIN_SIGNAL } from './lib/scoring';
import { loadHistory, saveHistory } from './lib/storage';
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
const SESSION_STORAGE_KEY = 'pushup-form-coach-history';
const SESSION_NAME_KEY = 'pushup-form-coach-name';

const cameraOptions: { label: string; value: CameraFacing }[] = [
  { label: 'Front camera', value: 'user' },
  { label: 'Back camera', value: 'environment' },
];

const viewOptions: { label: string; value: CameraViewMode; helper: string }[] = [
  {
    label: 'Head-on',
    value: 'head-on',
    helper: 'Default for phone demos. Put the phone low and in front so wrists and feet stay visible.',
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const qualityLabel = (value: number) => {
  if (value >= 88) return 'elite';
  if (value >= 75) return 'solid';
  if (value >= 60) return 'in progress';
  return 'needs work';
};
const nowIso = () => new Date().toISOString();

function speak(message: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1.02;
  utterance.pitch = 1.02;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

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
  const runningRef = useRef(false);
  const speakCooldownRef = useRef(0);
  const repAccumulatorRef = useRef(createEmptyRepAccumulator());
  const repStateRef = useRef({ sawTop: false, sawBottom: false, lastRepAt: 0 });
  const frameCounterRef = useRef(0);
  const stableCalibrationFramesRef = useRef(0);
  const calibrationStateRef = useRef<'idle' | 'checking' | 'ready' | 'countdown' | 'counting'>('idle');

  const [secureContext, setSecureContext] = useState(window.isSecureContext);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('user');
  const [cameraView, setCameraView] = useState<CameraViewMode>('head-on');
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>('combined');
  const [demoMode, setDemoMode] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'live' | 'error'>('idle');
  const [cameraError, setCameraError] = useState('');
  const [poseReady, setPoseReady] = useState(false);
  const [athleteName, setAthleteName] = useState(() => localStorage.getItem(SESSION_NAME_KEY) ?? '');
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [sessionReps, setSessionReps] = useState<SessionRep[]>([]);
  const [reps, setReps] = useState(0);
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null);
  const [currentCue, setCurrentCue] = useState('');
  const [history, setHistory] = useState<SessionEntry[]>(() => loadHistory(SESSION_STORAGE_KEY));
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [sessionStopped, setSessionStopped] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [calibrationState, setCalibrationState] = useState<'idle' | 'checking' | 'ready' | 'countdown' | 'counting'>('idle');
  const [calibrationConfidence, setCalibrationConfidence] = useState(0);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const previewMirrored = shouldMirrorPreview(cameraFacing);
  const activeViewHelper = viewOptions.find((option) => option.value === cameraView)?.helper ?? '';
  const modeAllowsVisuals = feedbackMode === 'visual' || feedbackMode === 'combined';
  const modeAllowsAudio = feedbackMode === 'audio' || feedbackMode === 'combined';
  const feedbackModeRef = useRef(feedbackMode);
  const audioUnlockedRef = useRef(audioUnlocked);
  useEffect(() => {
    feedbackModeRef.current = feedbackMode;
  }, [feedbackMode]);
  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);
  useEffect(() => {
    calibrationStateRef.current = calibrationState;
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
      { label: 'Elbow flare', value: analysis?.elbowFlareScore ?? null },
      { label: 'Hands stacked', value: analysis?.handStackScore ?? null },
      { label: 'Head alignment', value: analysis?.headAlignmentScore ?? null },
      { label: 'Framing', value: analysis?.framingScore ?? null },
    ]
    : [
      { label: 'Elbow depth', value: analysis?.elbowDepthScore ?? null },
      { label: 'Hip sag', value: analysis?.hipSagScore ?? null },
      { label: 'Hip pike', value: analysis?.hipPikeScore ?? null },
      { label: 'Hands stacked', value: analysis?.handStackScore ?? null },
      { label: 'Elbow flare', value: analysis?.elbowFlareScore ?? null },
    ];

  const calibrationStatusText =
    calibrationState === 'countdown'
      ? `Begin in ${countdownValue ?? 3}`
      : calibrationState === 'ready'
        ? 'Ready'
        : calibrationState === 'counting'
          ? 'Counting'
          : 'Calibrating...';

  const neutralCoachText = modeAllowsAudio
    ? audioUnlocked
      ? 'Audio cues are unlocked. Keep the phone steady.'
      : 'Tap Enable sound once to unlock cues on iPhone Safari.'
    : 'Control mode shows the camera and calibration gate only.';

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
  };

  const resetCalibrationFlow = () => {
    clearCalibrationTimers();
    stableCalibrationFramesRef.current = 0;
    setCalibrationState('checking');
    setCalibrationConfidence(0);
    setCountdownValue(null);
  };

  const beginCountdown = () => {
    if (calibrationState === 'counting' || countdownTimerRef.current !== null) return;
    clearCalibrationTimers();
    setCalibrationState('countdown');
    setCountdownValue(3);
    setCurrentCue('Begin in 3');
    let countdown = 3;
    countdownTimerRef.current = window.setInterval(() => {
      countdown -= 1;
      if (countdown > 0) {
        setCountdownValue(countdown);
        setCurrentCue(`Begin in ${countdown}`);
        return;
      }

      clearCalibrationTimers();
      setCountdownValue(null);
      setCalibrationState('counting');
      repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0 };
      repAccumulatorRef.current = createEmptyRepAccumulator();
      pushLog('info', 'Calibration complete. Counting started.');
      setCurrentCue('Begin now.');
      const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';
      if (currentModeAllowsAudio && audioUnlockedRef.current && audioContextRef.current) {
        playCueTone(audioContextRef.current);
        speak('Begin now.');
      }
    }, 1000);
  };

  const unlockSound = async () => {
    const unlocked = await unlockAudioContext(audioContextRef);
    setAudioUnlocked(unlocked);
    if (unlocked) {
      pushLog('info', 'Sound unlocked for iPhone Safari.');
    }
  };

  const isCalibrationReady = (frame: PoseAnalysis) => {
    if (frame.confidence < 0.68 || frame.framingScore < 72 || frame.setupHint) return false;
    if (cameraView === 'head-on') {
      return frame.headAlignmentScore >= 60 && frame.handStackScore >= 60;
    }
    return frame.hipSagScore !== null && frame.hipPikeScore !== null && frame.handStackScore >= 60;
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
    pushLog('cue', cue);
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';
    if (!currentModeAllowsAudio || !audioUnlockedRef.current) {
      return;
    }
    const now = Date.now();
    if (now - speakCooldownRef.current > 1800) {
      speakCooldownRef.current = now;
      if (audioContextRef.current) {
        void audioContextRef.current.resume();
        playCueTone(audioContextRef.current);
      }
      speak(cue);
    }
  };

  const processAnalysis = (frame: PoseAnalysis) => {
    setAnalysis(frame);
    if (frame.confidence < MIN_SIGNAL) {
      setCalibrationConfidence(Math.round(frame.confidence * 100));
      setCurrentCue(frame.setupHint ?? 'Move the full body into frame.');
      return;
    }

    setCalibrationConfidence(Math.round(frame.confidence * 100));
    const currentModeAllowsVisuals = feedbackModeRef.current === 'visual' || feedbackModeRef.current === 'combined';
    const currentModeAllowsAudio = feedbackModeRef.current === 'audio' || feedbackModeRef.current === 'combined';

    if (calibrationStateRef.current !== 'counting') {
      if (isCalibrationReady(frame)) {
        stableCalibrationFramesRef.current += 1;
        if (stableCalibrationFramesRef.current >= 6 && calibrationStateRef.current === 'checking') {
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

    const cue = frame.notes[0] ?? (frame.overallScore >= 80 ? 'Great rep rhythm.' : 'Keep moving smoothly.');
    if (currentModeAllowsVisuals) {
      setCurrentCue(cue);
    } else if (currentModeAllowsAudio) {
      setCurrentCue(audioUnlockedRef.current ? 'Audio cues active.' : 'Tap Enable sound for audio cues.');
    } else {
      setCurrentCue('Control mode: camera only.');
    }
    if (frame.notes.length) renderAnalysisCue(cue);
    updateRepState(frame);
  };

  const finishRep = (analysisFrame: PoseAnalysis) => {
    const rep = finalizeRep(repAccumulatorRef.current, analysisFrame, reps + 1);
    if (!rep) return;
    setReps((value) => value + 1);
    setSessionReps((current) => [rep, ...current].slice(0, 50));
    pushLog('rep', `Rep ${rep.index} scored ${rep.score}/100`, rep.notes.join(' • '));
    if (analysisFrame.notes.length) renderAnalysisCue(analysisFrame.notes[0]);
    repAccumulatorRef.current = createEmptyRepAccumulator();
  };

  const updateRepState = (frame: PoseAnalysis) => {
    if (calibrationStateRef.current !== 'counting') return;
    const { elbowAngle, overallScore, confidence } = frame;
    const now = Date.now();
    if (confidence < MIN_SIGNAL) return;

    const top = elbowAngle >= 155 && overallScore >= 50;
    const bottom = elbowAngle <= 92 && frame.elbowDepthScore >= 65;

    if (!repStateRef.current.sawTop && top) {
      repStateRef.current.sawTop = true;
      repAccumulatorRef.current = createEmptyRepAccumulator();
      pushLog('system', 'Top position locked in.');
    }

    if (repStateRef.current.sawTop) {
      repAccumulatorRef.current = {
        ...repAccumulatorRef.current,
        samples: repAccumulatorRef.current.samples + 1,
        depth: repAccumulatorRef.current.depth + frame.elbowDepthScore,
        elbowFlare: repAccumulatorRef.current.elbowFlare + frame.elbowFlareScore,
        headAlignment: repAccumulatorRef.current.headAlignment + frame.headAlignmentScore,
        framing: repAccumulatorRef.current.framing + frame.framingScore,
        hipSag: repAccumulatorRef.current.hipSag + (frame.hipSagScore ?? 0),
        hipPike: repAccumulatorRef.current.hipPike + (frame.hipPikeScore ?? 0),
        handStack: repAccumulatorRef.current.handStack + frame.handStackScore,
        bestOverall: Math.max(repAccumulatorRef.current.bestOverall, frame.overallScore),
        worstOverall: repAccumulatorRef.current.samples === 0 ? frame.overallScore : Math.min(repAccumulatorRef.current.worstOverall, frame.overallScore),
        notes: [...new Set([...repAccumulatorRef.current.notes, ...frame.notes])].slice(0, 8),
      };
    }

    if (repStateRef.current.sawTop && bottom) {
      repStateRef.current.sawBottom = true;
      pushLog('system', 'Bottom depth reached.');
    }

    if (repStateRef.current.sawTop && repStateRef.current.sawBottom && top && now - repStateRef.current.lastRepAt > 700) {
      repStateRef.current.lastRepAt = now;
      repStateRef.current.sawTop = false;
      repStateRef.current.sawBottom = false;
      finishRep(frame);
    }
  };

  const drawSkeleton = (landmarks: PosePoint[] | null | undefined) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;
    if (!ctx || !video || !landmarks?.length) {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
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
      setDemoMode(false);
      setSessionStartedAt((current) => current ?? nowIso());
      pushLog('system', `Camera started (${cameraFacing}).`);
      const loop = async () => {
        if (!runningRef.current || !poseRef.current || !videoRef.current) return;
        const videoEl = videoRef.current;
        if (videoEl.readyState >= 2) {
          const result = poseRef.current.detectForVideo(videoEl, performance.now());
          const landmarks = result.landmarks[0] as PosePoint[] | undefined;
          drawSkeleton(modeAllowsVisuals ? landmarks : null);
          const frame = analyzePose(landmarks, cameraView);
          processAnalysis(frame);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (error) {
      console.error(error);
      setCameraStatus('error');
      setCameraError('Camera access failed. Grant permission or use demo mode.');
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
  };

  const startDemoLoop = () => {
    stopCamera();
    resetCalibrationFlow();
    void unlockSound();
    setCameraStatus('live');
    setSessionStartedAt((current) => current ?? nowIso());
    pushLog('system', 'Demo mode running.');
    runningRef.current = true;
    const loop = () => {
      if (!runningRef.current) return;
      frameCounterRef.current += 1;
      const landmarks = createDemoPose(frameCounterRef.current, cameraView);
      drawSkeleton(modeAllowsVisuals ? landmarks : null);
      const frame = analyzePose(landmarks, cameraView);
      processAnalysis(frame);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopSession = () => {
    stopCamera();
    runningRef.current = false;
    setSessionStopped(true);
    setCameraStatus('idle');
    pushLog('system', 'Session stopped.');
    if (sessionReps.length > 0) {
      const summary: SessionSummary = {
        id: `${Date.now()}`,
        name: athleteName.trim() || 'Anonymous',
        dateIso: nowIso(),
        reps,
        averageScore: currentSummary.averageScore,
        bestScore: currentSummary.bestScore,
        beforeScore: beforeAfter.before,
        afterScore: beforeAfter.after,
        notes: [...new Set(sessionReps.flatMap((rep) => rep.notes))].slice(0, 8),
      };
      downloadTextFile(`pushup-session-${summary.id}.json`, exportSessionJson(summary, sessionReps, sessionLogs, history), 'application/json');
      downloadTextFile(`pushup-session-${summary.id}.csv`, buildCsv(summary, sessionReps, sessionLogs), 'text/csv');
    }
  };

  const resetSet = () => {
    stopCamera();
    setSessionReps([]);
    setSessionLogs([]);
    setReps(0);
    setAnalysis(null);
    setCurrentCue('');
    setSessionStartedAt(null);
    setSessionStopped(false);
    setAudioUnlocked(false);
    setCurrentCue('');
    repAccumulatorRef.current = createEmptyRepAccumulator();
    repStateRef.current = { sawTop: false, sawBottom: false, lastRepAt: 0 };
    frameCounterRef.current = 0;
    pushLog('system', 'Set reset.');
  };

  const saveCurrentSession = () => {
    if (!sessionReps.length && !analysis) return;
    const summary: SessionEntry = {
      id: `${Date.now()}`,
      name: athleteName.trim() || 'Anonymous',
      createdAt: sessionStartedAt ?? nowIso(),
      reps,
      averageScore: currentSummary.averageScore,
      bestScore: currentSummary.bestScore,
      beforeScore: beforeAfter.before,
      afterScore: beforeAfter.after,
      mode: feedbackMode,
      cameraFacing,
      cameraView,
      demoMode,
      notes: [...new Set(sessionReps.flatMap((rep) => rep.notes))].slice(0, 8),
    };
    const nextHistory = [summary, ...history].slice(0, 25);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
    setBaselineScore(summary.afterScore);
    pushLog('system', 'Session saved locally.');
  };

  const exportCsv = () => {
    if (!sessionReps.length && !analysis) return;
    const summary: SessionSummary = {
      id: `${Date.now()}`,
      name: athleteName.trim() || 'Anonymous',
      dateIso: sessionStartedAt ?? nowIso(),
      reps,
      averageScore: currentSummary.averageScore,
      bestScore: currentSummary.bestScore,
      beforeScore: beforeAfter.before,
      afterScore: beforeAfter.after,
      notes: [...new Set(sessionReps.flatMap((rep) => rep.notes))].slice(0, 8),
    };
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
          setCameraError('Pose model failed to load. Switch to demo mode or try again.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [secureContext]);

  useEffect(() => {
    if (demoMode) {
      startDemoLoop();
      return stopCamera;
    }
    if (cameraStatus === 'live') {
      startCamera();
    }
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, cameraFacing, cameraView]);

  useEffect(() => {
    if (!sessionStopped || !analysis) return;
    if (sessionReps.length === 0) return;
    const summary: SessionEntry = {
      id: `${Date.now()}`,
      name: athleteName.trim() || 'Anonymous',
      createdAt: nowIso(),
      reps,
      averageScore: currentSummary.averageScore,
      bestScore: currentSummary.bestScore,
      beforeScore: beforeAfter.before,
      afterScore: beforeAfter.after,
      mode: feedbackMode,
      cameraFacing,
      cameraView,
      demoMode,
      notes: [...new Set(sessionReps.flatMap((rep) => rep.notes))].slice(0, 8),
    };
    const nextHistory = [summary, ...history].slice(0, 25);
    setHistory(nextHistory);
    saveHistory(SESSION_STORAGE_KEY, nextHistory);
    setBaselineScore(summary.afterScore);
    setSessionStopped(false);
  }, [analysis, athleteName, beforeAfter.after, beforeAfter.before, cameraFacing, cameraView, currentSummary.averageScore, currentSummary.bestScore, demoMode, feedbackMode, history, reps, sessionReps, sessionStopped]);

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
            <p className="eyebrow">Science-fair push-up form coach</p>
            <h1>On-device coaching for cleaner reps.</h1>
          </div>
          <div className="pill">{secureContext ? 'secure context ready' : 'needs HTTPS'}</div>
        </div>
        <p className="lede">Rep counting, explainable scoring, and local history all run in the browser so the phone camera never leaves the device.</p>
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
              <span>{demoMode ? 'demo' : 'camera'}</span>
              <span>{cameraView}</span>
              <span>{feedbackMode}</span>
            </div>
            <div className="calibration-overlay">
              <span className={calibrationState === 'countdown' || calibrationState === 'counting' ? 'calibration-overlay__badge calibration-overlay__badge--ready' : 'calibration-overlay__badge'}>
                {calibrationStatusText}
              </span>
              <span className="calibration-overlay__meter">{`${Math.round(calibrationConfidence)}% confidence`}</span>
            </div>
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

            <div className="action-row">
              <button className="button button--primary" onClick={startCamera} disabled={!poseReady || !secureContext}>
                Start camera
              </button>
              <button className="button" onClick={stopSession} disabled={cameraStatus === 'idle' && !sessionReps.length}>
                Stop & export
              </button>
              <button className="button" onClick={() => setDemoMode((value) => !value)}>
                {demoMode ? 'Exit demo' : 'Demo mode'}
              </button>
              <button className="button" onClick={resetSet}>
                Try again
              </button>
            </div>

            <div className="action-row secondary">
              <button className="button" onClick={saveCurrentSession} disabled={!sessionReps.length && !analysis}>
                Save local score
              </button>
              <button className="button" onClick={exportCsv} disabled={!sessionReps.length && !analysis}>
                Export CSV
              </button>
              {modeAllowsAudio && !audioUnlocked ? (
                <button className="button button--primary" onClick={() => void unlockSound()}>
                  Enable sound
                </button>
              ) : null}
            </div>
            {modeAllowsAudio && !audioUnlocked ? <p className="setup-copy">iPhone Safari may need one tap to unlock audio cues.</p> : null}
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

                <div className="metrics">
                  {metricDefinitions.map((metric) => (
                    <Metric key={metric.label} label={metric.label} value={metric.value} />
                  ))}
                </div>
                <p className="metric-copy">
                  {cameraView === 'head-on'
                    ? 'Head-on view emphasizes elbow depth, elbow flare, hand stack, head alignment, and clear framing. Hip sag/pike is intentionally softened here.'
                    : 'Side view keeps the classic hip sag / hip pike body-line cues, but it needs more room and a wider setup.'}
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
                  <div>
                    <span className="muted">Audio</span>
                    <strong>{modeAllowsAudio ? (audioUnlocked ? 'unlocked' : 'locked') : 'off'}</strong>
                  </div>
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
                    modeAllowsAudio ? (audioUnlocked ? 'Sound is unlocked and ready.' : 'Tap Enable sound once before the first audio cue on iPhone Safari.') : 'No visual coaching in Control mode.',
                    cameraView === 'head-on' ? 'Head-on is the recommended mobile demo.' : 'Side view is optional and needs a wider tripod setup.',
                  ]).slice(0, 3).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </article>

          <article className="card history-card">
            <div className="card-head">
              <h2>Local score history</h2>
              <span>Saved in this browser</span>
            </div>
            <div className="history-list">
              {history.length === 0 ? (
                <p className="muted">No saved sessions yet.</p>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="history-item">
                    <div>
                      <strong>{entry.name}</strong>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div>
                      <strong>{entry.reps} reps</strong>
                      <span>{entry.afterScore} / 100 · {entry.cameraView}</span>
                    </div>
                  </div>
                ))
              )}
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

          <article className="card notes-card">
            <div className="card-head">
              <h2>Science-fair notes</h2>
            </div>
            <ul className="notes">
              <li>All pose analysis runs on-device in the browser.</li>
              <li>Feedback modes are logged continuously so every coaching cue is auditable.</li>
              <li>Use Head-on for the phone demo: put the phone low and in front so wrists and feet stay visible. Side view is optional for a wider tripod setup.</li>
              <li>Export the session as JSON or CSV for science-fair charts and comparisons.</li>
            </ul>
          </article>
        </div>
      </section>

      {!secureContext ? <div className="banner">Camera access is blocked until the app is served over HTTPS or localhost.</div> : null}
      {cameraError ? <div className="banner banner--warn">{cameraError}</div> : null}
      {!poseReady ? <div className="banner">Loading pose model...</div> : null}
    </main>
  );
}

import { CameraViewMode, FeedbackMode, LogEntry, SessionRep, SessionSummary } from './types';

export interface NotesExportSummary {
  name: string;
  dateIso: string;
  mode: FeedbackMode;
  cameraView: CameraViewMode;
  spokenCoachingEnabled: boolean;
  /** tempoCuesLabel(): which sets had the Up/Down tempo cues. */
  tempoCues?: string;
  reps: number;
  averageScore: number;
  bestScore: number;
  beforeScore: number;
  afterScore: number;
  notes: string[];
}

type ThemeBucket = {
  label: string;
  cue: string;
  patterns: RegExp[];
};

const THEME_BUCKETS: ThemeBucket[] = [
  {
    label: 'Setup / framing',
    cue: 'Keep hands, torso, and head in frame.',
    patterns: [/move back/i, /hands?/i, /torso/i, /head/i, /shoulders?/i, /frame/i, /setup/i],
  },
  {
    label: 'Depth',
    cue: 'Go a little deeper while keeping hips level.',
    patterns: [/deeper/i, /depth/i, /lower/i],
  },
  {
    label: 'Elbow flare',
    cue: 'Tuck the elbows in.',
    patterns: [/elbow/i, /flare/i, /tuck/i],
  },
  {
    label: 'Hands stacked',
    cue: 'Hands under shoulders.',
    patterns: [/hand/i, /stack/i, /shoulder/i],
  },
  {
    label: 'Head alignment',
    cue: 'Keep the head centered.',
    patterns: [/head/i, /center/i, /alignment/i],
  },
  {
    label: 'Hip line',
    cue: 'Don’t pike or sag — hold one straight plank line.',
    patterns: [/\bsag/i, /\bpik(e|ing)/i, /body line/i, /plank/i],
  },
];

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTextFile(filename: string, content: string, type: string) {
  downloadBlob(filename, new Blob([content], { type }));
}

export function exportSessionJson(summary: SessionSummary, reps: SessionRep[], logs: LogEntry[], history: unknown[]) {
  return JSON.stringify({ summary, reps, logs, history }, null, 2);
}

export function buildCsv(summary: SessionSummary, reps: SessionRep[], logs: LogEntry[]) {
  const lines = [
    ['session_name', 'date', 'reps', 'average_score', 'best_score', 'before_score', 'after_score', 'note_count'].join(','),
    [
      summary.name,
      summary.dateIso,
      summary.reps,
      summary.averageScore,
      summary.bestScore,
      summary.beforeScore,
      summary.afterScore,
      summary.notes.length,
    ].join(','),
    '',
    ['rep_index', 'view_mode', 'score', 'elbow_depth', 'body_line', 'elbow_flare', 'hip_sag', 'hip_pike', 'hand_stack', 'head_alignment', 'framing', 'confidence', 'notes', 'set', 'plank_method', 'plank_raw', 'elbow_abduction_deg', 'tempo_cues'].join(','),
    ...[...reps].sort((a, b) => a.index - b.index).map((rep) => [
      rep.index,
      rep.viewMode,
      rep.score,
      rep.elbowDepthScore,
      rep.bodyLineScore ?? 'n/a',
      rep.elbowFlareScore,
      rep.hipSagScore ?? '',
      rep.hipPikeScore ?? '',
      rep.handStackScore,
      rep.headAlignmentScore,
      rep.framingScore,
      rep.confidence,
      rep.notes.join(' | ').replaceAll(',', ';'),
      rep.attempt ?? '',
      rep.plankMethod ?? 'n/a',
      rep.plankRaw ?? '',
      rep.elbowAbduction ?? '',
      rep.tempoCues ? 'on' : 'off',
    ].join(',')),
    '',
    ['log_time', 'kind', 'message', 'details'].join(','),
    ...logs.map((log) => [
      new Date(log.at).toISOString(),
      log.kind,
      log.message.replaceAll(',', ';'),
      (log.details ?? '').replaceAll(',', ';'),
    ].join(',')),
  ];
  return lines.join('\n');
}

function collectThemeBuckets(notes: string[]) {
  return THEME_BUCKETS.map((bucket) => {
    const count = notes.reduce((total, note) => total + (bucket.patterns.some((pattern) => pattern.test(note)) ? 1 : 0), 0);
    return {
      label: bucket.label,
      cue: bucket.cue,
      count,
    };
  })
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** "set2" → "on for set 2", "set1+set2" → "on for set 1 and set 2". */
export function tempoCuesText(label: string) {
  if (label === 'off' || label === 'on') return label;
  return `on for ${label.replace(/set(\d)/g, 'set $1').replace('+', ' and ')}`;
}

export function buildNotesExport(summary: NotesExportSummary, reps: SessionRep[]) {
  const themes = collectThemeBuckets([...summary.notes, ...reps.flatMap((rep) => rep.notes)]).slice(0, 3);
  const dateLabel = new Date(summary.dateIso).toLocaleString();
  const delta = summary.afterScore - summary.beforeScore;
  const deltaLabel = delta === 0 ? 'No change' : delta > 0 ? `+${delta}` : `${delta}`;
  const topThemes = themes.length
    ? themes.map((theme, index) => `${index + 1}. ${theme.label} - ${theme.cue} (${theme.count} cue${theme.count === 1 ? '' : 's'})`)
    : ['1. No repeated themes yet - the set stayed balanced or too short for pattern repeats.'];

  return [
    '# Push-up session notes',
    '',
    `Athlete: ${summary.name}`,
    `Date: ${dateLabel}`,
    `Mode: ${summary.mode}`,
    `View: ${summary.cameraView}`,
    `Spoken coaching: ${summary.spokenCoachingEnabled ? 'on' : 'off'}`,
    ...(summary.tempoCues ? [`Up/Down tempo cues: ${tempoCuesText(summary.tempoCues)}`] : []),
    `Total reps: ${summary.reps}`,
    `Average score: ${summary.averageScore}/100`,
    `Best score: ${summary.bestScore}/100`,
    `Before / after: ${summary.beforeScore}/100 -> ${summary.afterScore}/100 (${deltaLabel})`,
    'Score breakdown: Depth + body line + elbows.',
    '',
    'Top coaching themes:',
    ...topThemes.map((line) => `- ${line}`),
    '',
    'Short set summary:',
    `- ${summary.reps} ${summary.reps === 1 ? 'rep' : 'reps'} completed at an average of ${summary.averageScore}/100.`,
    `- The main coaching focus stayed on ${themes[0]?.label ?? 'clean, consistent reps'}.`,
    '- Use the simple notes export for docs, and CSV/JSON only when you want research detail.',
  ].join('\n');
}

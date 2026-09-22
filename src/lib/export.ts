import { LogEntry, SessionRep, SessionSummary } from './types';

export function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
    ['rep_index', 'score', 'elbow_depth', 'hip_sag', 'hip_pike', 'hand_stack', 'confidence', 'notes'].join(','),
    ...reps.map((rep) => [
      rep.index,
      rep.score,
      rep.elbowDepthScore,
      rep.hipSagScore,
      rep.hipPikeScore,
      rep.handStackScore,
      rep.confidence,
      rep.notes.join(' | ').replaceAll(',', ';'),
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

import type { SessionEntry } from '../lib/types';
import { Sheet } from './Sheet';

interface HistorySheetProps {
  open: boolean;
  onClose: () => void;
  history: SessionEntry[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function HistorySheet({ open, onClose, history, onDelete, onClearAll }: HistorySheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="History" subtitle="Saved on this device only">
      {history.length === 0 ? (
        <div className="empty-state">
          <strong>No saved sessions yet</strong>
          <p>After a set, tap “Save to this device” on the results screen.</p>
        </div>
      ) : (
        <>
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id}>
                <details className="history-item">
                  <summary>
                    <div className="history-item__who">
                      <strong>{entry.name}</strong>
                      <span>{new Date(entry.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <div className="history-item__score">
                      <strong>{entry.afterScore}</strong>
                      <span>{entry.reps} reps</span>
                    </div>
                  </summary>
                  <div className="history-item__body">
                    <p className="fine-print">{entry.cameraView} view · {entry.mode} mode · best {entry.bestScore}</p>
                    {entry.notes.length ? (
                      <ul className="bullet-list">
                        {entry.notes.map((note, index) => (
                          <li key={`${entry.id}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                    <button className="btn btn--ghost btn--small" onClick={() => onDelete(entry.id)}>
                      Delete
                    </button>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <button
            className="btn btn--ghost btn--block"
            onClick={() => {
              if (window.confirm('Delete all saved sessions on this device?')) onClearAll();
            }}
          >
            Clear all
          </button>
        </>
      )}
    </Sheet>
  );
}

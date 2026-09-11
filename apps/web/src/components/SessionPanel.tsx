import { useState } from 'react';
import type { Task } from '@claudectrl/shared';
import { StatusDot } from './StatusDot';
import { api } from '../utils/api';

const statusLabels: Record<Task['status'], string> = {
  queued: 'Queued',
  working: 'Working',
  validating: 'Validating',
  ready_for_review: 'Review',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  paused: 'Paused',
};

interface Props {
  task: Task;
  repoId: string;
  output: string[];
  /** Tasks queued after this one in the same session */
  queuedTasks: Task[];
  onAddToQueue: (sessionRef: string, message: string) => void;
}

export function SessionPanel({ task, repoId, output, queuedTasks, onAddToQueue }: Props) {
  const [showLogs, setShowLogs] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [queueInput, setQueueInput] = useState('');
  const [showQueueInput, setShowQueueInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = ['working', 'validating', 'queued'].includes(task.status);
  const isReview = task.status === 'ready_for_review';
  const isFailed = task.status === 'failed';
  const isDone = task.status === 'done';
  const isPausedOrStopped = task.status === 'paused' || task.status === 'stopped';

  const liveStatus = task.lastResult?.split('\n')[0]?.slice(0, 100) ?? null;

  // Extract URLs from lastResult
  const urls = task.lastResult
    ? [...task.lastResult.matchAll(/https?:\/\/[^\s)>\]]+/g)].map(m => m[0])
    : [];

  const handleAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const handleSendInput = async () => {
    const msg = inputValue.trim();
    if (!msg) return;
    setInputValue('');
    await handleAction(() => api.repos.feedback(repoId, task.id, msg));
  };

  const handleQueueSubmit = () => {
    const msg = queueInput.trim();
    if (!msg || !task.sessionRef) return;
    setQueueInput('');
    setShowQueueInput(false);
    onAddToQueue(task.sessionRef, msg);
  };

  return (
    <div style={{
      borderRadius: 'var(--r-lg)',
      boxShadow: isActive
        ? '6px 6px 16px rgb(163 177 198 / 0.5), -4px -4px 12px rgba(255,255,255,0.5), inset 0 0 0 1px rgba(217,119,87,0.15)'
        : isFailed
          ? '6px 6px 16px rgb(163 177 198 / 0.5), -4px -4px 12px rgba(255,255,255,0.5), inset 0 0 0 1px rgba(224,82,82,0.2)'
          : 'var(--shadow-raised-sm)',
      background: 'var(--c-bg)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(163,177,198,0.15)',
      }}>
        <StatusDot status={task.status} size={7} pulse />
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: isFailed ? 'var(--c-failed)' : 'var(--c-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          flexShrink: 0,
        }}>
          {statusLabels[task.status]}
        </span>
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--c-fg)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {task.title}
        </span>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {isActive && (
            <>
              <ActionBtn label="⏸" title="Pause" onClick={() => handleAction(() => api.repos.pauseTask(repoId, task.id))} />
              <ActionBtn label="■" title="Stop" onClick={() => handleAction(() => api.repos.stopTask(repoId, task.id))} danger />
            </>
          )}
          {isReview && (
            <ActionBtn label="✓" title="Approve" onClick={() => handleAction(() => api.repos.approveTask(repoId, task.id))} accent />
          )}
          {isPausedOrStopped && (
            <ActionBtn label="▶" title="Resume" onClick={() => handleAction(() => api.repos.resumeTask(repoId, task.id))} accent />
          )}
          {(isFailed || isPausedOrStopped) && (
            <ActionBtn label="↺" title="Retry" onClick={() => handleAction(() => api.repos.retryTask(repoId, task.id))} />
          )}
          {(isDone || isFailed || isPausedOrStopped) && (
            <ActionBtn label="📦" title="Archive" onClick={() => handleAction(() => api.repos.archiveTask(repoId, task.id))} />
          )}
          <ActionBtn
            label={showLogs ? '▼' : '▶'}
            title="Toggle logs"
            onClick={() => setShowLogs(!showLogs)}
            active={showLogs}
          />
        </div>
      </div>

      {/* Body content */}
      <div style={{ padding: '0 14px', minHeight: 0 }}>
        {/* Live status when working */}
        {isActive && liveStatus && (
          <div style={{
            fontSize: 12,
            color: 'var(--c-subtle)',
            padding: '8px 0 4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {liveStatus}
          </div>
        )}

        {/* Error display */}
        {isFailed && task.lastResult && (
          <div style={{
            margin: '8px 0',
            padding: '8px 12px',
            borderRadius: 'var(--r-md)',
            background: 'var(--c-bg)',
            boxShadow: 'inset 3px 3px 6px rgb(163 177 198 / 0.3), inset -3px -3px 6px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(224,82,82,0.2)',
            fontSize: 12,
            color: 'var(--c-failed)',
            lineHeight: 1.5,
            maxHeight: 80,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {task.lastResult}
          </div>
        )}

        {/* Review: show last result + approve */}
        {isReview && task.lastResult && (
          <div style={{
            margin: '8px 0',
            padding: '8px 12px',
            borderRadius: 'var(--r-md)',
            background: 'var(--c-bg)',
            boxShadow: 'var(--shadow-inset-sm)',
            fontSize: 12,
            color: 'var(--c-fg)',
            lineHeight: 1.6,
            maxHeight: 120,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {task.lastResult}
          </div>
        )}

        {/* URL pills */}
        {urls.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 0' }}>
            {urls.slice(0, 5).map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 'var(--r-full)',
                  boxShadow: 'var(--shadow-raised-xs)',
                  background: 'var(--c-bg)',
                  color: 'var(--c-accent)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 200,
                }}
              >
                {new URL(url).hostname} ↗
              </a>
            ))}
          </div>
        )}

        {/* Queued tasks in this session */}
        {queuedTasks.length > 0 && (
          <div style={{ padding: '6px 0 2px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Queue ({queuedTasks.length})
            </div>
            {queuedTasks.map(qt => (
              <div key={qt.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 0', fontSize: 12, color: 'var(--c-muted)',
              }}>
                <StatusDot status={qt.status} size={5} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qt.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* Add to queue button */}
        {task.sessionRef && !isDone && !showQueueInput && (
          <button
            onClick={() => setShowQueueInput(true)}
            style={{
              fontSize: 11,
              color: 'var(--c-accent)',
              padding: '4px 0 8px',
              opacity: 0.8,
            }}
          >
            + Add to queue
          </button>
        )}

        {/* Queue input */}
        {showQueueInput && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 0 8px' }}>
            <input
              value={queueInput}
              onChange={(e) => setQueueInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQueueSubmit(); if (e.key === 'Escape') setShowQueueInput(false); }}
              placeholder="Queue a task..."
              autoFocus
              style={{
                flex: 1,
                fontSize: 12,
                padding: '6px 10px',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-inset-sm)',
                background: 'var(--c-bg)',
                color: 'var(--c-fg)',
              }}
            />
            <button
              onClick={handleQueueSubmit}
              style={{
                fontSize: 12, fontWeight: 600, padding: '4px 12px',
                borderRadius: 'var(--r-full)', background: 'var(--c-accent)', color: '#fff',
                boxShadow: 'var(--shadow-raised-xs)',
              }}
            >+</button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            padding: '6px 10px', margin: '4px 0',
            borderRadius: 'var(--r-md)',
            boxShadow: 'inset 0 0 0 1px rgba(224,82,82,0.3)',
            color: 'var(--c-failed)', fontSize: 11,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 14 }}>×</button>
          </div>
        )}
      </div>

      {/* Terminal drawer */}
      {showLogs && output.length > 0 && (
        <div style={{
          margin: '0 10px 10px',
          padding: '8px 10px',
          borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-inset-deep)',
          background: 'var(--c-bg)',
          maxHeight: 160,
          overflow: 'auto',
        }}>
          <pre style={{
            fontFamily: 'var(--mono)', fontSize: 10,
            color: 'var(--c-muted)', whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', lineHeight: 1.5, margin: 0,
          }}>
            {output.slice(-100).join('\n')}
          </pre>
        </div>
      )}

      {/* Inline input for feedback (review or active) */}
      {(isReview || isActive) && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '8px 14px 12px',
          borderTop: '1px solid rgba(163,177,198,0.12)',
        }}>
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSendInput(); }}
            placeholder={isReview ? 'Give feedback...' : 'Message Claude...'}
            style={{
              flex: 1,
              fontSize: 12,
              padding: '7px 12px',
              borderRadius: 'var(--r-full)',
              boxShadow: 'var(--shadow-inset-sm)',
              background: 'var(--c-bg)',
              color: 'var(--c-fg)',
            }}
          />
          <button
            onClick={handleSendInput}
            disabled={!inputValue.trim()}
            style={{
              width: 30, height: 30,
              borderRadius: '50%',
              fontSize: 12,
              background: inputValue.trim() ? 'var(--c-accent)' : 'var(--c-bg)',
              color: inputValue.trim() ? '#fff' : 'var(--c-subtle)',
              boxShadow: inputValue.trim() ? 'var(--shadow-raised-xs)' : 'var(--shadow-raised-xs)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >↑</button>
        </div>
      )}
    </div>
  );
}

// Small inline action button
function ActionBtn({ label, title, onClick, danger, accent, active }: {
  label: string; title: string; onClick: () => void;
  danger?: boolean; accent?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26, height: 26,
        borderRadius: 'var(--r-full)',
        fontSize: 11,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent ? 'var(--c-accent)' : danger ? 'var(--c-failed)' : active ? 'var(--c-accent)' : 'var(--c-muted)',
        boxShadow: active ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
        background: accent ? 'var(--c-bg)' : 'var(--c-bg)',
        transition: 'box-shadow 0.2s, color 0.2s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = active ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)';
        e.currentTarget.style.transform = '';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
        e.currentTarget.style.transform = 'translateY(1px)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
        e.currentTarget.style.transform = '';
      }}
    >
      {label}
    </button>
  );
}

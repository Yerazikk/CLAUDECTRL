import { useState, useEffect, useRef } from 'react';
import type { Task, TranscriptEntry } from '@claudectrl/shared';
import { formatDuration, formatTokens, formatClock, toolText, sessionStats, liveAction, fullText } from '../utils/transcript';
import { StatusDot } from './StatusDot';
import { api } from '../utils/api';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { MicToggleButton } from './MicToggleButton';

const statusLabels: Record<Task['status'], string> = {
  queued: 'Queued',
  working: 'Working',
  validating: 'Validating',
  ready_for_review: 'Review',
  committing: 'Committing',
  merging: 'Merging',
  resolving_conflict: 'Fixing conflict',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  paused: 'Paused',
};

interface Props {
  task: Task;
  repoId: string;
  /** The session's transcript, oldest first */
  entries: TranscriptEntry[];
  queuedTasks: Task[];
  onAddToQueue: (sessionRef: string, message: string) => void;
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (dir: 'right' | 'bottom' | 'corner') => (e: React.MouseEvent) => void;
}

export function SessionPanel({
  task, repoId, entries,
  queuedTasks, onAddToQueue,
  onDragHandleMouseDown, onResizeMouseDown,
}: Props) {
  const inputKey = `session-input:${task.id}`;
  const [inputValue, setInputValue] = useState(() => localStorage.getItem(inputKey) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const { isListening, toggle: toggleListening, hasSupport: hasSpeechSupport } = useSpeechToText((finalizedText) => {
    // Append below/after whatever is already typed — never overwrite it.
    setInputValue((prev) => {
      const trimmedPrev = prev.replace(/\s+$/, '');
      const next = trimmedPrev ? `${trimmedPrev} ${finalizedText}` : finalizedText;
      localStorage.setItem(inputKey, next);
      return next;
    });
  });

  const isActive = ['working', 'validating', 'queued', 'committing', 'merging', 'resolving_conflict'].includes(task.status);
  const isPauseable = ['working', 'validating', 'queued'].includes(task.status);
  const isReview = task.status === 'ready_for_review';
  const isFailed = task.status === 'failed';
  const isDone = task.status === 'done';
  const isPausedOrStopped = task.status === 'paused' || task.status === 'stopped';

  // Follow the feed while it's running, unless the user has scrolled up to read
  useEffect(() => {
    const el = feedRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const handleAction = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  /**
   * Sending behaves like the Claude CLI: your message goes in now, interrupting
   * whatever Claude is mid-way through. `/queue <message>` puts it behind the
   * current work instead, and `/clear` wipes the session's context.
   */
  const handleSend = async () => {
    const raw = inputValue.trim();
    if (!raw) return;

    const queued = raw.match(/^\/queue\s+([\s\S]+)$/i);
    if (queued && !task.sessionRef) {
      setError('This session has no queue yet — send it normally.');
      return;
    }

    setInputValue('');
    localStorage.removeItem(inputKey);

    if (queued) {
      onAddToQueue(task.sessionRef!, queued[1].trim());
    } else if (/^\/clear\s*$/i.test(raw)) {
      await handleAction(() => api.repos.clearSession(repoId, task.id));
    } else {
      await handleAction(() => api.repos.interrupt(repoId, task.id, raw));
    }
  };

  const handleRetry = async () => {
    await handleAction(() => api.repos.retryTask(repoId, task.id));
  };

  const handleEditTask = async (taskId: string) => {
    const msg = editValue.trim();
    if (!msg) return;
    setEditingTaskId(null);
    await handleAction(() => api.repos.editTask(repoId, taskId, msg));
  };

  const stats = sessionStats(entries);
  const action = isActive ? liveAction(entries) : '';
  const duration = stats.durationMs
    ? formatDuration(stats.durationMs)
    : (task.startedAt && task.completedAt)
      ? formatDuration(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime())
      : '';

  // Sessions that predate the transcript (or were cleared) still show their result
  const hasFeed = entries.length > 0;
  const transcriptText = fullText(entries) || task.lastResult || '';

  const inputPlaceholder = isReview
    ? 'Reply, or approve above — /queue to queue'
    : isFailed
      ? 'Tell Claude what to fix — /queue to queue'
      : isActive
        ? 'Message — sends now, /queue to wait'
        : 'Message — /queue to queue';

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
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
      <div
        onMouseDown={onDragHandleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid rgba(163,177,198,0.15)',
          cursor: onDragHandleMouseDown ? 'grab' : 'default',
          flexShrink: 0,
          userSelect: 'none',
        }}>
        <StatusDot status={task.status} size={7} pulse />
        <span style={{
          fontSize: 11, fontWeight: 600, flexShrink: 0,
          color: isFailed ? 'var(--c-failed)' : 'var(--c-muted)',
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {statusLabels[task.status]}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--c-fg)',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.title}
        </span>

        {!task.useWorktree && (
          <span
            title="Working directly in the repo checkout — no worktree"
            style={{
              fontSize: 9, fontWeight: 600, letterSpacing: 0.5, flexShrink: 0,
              padding: '2px 6px', borderRadius: 'var(--r-full)',
              background: 'rgba(163,177,198,0.15)', color: 'var(--c-subtle)',
              fontFamily: 'var(--mono)', textTransform: 'uppercase',
            }}>
            in-repo
          </span>
        )}

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {isPauseable && (
            <>
              <ActionBtn label={'⏸'} title="Pause" onClick={() => handleAction(() => api.repos.pauseTask(repoId, task.id))} />
              <ActionBtn label={'■'} title="Stop" onClick={() => handleAction(() => api.repos.stopTask(repoId, task.id))} danger />
            </>
          )}
          {isReview && (
            <ActionBtn label="Approve" title="Approve" onClick={() => handleAction(() => api.repos.approveTask(repoId, task.id))} accent wide />
          )}
          {isPausedOrStopped && (
            <ActionBtn label={'▶'} title="Resume" onClick={() => handleAction(() => api.repos.resumeTask(repoId, task.id))} accent />
          )}
          {(isFailed || isPausedOrStopped) && (
            <ActionBtn label={'↺'} title="Retry" onClick={handleRetry} />
          )}
          {!isActive && (hasFeed || task.sessionId) && (
            <ActionBtn
              label="Clear"
              title="Run /clear on this Claude session and empty this card"
              onClick={() => handleAction(() => api.repos.clearSession(repoId, task.id))}
            />
          )}
          {(isDone || isFailed || isPausedOrStopped) && (
            <ActionBtn label={'📦'} title="Archive" onClick={() => handleAction(() => api.repos.archiveTask(repoId, task.id))} />
          )}
        </div>
      </div>

      {/* Totals across every request in this session + what it's doing now */}
      {(action || stats.tokens > 0 || stats.files > 0 || duration) && (
        <div style={{
          padding: '5px 14px',
          borderBottom: '1px solid rgba(163,177,198,0.08)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {action && (
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--c-accent)', flexShrink: 0,
                animation: 'pulse 2s ease-in-out infinite',
                display: 'inline-block',
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                {action}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)', flexWrap: 'wrap', alignItems: 'center' }}>
            {stats.tokens > 0 && <StatChip>{formatTokens(stats.tokens)} tokens</StatChip>}
            {stats.files > 0 && <StatChip>{stats.files} file{stats.files !== 1 ? 's' : ''}</StatChip>}
            {stats.lines > 0 && <StatChip>{stats.lines} lines</StatChip>}
            {duration && <StatChip>{duration}</StatChip>}
          </div>
        </div>
      )}

      {/* The transcript — Claude's words, plus one line per collapsed tool activity */}
      <div
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>

        {/* Nothing recorded (a session from before transcripts, or just cleared) */}
        {!hasFeed && <UserBubble text={task.title} />}
        {!hasFeed && task.lastResult && (
          <AssistantBubble text={task.lastResult} onClick={() => setExpandedText(task.lastResult!)} />
        )}

        {entries.map((entry) => {
          switch (entry.kind) {
            case 'user':
              return <UserBubble key={entry.seq} text={entry.text ?? ''} />;

            case 'text':
              return (
                <AssistantBubble
                  key={entry.seq}
                  text={entry.text ?? ''}
                  onClick={() => setExpandedText(transcriptText)}
                />
              );

            case 'tool':
              return <ToolLine key={entry.seq} entry={entry} />;

            case 'turn':
              return <TurnFooter key={entry.seq} entry={entry} />;

            case 'notice':
              return (
                <div key={entry.seq} style={{
                  fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)',
                  textAlign: 'center', padding: '4px 0', letterSpacing: 0.3,
                }}>
                  {entry.text}
                </div>
              );

            case 'error':
              return (
                <div
                  key={entry.seq}
                  onClick={() => setExpandedText(entry.text ?? '')}
                  title="Click to expand"
                  style={{
                    padding: '8px 12px', borderRadius: 'var(--r-md)',
                    boxShadow: 'inset 3px 3px 6px rgb(163 177 198 / 0.3), inset -3px -3px 6px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(224,82,82,0.2)',
                    fontSize: 12, color: 'var(--c-failed)', lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden',
                    maxHeight: 96, cursor: 'pointer',
                  }}>
                  {entry.text}
                </div>
              );

            default:
              return null;
          }
        })}

        {/* URL pills from the latest result */}
        {task.lastResult && (() => {
          const urls = [...task.lastResult.matchAll(/https?:\/\/[^\s)>\]]+/g)].map(m => m[0]);
          return urls.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {urls.slice(0, 5).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 'var(--r-full)',
                  boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
                  color: 'var(--c-accent)', textDecoration: 'none',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200,
                }}>
                  {new URL(url).hostname} {'↗'}
                </a>
              ))}
            </div>
          ) : null;
        })()}

        {/* Queued tasks — visible so the queue can be managed */}
        {queuedTasks.length > 0 && (
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-subtle)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
              Up next ({queuedTasks.length})
            </div>
            {queuedTasks.map((qt, idx) => (
              <div key={qt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12, color: 'var(--c-muted)' }}>
                <span style={{ fontSize: 10, color: 'var(--c-subtle)', fontWeight: 600, width: 14, textAlign: 'center', flexShrink: 0 }}>
                  {idx + 1}
                </span>
                <StatusDot status={qt.status} size={5} />
                {editingTaskId === qt.id ? (
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleEditTask(qt.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditTask(qt.id);
                      if (e.key === 'Escape') setEditingTaskId(null);
                    }}
                    autoFocus
                    style={{
                      flex: 1, fontSize: 12, padding: '3px 6px',
                      borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-inset-sm)',
                      background: 'var(--c-bg)', color: 'var(--c-fg)', minWidth: 0,
                    }}
                  />
                ) : (
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, cursor: 'pointer' }}
                    onClick={() => { setEditingTaskId(qt.id); setEditValue(qt.title); }}
                  >
                    {qt.title}
                  </span>
                )}
                <button
                  onClick={() => handleAction(() => api.repos.deleteTask(repoId, qt.id))}
                  style={{
                    fontSize: 14, color: 'var(--c-subtle)', flexShrink: 0,
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-full)',
                  }}
                  title="Remove"
                >
                  {'×'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            padding: '6px 10px', borderRadius: 'var(--r-md)',
            boxShadow: 'inset 0 0 0 1px rgba(224,82,82,0.3)',
            color: 'var(--c-failed)', fontSize: 11,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 14 }}>{'×'}</button>
          </div>
        )}
      </div>

      {/* Single smart input */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 14px 12px',
        borderTop: '1px solid rgba(163,177,198,0.12)',
        flexShrink: 0,
      }}>
        <input
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); localStorage.setItem(inputKey, e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder={isListening ? 'Listening...' : inputPlaceholder}
          style={{
            flex: 1, fontSize: 12, padding: '7px 12px',
            borderRadius: 'var(--r-full)', boxShadow: 'var(--shadow-inset-sm)',
            background: 'var(--c-bg)', color: 'var(--c-fg)',
          }}
        />
        {hasSpeechSupport && (
          <MicToggleButton isListening={isListening} onToggle={toggleListening} size={30} />
        )}
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || busy}
          title={isActive ? 'Send now (interrupts Claude)' : 'Send'}
          style={{
            width: 30, height: 30, borderRadius: '50%', fontSize: 12,
            background: inputValue.trim() && !busy ? 'var(--c-accent)' : 'var(--c-bg)',
            color: inputValue.trim() && !busy ? '#fff' : 'var(--c-subtle)',
            boxShadow: 'var(--shadow-raised-xs)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{'↑'}</button>
      </div>

      {/* Deep-dive modal — full, un-clipped text, click any bubble to open */}
      {expandedText && (
        <div
          onClick={() => setExpandedText(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--c-bg)', borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-raised-sm)',
              width: 'min(640px, 100%)', maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid rgba(163,177,198,0.15)', flexShrink: 0,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 600, color: 'var(--c-fg)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12,
              }}>
                {task.title}
              </span>
              <button
                onClick={() => setExpandedText(null)}
                style={{ fontSize: 18, color: 'var(--c-subtle)', flexShrink: 0, lineHeight: 1 }}
              >
                {'×'}
              </button>
            </div>
            <div style={{
              padding: '14px 16px', overflow: 'auto',
              fontSize: 13, color: 'var(--c-fg)', lineHeight: 1.7,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {expandedText}
            </div>
          </div>
        </div>
      )}

      {/* Resize handles */}
      {onResizeMouseDown && (
        <>
          <div onMouseDown={onResizeMouseDown('right')} style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'ew-resize', zIndex: 10 }} />
          <div onMouseDown={onResizeMouseDown('bottom')} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 6, cursor: 'ns-resize', zIndex: 10 }} />
          <div onMouseDown={onResizeMouseDown('corner')} style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, cursor: 'nwse-resize', zIndex: 11 }} />
        </>
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        maxWidth: '85%', padding: '6px 10px',
        borderRadius: '12px 12px 2px 12px',
        background: 'var(--c-accent)',
        color: '#fff', fontSize: 12, lineHeight: 1.5,
        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
      }}>
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text, onClick }: { text: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Click to expand' : undefined}
      style={{
        maxWidth: '92%',
        padding: '8px 12px',
        borderRadius: '2px 12px 12px 12px',
        boxShadow: 'var(--shadow-inset-sm)',
        background: 'var(--c-bg)',
        fontSize: 13, color: 'var(--c-fg)', lineHeight: 1.6,
        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        cursor: onClick ? 'pointer' : undefined,
      }}>
      {text}
    </div>
  );
}

/**
 * One collapsed tool activity, the way the CLI prints it — the file and how much
 * it changed, never the diff; "Bashing", never the command or its output.
 */
function ToolLine({ entry }: { entry: TranscriptEntry }) {
  return (
    <div style={{ paddingLeft: 2 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        fontSize: 11, color: 'var(--c-muted)', fontFamily: 'var(--mono)',
      }}>
        <span style={{ color: 'var(--c-accent)', flexShrink: 0, fontSize: 9, lineHeight: '14px' }}>{'●'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {toolText(entry)}
        </span>
      </div>
      {entry.detail && (
        <div style={{
          fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)',
          paddingLeft: 16, marginTop: 1,
        }}>
          {'└ '}{entry.detail}
        </div>
      )}
    </div>
  );
}

/** End of one Claude response: how long it took and what it cost. */
function TurnFooter({ entry }: { entry: TranscriptEntry }) {
  const bits = [
    entry.durationMs ? `Cogitated for ${formatDuration(entry.durationMs)}` : '',
    entry.tokens ? `${formatTokens(entry.tokens)} tokens` : '',
    entry.createdAt ? `done ${formatClock(entry.createdAt)}` : '',
  ].filter(Boolean);
  if (bits.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 6px',
      fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)',
    }}>
      <span style={{ flexShrink: 0 }}>{'✻'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {bits.join(' · ')}
      </span>
    </div>
  );
}

function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 'var(--r-full)',
      background: 'rgba(163,177,198,0.12)',
      fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)',
    }}>
      {children}
    </span>
  );
}

function ActionBtn({ label, title, onClick, danger, accent, active, wide }: {
  label: string; title: string; onClick: () => void;
  danger?: boolean; accent?: boolean; active?: boolean; wide?: boolean;
}) {
  const isText = label.length > 2;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: wide || isText ? 'auto' : 26, height: 26,
        padding: wide ? '0 14px' : isText ? '0 9px' : undefined,
        borderRadius: wide || isText ? 'var(--r-md)' : 'var(--r-full)',
        fontSize: wide ? 12 : isText ? 11 : 11,
        fontWeight: wide ? 600 : undefined,
        whiteSpace: 'nowrap',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: accent ? 'var(--c-accent)' : danger ? 'var(--c-failed)' : active ? 'var(--c-accent)' : 'var(--c-muted)',
        boxShadow: active ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
        background: 'var(--c-bg)',
        transition: 'box-shadow 0.2s, color 0.2s, transform 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = active ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
      onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; e.currentTarget.style.transform = 'translateY(1px)'; }}
      onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
    >
      {label}
    </button>
  );
}

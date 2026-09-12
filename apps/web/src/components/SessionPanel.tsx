import { useState } from 'react';
import type { Task } from '@claudectrl/shared';
import type { ParsedOutput, FileEdit } from '../utils/parseOutput';
import { formatDuration } from '../utils/parseOutput';
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
  parsed: ParsedOutput;
  queuedTasks: Task[];
  onAddToQueue: (sessionRef: string, message: string) => void;
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
  onResizeMouseDown?: (dir: 'right' | 'bottom' | 'corner') => (e: React.MouseEvent) => void;
}

export function SessionPanel({
  task, repoId, parsed,
  queuedTasks, onAddToQueue,
  onDragHandleMouseDown, onResizeMouseDown,
}: Props) {
  const inputKey = `session-input:${task.id}`;
  const sentMsgKey = `session-sent:${task.id}`;
  const [inputValue, setInputValue] = useState(() => localStorage.getItem(inputKey) ?? '');
  // User messages sent as feedback (right bubbles beyond the first task.title)
  const [sentMessages, setSentMessages] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(sentMsgKey) ?? '[]'); } catch { return []; }
  });
  const [error, setError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedText, setExpandedText] = useState<string | null>(null);

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

  const handleAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  // Feedback talks to Claude about *this* task directly (only makes sense
  // once it's stopped to ask you something: failed, or sitting in review).
  // Everything else queues behind whatever the session is already doing.
  const canGiveFeedback = isFailed || isReview;

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || !task.sessionRef) return;
    setInputValue('');
    localStorage.removeItem(inputKey);
    if (canGiveFeedback) {
      // Track immediately so the bubble appears right away
      const next = [...sentMessages, msg];
      setSentMessages(next);
      localStorage.setItem(sentMsgKey, JSON.stringify(next));
      await handleAction(() => api.repos.feedback(repoId, task.id, msg));
    } else {
      onAddToQueue(task.sessionRef, msg);
    }
  };

  const handleRetry = async () => {
    const msg = 'retry or continue';
    // Track immediately so the bubble appears right away, same as a typed message
    const next = [...sentMessages, msg];
    setSentMessages(next);
    localStorage.setItem(sentMsgKey, JSON.stringify(next));
    await handleAction(() => api.repos.retryTask(repoId, task.id));
  };

  const handleEditTask = async (taskId: string) => {
    const msg = editValue.trim();
    if (!msg) return;
    setEditingTaskId(null);
    await handleAction(() => api.repos.editTask(repoId, taskId, msg));
  };

  const handleDeleteQueuedTask = async (taskId: string) => {
    await handleAction(() => api.repos.deleteTask(repoId, taskId));
  };

  // Stats — one entry per Claude invocation (turn) in this session
  const turns = parsed.turns.filter(t => t.summary || t.filesEdited.length > 0 || t.durationMs > 0);
  const allFilesEdited = turns.flatMap(t => t.filesEdited);
  const uniqueFileCount = new Set(allFilesEdited.map(f => f.path)).size;
  const totalTokens = turns.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0);
  const totalLines = allFilesEdited.reduce((s, f) => s + f.linesAdded + f.linesRemoved, 0);
  const totalDurationMs = turns.reduce((s, t) => s + t.durationMs, 0);
  const duration = totalDurationMs
    ? formatDuration(totalDurationMs)
    : (task.startedAt && task.completedAt)
      ? formatDuration(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime())
      : '';

  // Everything Claude wrote this session, for the click-to-expand deep-dive view —
  // the inline bubbles only ever show one paragraph per turn.
  const fullTranscript = turns
    .map(t => t.fullText || t.summary)
    .filter(Boolean)
    .join('\n\n———\n\n') || task.lastResult || '';

  const inputPlaceholder = isReview
    ? 'Give feedback or approve above...'
    : isFailed
      ? 'Tell Claude what to fix...'
      : 'Queue next message...';

  const hasInput = !!task.sessionRef;

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

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {isPauseable && (
            <>
              <ActionBtn label={'\u23F8'} title="Pause" onClick={() => handleAction(() => api.repos.pauseTask(repoId, task.id))} />
              <ActionBtn label={'\u25A0'} title="Stop" onClick={() => handleAction(() => api.repos.stopTask(repoId, task.id))} danger />
            </>
          )}
          {isReview && (
            <ActionBtn label="Approve" title="Approve" onClick={() => handleAction(() => api.repos.approveTask(repoId, task.id))} accent wide />
          )}
          {isPausedOrStopped && (
            <ActionBtn label={'\u25B6'} title="Resume" onClick={() => handleAction(() => api.repos.resumeTask(repoId, task.id))} accent />
          )}
          {(isFailed || isPausedOrStopped) && (
            <ActionBtn label={'\u21BA'} title="Retry" onClick={handleRetry} />
          )}
          {(isDone || isFailed || isPausedOrStopped) && (
            <ActionBtn label={'\uD83D\uDCE6'} title="Archive" onClick={() => handleAction(() => api.repos.archiveTask(repoId, task.id))} />
          )}
        </div>
      </div>

      {/* Totals across every request in this session + current action */}
      {(parsed.currentAction || totalTokens > 0 || uniqueFileCount > 0 || duration) && (
        <div style={{
          padding: '5px 14px',
          borderBottom: '1px solid rgba(163,177,198,0.08)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {isActive && parsed.currentAction && (
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--c-accent)', flexShrink: 0,
                animation: 'pulse 2s ease-in-out infinite',
                display: 'inline-block',
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                {parsed.currentAction}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--c-subtle)', fontFamily: 'var(--mono)', flexWrap: 'wrap', alignItems: 'center' }}>
            {totalTokens > 0 && (
              <StatChip>{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tokens</StatChip>
            )}
            {uniqueFileCount > 0 && (
              <StatChip>{uniqueFileCount} file{uniqueFileCount !== 1 ? 's' : ''}</StatChip>
            )}
            {totalLines > 0 && (
              <StatChip>{totalLines} lines</StatChip>
            )}
            {duration && (
              <StatChip>{duration}</StatChip>
            )}
          </div>
        </div>
      )}

      {/* Scrollable chat / content area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>

        {/* First user message */}
        <UserBubble text={task.title} />

        {/* Interleaved assistant + user turns — each request gets its own closing
            statement, plus the tokens/time/files that request itself touched */}
        {Array.from({ length: Math.max(turns.length, sentMessages.length) }, (_, i) => {
          const turn = turns[i];
          const turnTokens = turn ? turn.inputTokens + turn.outputTokens : 0;
          const turnDuration = turn?.durationMs ? formatDuration(turn.durationMs) : '';
          return (
            <div key={i}>
              {turn?.summary && (
                <>
                  <AssistantBubble text={turn.summary} onClick={() => setExpandedText(fullTranscript)} />
                  {(turnTokens > 0 || turnDuration || turn.filesEdited.length > 0) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, paddingLeft: 2 }}>
                      {turnTokens > 0 && (
                        <StatChip>{turnTokens >= 1000 ? `${(turnTokens / 1000).toFixed(1)}k` : turnTokens} tokens</StatChip>
                      )}
                      {turnDuration && <StatChip>{turnDuration}</StatChip>}
                    </div>
                  )}
                  {turn.filesEdited.length > 0 && (
                    <div style={{ paddingLeft: 2, marginTop: 4 }}>
                      <FilesList files={turn.filesEdited} />
                    </div>
                  )}
                </>
              )}
              {sentMessages[i] && (
                <div style={{ marginTop: 8 }}>
                  <UserBubble text={sentMessages[i]} />
                </div>
              )}
            </div>
          );
        })}

        {/* Error display */}
        {isFailed && task.lastResult && (
          <div
            onClick={() => setExpandedText(fullTranscript)}
            title="Click to expand"
            style={{
              padding: '8px 12px', borderRadius: 'var(--r-md)',
              boxShadow: 'inset 3px 3px 6px rgb(163 177 198 / 0.3), inset -3px -3px 6px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(224,82,82,0.2)',
              fontSize: 12, color: 'var(--c-failed)', lineHeight: 1.5,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto', maxHeight: 120,
              cursor: 'pointer',
            }}>
            {task.lastResult}
          </div>
        )}

        {/* Review/Done last result fallback */}
        {(isReview || isDone) && turns.length === 0 && task.lastResult && (
          <div
            onClick={() => setExpandedText(fullTranscript)}
            title="Click to expand"
            style={{
              padding: '8px 12px', borderRadius: '2px 12px 12px 12px',
              boxShadow: 'var(--shadow-inset-sm)', background: 'var(--c-bg)',
              fontSize: 12, color: 'var(--c-fg)', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 180,
              cursor: 'pointer',
            }}>
            {task.lastResult}
          </div>
        )}

        {/* URL pills */}
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
                  {new URL(url).hostname} {'\u2197'}
                </a>
              ))}
            </div>
          ) : null;
        })()}

        {/* Queued tasks — visible so user can manage the queue */}
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
                  onClick={() => handleDeleteQueuedTask(qt.id)}
                  style={{
                    fontSize: 14, color: 'var(--c-subtle)', flexShrink: 0,
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--r-full)',
                  }}
                  title="Remove"
                >
                  {'\u00D7'}
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
            <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 14 }}>{'\u00D7'}</button>
          </div>
        )}
      </div>

      {/* Single smart input */}
      {hasInput && (
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
            disabled={!inputValue.trim()}
            style={{
              width: 30, height: 30, borderRadius: '50%', fontSize: 12,
              background: inputValue.trim() ? 'var(--c-accent)' : 'var(--c-bg)',
              color: inputValue.trim() ? '#fff' : 'var(--c-subtle)',
              boxShadow: 'var(--shadow-raised-xs)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{'\u2191'}</button>
        </div>
      )}

      {/* Deep-dive modal — full, un-clipped transcript text, click any bubble to open */}
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
        wordBreak: 'break-word',
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
        wordBreak: 'break-word',
        cursor: onClick ? 'pointer' : undefined,
      }}>
      {text}
    </div>
  );
}

function FilesList({ files }: { files: FileEdit[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {files.map((f, i) => {
        const name = f.path.replace(/\\/g, '/').split('/').pop() || f.path;
        const counts: string[] = [];
        if (f.linesAdded) counts.push(`+${f.linesAdded}`);
        if (f.linesRemoved) counts.push(`-${f.linesRemoved}`);
        return (
          <div key={i} style={{ fontSize: 11, color: 'var(--c-muted)', fontFamily: 'var(--mono)', display: 'flex', gap: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
            {counts.length > 0 && <span style={{ color: 'var(--c-subtle)', flexShrink: 0 }}>({counts.join('/')})</span>}
          </div>
        );
      })}
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
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: wide ? 'auto' : 26, height: 26,
        padding: wide ? '0 14px' : undefined,
        borderRadius: wide ? 'var(--r-md)' : 'var(--r-full)',
        fontSize: wide ? 12 : 11,
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

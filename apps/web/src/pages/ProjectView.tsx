import { useState, useEffect, useRef } from 'react';
import type { Repository, Task, Session, Message } from '@claudectrl/shared';
import { StatusDot } from '../components/StatusDot';
import { CommandInput } from '../components/CommandInput';
import { api } from '../utils/api';

interface Props {
  repo: Repository;
  tasks: Task[];
  sessions: Session[];
  onBack: () => void;
  getTaskOutput: (taskId: string) => string[];
}

function statusLabel(status: Task['status']): string {
  const labels: Record<Task['status'], string> = {
    queued: 'Queued',
    working: 'Working',
    validating: 'Validating',
    ready_for_review: 'Ready for review',
    done: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
  };
  return labels[status] ?? status;
}

export function ProjectView({ repo, tasks, sessions, onBack, getTaskOutput }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeTask = tasks.find(
    (t) => t.repoId === repo.id && ['working', 'validating', 'queued', 'ready_for_review'].includes(t.status)
  );
  const queuedTasks = tasks.filter(
    (t) => t.repoId === repo.id && t.status === 'queued' && t.id !== activeTask?.id
  );
  const recentTask = tasks.reduce<Task | null>(
    (latest, t) => !latest || t.createdAt > latest.createdAt ? t : latest,
    null
  );
  const currentTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? activeTask ?? recentTask
    : activeTask ?? recentTask;

  useEffect(() => {
    api.repos.fetch(repo.id).catch(() => {});
  }, [repo.id]);

  useEffect(() => {
    if (currentTask?.id) {
      api.repos.messages(repo.id, currentTask.id)
        .then((msgs) => setMessages(msgs as Message[]))
        .catch(() => {});
    } else {
      setMessages([]);
    }
  }, [currentTask?.id, repo.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (message: string) => {
    setSubmitting(true);
    setError(null);
    try {
      if (currentTask && currentTask.status === 'ready_for_review') {
        await api.repos.feedback(repo.id, currentTask.id, message);
      } else if (currentTask && ['working', 'validating', 'queued'].includes(currentTask.status)) {
        await api.repos.feedback(repo.id, currentTask.id, message);
      } else {
        await api.repos.submitTask(repo.id, message);
      }
      if (currentTask?.id) {
        const msgs = await api.repos.messages(repo.id, currentTask.id);
        setMessages(msgs as Message[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!currentTask) return;
    try {
      await api.repos.approveTask(repo.id, currentTask.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed');
    }
  };

  const handleStop = async () => {
    if (!currentTask) return;
    try {
      await api.repos.stopTask(repo.id, currentTask.id);
    } catch {}
  };

  const handleDelete = async (taskId: string) => {
    try {
      await api.repos.deleteTask(repo.id, taskId);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleRetry = async (taskId: string) => {
    try {
      await api.repos.retryTask(repo.id, taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    }
  };

  const taskOutput = currentTask ? getTaskOutput(currentTask.id) : [];
  const isActive = currentTask && ['working', 'validating', 'queued'].includes(currentTask.status);
  const isReview = currentTask?.status === 'ready_for_review';

  const previewProxyUrl = repo.previewUrl
    ? `${window.location.origin}/preview/${repo.id}/`
    : null;

  // Live status message: only shown in the strip, never duplicated in chat
  const liveStatusMsg = currentTask?.lastResult
    ? currentTask.lastResult.split('\n')[0].slice(0, 80)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>

      {/* ── Project header ── */}
      <div style={{
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        background: 'var(--c-bg)',
        boxShadow: '0 2px 8px rgb(163 177 198 / 0.3), 0 1px 0 rgba(255,255,255,0.5)',
        position: 'relative',
        zIndex: 5,
      }}>
        <button
          onClick={onBack}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
            color: 'var(--c-muted)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 16, flexShrink: 0,
            transition: 'box-shadow 0.2s, transform 0.15s, color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.color = 'var(--c-fg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.color = 'var(--c-muted)'; }}
          onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; e.currentTarget.style.transform = 'translateY(1px)'; }}
          onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
          aria-label="Back"
        >←</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--c-fg)' }}>
            {repo.name}
          </div>
          {repo.currentBranch && (
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <span style={{ fontSize: 10 }}>⎇</span>
              {repo.currentBranch}
            </div>
          )}
        </div>

        {previewProxyUrl && (
          <a
            href={previewProxyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12, fontWeight: 500, color: 'var(--c-accent)',
              padding: '5px 12px', borderRadius: 'var(--r-full)',
              boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
            }}
          >
            Preview ↗
          </a>
        )}
      </div>

      {/* ── Status strip: controls only, no content duplication ── */}
      {currentTask && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(163,177,198,0.2)',
          flexShrink: 0,
          minHeight: 44,
        }}>
          {/* Status pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 'var(--r-full)',
            boxShadow: 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
            flexShrink: 0,
          }}>
            <StatusDot status={currentTask.status} size={6} pulse />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
              {statusLabel(currentTask.status)}
            </span>
          </div>

          {/* Live status message — single truncated line, not duplicated in chat */}
          {liveStatusMsg && isActive && (
            <span style={{
              fontSize: 12,
              color: 'var(--c-subtle)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}>
              {liveStatusMsg}
            </span>
          )}

          {/* Queue badge */}
          {queuedTasks.length > 0 && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--c-accent)',
              padding: '2px 8px',
              borderRadius: 'var(--r-full)',
              boxShadow: 'var(--shadow-inset-sm)',
              background: 'var(--c-bg)',
              flexShrink: 0,
            }}>
              +{queuedTasks.length} queued
            </span>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          {isReview && (
            <button
              onClick={handleApprove}
              style={{
                fontSize: 13, fontWeight: 600, padding: '6px 18px',
                borderRadius: 'var(--r-full)', background: 'var(--c-accent)', color: '#fff',
                boxShadow: '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)',
                transition: 'transform 0.2s, box-shadow 0.2s', flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '6px 6px 16px rgb(163 177 198 / 0.6), -3px -3px 10px rgba(255,255,255,0.5)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'; }}
              onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; e.currentTarget.style.boxShadow = 'inset 3px 3px 8px rgba(0,0,0,0.2)'; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)'; }}
            >
              ✓ Approve
            </button>
          )}

          {isActive && (
            <button
              onClick={handleStop}
              style={{
                fontSize: 12, fontWeight: 500, padding: '5px 12px',
                borderRadius: 'var(--r-full)', color: 'var(--c-muted)',
                boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
                transition: 'transform 0.2s, box-shadow 0.2s, color 0.2s', flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-failed)'; e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted)'; e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
              onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; e.currentTarget.style.transform = 'translateY(1px)'; }}
              onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
            >
              ■ Stop
            </button>
          )}

          {/* Retry / Delete for failed or stopped current task */}
          {currentTask && ['failed', 'stopped'].includes(currentTask.status) && (
            <>
              <button
                onClick={() => handleRetry(currentTask.id)}
                style={{
                  fontSize: 12, fontWeight: 500, padding: '5px 12px',
                  borderRadius: 'var(--r-full)', color: 'var(--c-accent)',
                  boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
                  transition: 'transform 0.2s, box-shadow 0.2s', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
                onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; e.currentTarget.style.transform = 'translateY(1px)'; }}
                onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
              >
                ↺ Retry
              </button>
              <button
                onClick={() => handleDelete(currentTask.id)}
                style={{
                  fontSize: 12, fontWeight: 500, padding: '5px 12px',
                  borderRadius: 'var(--r-full)', color: 'var(--c-muted)',
                  boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
                  transition: 'transform 0.2s, box-shadow 0.2s, color 0.2s', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--c-failed)'; e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--c-muted)'; e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
                onMouseDown={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)'; e.currentTarget.style.transform = 'translateY(1px)'; }}
                onMouseUp={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.transform = ''; }}
              >
                × Delete
              </button>
            </>
          )}

          <button
            onClick={() => setShowActivity(!showActivity)}
            style={{
              fontSize: 11, color: showActivity ? 'var(--c-accent)' : 'var(--c-subtle)',
              padding: '4px 8px', borderRadius: 'var(--r-full)',
              boxShadow: showActivity ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
              background: 'var(--c-bg)', transition: 'box-shadow 0.2s, color 0.2s', flexShrink: 0,
            }}
          >
            logs
          </button>
        </div>
      )}

      {/* ── Activity terminal ── */}
      {showActivity && taskOutput.length > 0 && (
        <div style={{
          margin: '0 16px 0',
          padding: '12px 16px',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-inset-deep)',
          background: 'var(--c-bg)',
          flexShrink: 0,
          maxHeight: 180,
          overflow: 'auto',
        }}>
          <pre style={{
            fontFamily: 'var(--mono)', fontSize: 11,
            color: 'var(--c-muted)', whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', lineHeight: 1.6,
          }}>
            {taskOutput.slice(-100).join('\n')}
          </pre>
        </div>
      )}

      {/* ── Messages (chat) ── */}
      <div style={{
        flex: 1, overflow: 'auto',
        padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && !currentTask && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, padding: '40px 20px',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              boxShadow: 'var(--shadow-inset)', background: 'var(--c-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, marginBottom: 4,
            }}>✦</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-muted)' }}>Ready for a task</p>
            <p style={{ fontSize: 13, color: 'var(--c-subtle)' }}>Tell Claude what to build or fix</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
              animation: 'slideIn 0.2s ease-out',
            }}
          >
            {msg.role === 'user' ? (
              <div style={{
                background: 'var(--c-accent)', color: '#fff',
                padding: '10px 16px', borderRadius: 'var(--r-lg)',
                borderBottomRightRadius: 6, fontSize: 14,
                lineHeight: 1.6, whiteSpace: 'pre-wrap',
                boxShadow: '3px 3px 10px rgb(163 177 198 / 0.4)',
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{
                padding: '10px 16px', borderRadius: 'var(--r-lg)',
                borderBottomLeftRadius: 6, fontSize: 14,
                lineHeight: 1.7, color: 'var(--c-fg)',
                whiteSpace: 'pre-wrap', boxShadow: 'var(--shadow-raised-sm)',
                background: 'var(--c-bg)',
              }}>
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator while Claude is working and no response yet */}
        {isActive && messages.length > 0 && !messages.some((m) => m.role === 'assistant') && (
          <div style={{ alignSelf: 'flex-start', animation: 'slideIn 0.2s ease-out' }}>
            <div style={{
              padding: '10px 16px', borderRadius: 'var(--r-lg)',
              borderBottomLeftRadius: 6, boxShadow: 'var(--shadow-raised-sm)',
              background: 'var(--c-bg)', display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--c-subtle)',
                  display: 'inline-block',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Task history (when idle) ── */}
      {!activeTask && tasks.filter((t) => t.repoId === repo.id).length > 0 && (
        <div style={{
          margin: '0 16px',
          padding: '12px 16px',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-inset-sm)',
          background: 'var(--c-bg)',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: 'var(--c-subtle)',
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
          }}>History</div>
          {tasks.filter((t) => t.repoId === repo.id).slice(0, 5).map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                borderBottom: '1px solid rgba(163,177,198,0.12)',
                padding: '4px 0',
              }}
            >
              <button
                onClick={() => setSelectedTaskId(t.id === selectedTaskId ? null : t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
                  padding: '4px 0', fontSize: 13, textAlign: 'left',
                  color: selectedTaskId === t.id ? 'var(--c-accent)' : t.status === 'done' ? 'var(--c-muted)' : 'var(--c-fg)',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => { if (selectedTaskId !== t.id) e.currentTarget.style.color = 'var(--c-accent)'; }}
                onMouseLeave={(e) => { if (selectedTaskId !== t.id) e.currentTarget.style.color = t.status === 'done' ? 'var(--c-muted)' : 'var(--c-fg)'; }}
              >
                <StatusDot status={t.status} size={5} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title}
                </span>
              </button>
              {['failed', 'stopped'].includes(t.status) && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => handleRetry(t.id)}
                    title="Retry"
                    style={{ fontSize: 12, color: 'var(--c-accent)', padding: '2px 7px', borderRadius: 'var(--r-full)', boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)' }}
                  >↺</button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    title="Delete"
                    style={{ fontSize: 12, color: 'var(--c-muted)', padding: '2px 7px', borderRadius: 'var(--r-full)', boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-failed)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-muted)')}
                  >×</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          margin: '0 16px', padding: '10px 16px', borderRadius: 'var(--r-md)',
          background: 'var(--c-bg)',
          boxShadow: `inset 4px 4px 8px rgb(163 177 198 / 0.4), inset -4px -4px 8px rgba(255,255,255,0.4), inset 0 0 0 1px rgba(224,82,82,0.3)`,
          color: 'var(--c-failed)', fontSize: 13, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Command input ── */}
      <div style={{ flexShrink: 0 }}>
        <CommandInput
          onSubmit={handleSubmit}
          disabled={submitting}
          placeholder={isReview ? 'Give feedback or say "Approve"...' : 'Tell Claude what to do...'}
        />
      </div>
    </div>
  );
}

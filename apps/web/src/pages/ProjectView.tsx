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
  const currentTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? activeTask
    : activeTask;

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

  const taskOutput = currentTask ? getTaskOutput(currentTask.id) : [];
  const isActive = currentTask && ['working', 'validating', 'queued'].includes(currentTask.status);
  const isReview = currentTask?.status === 'ready_for_review';

  const previewProxyUrl = repo.previewUrl
    ? `${window.location.origin}/preview/${repo.id}/`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>
      {/* Project header */}
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
            width: 34,
            height: 34,
            borderRadius: '50%',
            boxShadow: 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
            color: 'var(--c-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
            transition: 'box-shadow 0.3s ease-out, transform 0.15s ease-out, color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
            e.currentTarget.style.color = 'var(--c-fg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
            e.currentTarget.style.color = 'var(--c-muted)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset-sm)';
            e.currentTarget.style.transform = 'translateY(1px)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
            e.currentTarget.style.transform = '';
          }}
          aria-label="Back to dashboard"
        >
          ←
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--c-fg)' }}>
            {repo.name}
          </div>
          {repo.currentBranch && (
            <div style={{
              fontSize: 11,
              color: 'var(--c-subtle)',
              fontFamily: 'var(--mono)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 1,
            }}>
              <span style={{ fontSize: 10 }}>⎇</span>
              {repo.currentBranch}
            </div>
          )}
        </div>

        {currentTask && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 12px',
            borderRadius: 'var(--r-full)',
            boxShadow: 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
          }}>
            <StatusDot status={currentTask.status} size={6} pulse />
            <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 500 }}>
              {statusLabel(currentTask.status)}
            </span>
          </div>
        )}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Task status panel */}
        {currentTask && (
          <div style={{
            margin: '16px 16px 0',
            padding: '16px 20px',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-raised-sm)',
            background: 'var(--c-bg)',
            flexShrink: 0,
          }}>
            {currentTask.lastResult && (
              <p style={{
                fontSize: 14,
                color: 'var(--c-fg)',
                lineHeight: 1.7,
                marginBottom: 14,
                whiteSpace: 'pre-wrap',
              }}>
                {currentTask.lastResult}
              </p>
            )}
            {!currentTask.lastResult && isActive && (
              <p style={{ fontSize: 14, color: 'var(--c-muted)', fontStyle: 'italic', marginBottom: 14 }}>
                {currentTask.title}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {previewProxyUrl && (
                <a
                  href={previewProxyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--c-accent)',
                    padding: '6px 14px',
                    borderRadius: 'var(--r-full)',
                    boxShadow: 'var(--shadow-raised-xs)',
                    background: 'var(--c-bg)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'box-shadow 0.3s ease-out',
                  }}
                >
                  Open preview ↗
                </a>
              )}

              {/* Approve button */}
              {isReview && (
                <button
                  onClick={handleApprove}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 20px',
                    borderRadius: 'var(--r-full)',
                    background: 'var(--c-accent)',
                    color: '#fff',
                    boxShadow: '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)',
                    transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '6px 6px 16px rgb(163 177 198 / 0.6), -3px -3px 10px rgba(255,255,255,0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'translateY(1px)';
                    e.currentTarget.style.boxShadow = 'inset 3px 3px 8px rgba(0,0,0,0.2), inset -2px -2px 6px rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '4px 4px 12px rgb(163 177 198 / 0.5), -2px -2px 8px rgba(255,255,255,0.4)';
                  }}
                >
                  ✓ Approve
                </button>
              )}

              {/* Stop button */}
              {isActive && (
                <button
                  onClick={handleStop}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    padding: '7px 16px',
                    borderRadius: 'var(--r-full)',
                    color: 'var(--c-muted)',
                    boxShadow: 'var(--shadow-raised-xs)',
                    background: 'var(--c-bg)',
                    transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out, color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--c-failed)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--c-muted)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
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
                  ■ Stop
                </button>
              )}

              {/* Activity toggle */}
              <button
                onClick={() => setShowActivity(!showActivity)}
                style={{
                  fontSize: 12,
                  color: showActivity ? 'var(--c-accent)' : 'var(--c-subtle)',
                  marginLeft: 'auto',
                  padding: '5px 10px',
                  borderRadius: 'var(--r-full)',
                  boxShadow: showActivity ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
                  background: 'var(--c-bg)',
                  transition: 'box-shadow 0.3s ease-out, color 0.2s',
                }}
              >
                {showActivity ? 'Hide logs' : 'View logs'}
              </button>
            </div>
          </div>
        )}

        {/* Activity terminal */}
        {showActivity && taskOutput.length > 0 && (
          <div style={{
            margin: '10px 16px 0',
            padding: '12px 16px',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-inset-deep)',
            background: 'var(--c-bg)',
            flexShrink: 0,
            maxHeight: 180,
            overflow: 'auto',
          }}>
            <pre style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: 'var(--c-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.6,
            }}>
              {taskOutput.slice(-100).join('\n')}
            </pre>
          </div>
        )}

        {/* Messages */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {messages.length === 0 && !currentTask && (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 8,
              padding: '40px 20px',
            }}>
              <div style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                boxShadow: 'var(--shadow-inset)',
                background: 'var(--c-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                marginBottom: 4,
              }}>
                ✦
              </div>
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
                  background: 'var(--c-accent)',
                  color: '#fff',
                  padding: '10px 16px',
                  borderRadius: 'var(--r-lg)',
                  borderBottomRightRadius: 6,
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  boxShadow: '3px 3px 10px rgb(163 177 198 / 0.4)',
                }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{
                  padding: '10px 16px',
                  borderRadius: 'var(--r-lg)',
                  borderBottomLeftRadius: 6,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: 'var(--c-fg)',
                  whiteSpace: 'pre-wrap',
                  boxShadow: 'var(--shadow-raised-sm)',
                  background: 'var(--c-bg)',
                }}>
                  {msg.content}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Session history */}
        {sessions.filter((s) => s.repoId === repo.id).length > 0 && !currentTask && (
          <div style={{
            margin: '0 16px',
            padding: '12px 16px',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-inset-sm)',
            background: 'var(--c-bg)',
            flexShrink: 0,
          }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--c-subtle)',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 10,
            }}>
              History
            </div>
            {tasks.filter((t) => t.repoId === repo.id).slice(0, 5).map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTaskId(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '7px 0',
                  fontSize: 13,
                  textAlign: 'left',
                  color: t.status === 'done' ? 'var(--c-muted)' : 'var(--c-fg)',
                  borderBottom: '1px solid rgba(163,177,198,0.15)',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-accent)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.status === 'done' ? 'var(--c-muted)' : 'var(--c-fg)')}
              >
                <StatusDot status={t.status} size={5} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          margin: '0 16px',
          padding: '10px 16px',
          borderRadius: 'var(--r-md)',
          background: 'var(--c-bg)',
          boxShadow: `inset 4px 4px 8px rgb(163 177 198 / 0.4), inset -4px -4px 8px rgba(255,255,255,0.4), inset 0 0 0 1px rgba(224,82,82,0.3)`,
          color: 'var(--c-failed)',
          fontSize: 13,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ color: 'var(--c-failed)', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Command input */}
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

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

  // Auto-fetch latest from remote when project is opened
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
        // Queue a new message as feedback
        await api.repos.feedback(repo.id, currentTask.id, message);
      } else {
        await api.repos.submitTask(repo.id, message);
      }
      // Refresh messages
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

  // Preview URL via proxy
  const previewProxyUrl = repo.previewUrl
    ? `${window.location.origin}/preview/${repo.id}/`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--c-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{ color: 'var(--c-muted)', fontSize: 13, padding: '2px 0' }}
          aria-label="Back to dashboard"
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{repo.name}</div>
          {repo.currentBranch && (
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', fontFamily: 'var(--mono)' }}>
              {repo.currentBranch}
            </div>
          )}
        </div>
        {currentTask && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusDot status={currentTask.status} size={5} pulse />
            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>
              {statusLabel(currentTask.status)}
            </span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Current task status */}
        {currentTask && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border-light)', flexShrink: 0 }}>
            {currentTask.lastResult && (
              <p style={{ fontSize: 14, color: 'var(--c-fg)', lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                {currentTask.lastResult}
              </p>
            )}
            {!currentTask.lastResult && isActive && (
              <p style={{ fontSize: 14, color: 'var(--c-muted)', fontStyle: 'italic' }}>
                {currentTask.title}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Preview link */}
              {previewProxyUrl && (
                <a
                  href={previewProxyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: 'var(--c-fg)', borderBottom: '1px solid var(--c-border)' }}
                >
                  Open app ↗
                </a>
              )}

              {/* Approve button */}
              {isReview && (
                <button
                  onClick={handleApprove}
                  style={{
                    fontSize: 13,
                    padding: '5px 14px',
                    background: 'var(--c-fg)',
                    color: '#fff',
                    borderRadius: 4,
                  }}
                >
                  Approve
                </button>
              )}

              {/* Stop button */}
              {isActive && (
                <button
                  onClick={handleStop}
                  style={{ fontSize: 12, color: 'var(--c-muted)', padding: '5px 0' }}
                >
                  Stop
                </button>
              )}

              {/* View activity toggle */}
              <button
                onClick={() => setShowActivity(!showActivity)}
                style={{ fontSize: 12, color: 'var(--c-subtle)', marginLeft: 'auto' }}
              >
                {showActivity ? 'Hide activity' : 'View activity'}
              </button>
            </div>
          </div>
        )}

        {/* Activity terminal (raw output) */}
        {showActivity && taskOutput.length > 0 && (
          <div style={{
            borderBottom: '1px solid var(--c-border-light)',
            padding: '8px 20px',
            flexShrink: 0,
            maxHeight: 200,
            overflow: 'auto',
          }}>
            <pre style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: 'var(--c-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {taskOutput.slice(-100).join('\n')}
            </pre>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {msg.role === 'user' ? (
                <div style={{
                  background: 'var(--c-fg)',
                  color: '#fff',
                  padding: '8px 12px',
                  borderRadius: 12,
                  borderBottomRightRadius: 3,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{ color: 'var(--c-fg)', whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Sessions panel */}
        {sessions.filter((s) => s.repoId === repo.id).length > 0 && !currentTask && (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--c-border-light)', flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Sessions
            </div>
            {tasks.filter((t) => t.repoId === repo.id).slice(0, 5).map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTaskId(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 0',
                  fontSize: 13,
                  textAlign: 'left',
                  color: t.status === 'done' ? 'var(--c-muted)' : 'var(--c-fg)',
                }}
              >
                <StatusDot status={t.status} size={5} />
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 20px', background: '#fff5f5', color: '#c0392b', fontSize: 13, flexShrink: 0 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, color: '#c0392b' }}>×</button>
        </div>
      )}

      {/* Command input */}
      <div style={{ flexShrink: 0 }}>
        <CommandInput
          onSubmit={handleSubmit}
          disabled={submitting}
          placeholder={isReview ? 'Give feedback or type Approve...' : 'Tell Claude what to do...'}
        />
      </div>
    </div>
  );
}

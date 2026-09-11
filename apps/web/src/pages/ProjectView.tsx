import { useState, useEffect, useRef } from 'react';
import type { Repository, Task, Session } from '@claudectrl/shared';
import type { ParsedOutput } from '../utils/parseOutput';
import { SessionPanel } from '../components/SessionPanel';
import { useLayoutStore } from '../hooks/useLayoutStore';
import { api } from '../utils/api';

interface Props {
  repo: Repository;
  tasks: Task[];
  sessions: Session[];
  onBack: () => void;
  getTaskOutput: (taskId: string) => string[];
  getTaskParsed: (taskId: string) => ParsedOutput;
}

export function ProjectView({ repo, tasks, sessions, onBack, getTaskOutput, getTaskParsed }: Props) {
  const [newTaskInput, setNewTaskInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const dragTaskId = useRef<string | null>(null);

  const { getLayout, setSize, swapOrder } = useLayoutStore(repo.id);

  useEffect(() => {
    api.repos.fetch(repo.id).catch(() => {});
  }, [repo.id]);

  const repoTasks = tasks.filter(t => t.repoId === repo.id);

  // Group tasks by sessionRef for queue display
  const tasksBySession = new Map<string, Task[]>();
  for (const t of repoTasks) {
    if (t.sessionRef) {
      const list = tasksBySession.get(t.sessionRef) ?? [];
      list.push(t);
      tasksBySession.set(t.sessionRef, list);
    }
  }

  // Active tasks: not archived
  const activeTasks = repoTasks.filter(t => !t.archived);
  const displayTasks: Task[] = [];
  const seenSessions = new Set<string>();

  for (const t of activeTasks) {
    if (t.sessionRef) {
      if (seenSessions.has(t.sessionRef)) continue;
      seenSessions.add(t.sessionRef);
      const sessionTasks = tasksBySession.get(t.sessionRef) ?? [];
      const activeInSession = sessionTasks.find(st =>
        ['working', 'validating', 'queued', 'ready_for_review', 'paused'].includes(st.status)
      );
      displayTasks.push(activeInSession ?? sessionTasks[0]);
    } else {
      displayTasks.push(t);
    }
  }

  // Sort: layout order first, then status priority, then creation time desc
  const statusPriority: Record<string, number> = {
    working: 0, validating: 1, queued: 2, ready_for_review: 3, paused: 4,
    failed: 5, stopped: 6, done: 7,
  };
  displayTasks.sort((a, b) => {
    const la = getLayout(a.id);
    const lb = getLayout(b.id);
    if (la.order !== lb.order) return la.order - lb.order;
    const pa = statusPriority[a.status] ?? 99;
    const pb = statusPriority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const archivedTasks = repoTasks.filter(t => t.archived);

  const handleNewTask = async () => {
    const msg = newTaskInput.trim();
    if (!msg) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.repos.submitTask(repo.id, msg);
      setNewTaskInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToQueue = async (sessionRef: string, message: string) => {
    try {
      await api.repos.submitTask(repo.id, message, sessionRef);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to queue task');
    }
  };

  const handleUnarchive = async (taskId: string) => {
    try {
      await api.repos.unarchiveTask(repo.id, taskId);
    } catch {}
  };

  const handleDragStart = (taskId: string) => (e: React.DragEvent) => {
    dragTaskId.current = taskId;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (targetTaskId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = dragTaskId.current;
    if (sourceId && sourceId !== targetTaskId) {
      swapOrder(sourceId, targetTaskId);
    }
    dragTaskId.current = null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>

      {/* Top bar */}
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
            transition: 'box-shadow 0.2s, color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)'; e.currentTarget.style.color = 'var(--c-fg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)'; e.currentTarget.style.color = 'var(--c-muted)'; }}
          aria-label="Back"
        >{'\u2190'}</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--c-fg)' }}>
            {repo.name}
          </div>
          {repo.currentBranch && (
            <div style={{ fontSize: 11, color: 'var(--c-subtle)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <span style={{ fontSize: 10 }}>{'\u238B'}</span>
              {repo.currentBranch}
            </div>
          )}
        </div>

        {displayTasks.length > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--c-subtle)',
            padding: '4px 10px', borderRadius: 'var(--r-full)',
            boxShadow: 'var(--shadow-inset-sm)', background: 'var(--c-bg)',
          }}>
            {displayTasks.filter(t => ['working', 'validating', 'queued'].includes(t.status)).length} active
          </span>
        )}
      </div>

      {/* New session input */}
      <div style={{ padding: '12px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={newTaskInput}
            onChange={(e) => setNewTaskInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNewTask(); } }}
            placeholder="New session \u2014 tell Claude what to do..."
            disabled={submitting}
            style={{
              flex: 1, fontSize: 13, padding: '10px 16px',
              borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-inset)',
              background: 'var(--c-bg)', color: 'var(--c-fg)', fontFamily: 'var(--font)',
            }}
          />
          <button
            onClick={handleNewTask}
            disabled={submitting || !newTaskInput.trim()}
            style={{
              width: 38, height: 38, borderRadius: '50%', fontSize: 16,
              background: newTaskInput.trim() && !submitting ? 'var(--c-accent)' : 'var(--c-bg)',
              color: newTaskInput.trim() && !submitting ? '#fff' : 'var(--c-subtle)',
              boxShadow: newTaskInput.trim() && !submitting
                ? '4px 4px 10px rgb(163 177 198 / 0.5), -2px -2px 6px rgba(255,255,255,0.4)'
                : 'var(--shadow-raised-xs)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s, color 0.2s, box-shadow 0.2s',
            }}
          >+</button>
        </div>
        {error && (
          <div style={{
            marginTop: 8, padding: '6px 12px', borderRadius: 'var(--r-md)',
            boxShadow: 'inset 0 0 0 1px rgba(224,82,82,0.3)',
            color: 'var(--c-failed)', fontSize: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ color: 'var(--c-failed)', fontSize: 16 }}>{'\u00D7'}</button>
          </div>
        )}
      </div>

      {/* Session grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
        {displayTasks.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, padding: '60px 20px',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              boxShadow: 'var(--shadow-inset)', background: 'var(--c-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}>{'\u2726'}</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-muted)' }}>No sessions</p>
            <p style={{ fontSize: 13, color: 'var(--c-subtle)' }}>Start one above {'\u2014'} each session gets its own branch</p>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 16,
        }}>
          {displayTasks.map(task => {
            const sessionTasks = task.sessionRef ? (tasksBySession.get(task.sessionRef) ?? []) : [];
            const queued = sessionTasks.filter(st => st.id !== task.id && st.status === 'queued');
            const layout = getLayout(task.id);
            return (
              <SessionPanel
                key={task.id}
                task={task}
                repoId={repo.id}
                output={getTaskOutput(task.id)}
                parsed={getTaskParsed(task.id)}
                size={layout.size}
                onSizeChange={(s) => setSize(task.id, s)}
                queuedTasks={queued}
                onAddToQueue={handleAddToQueue}
                onDragStart={handleDragStart(task.id)}
                onDragOver={handleDragOver}
                onDrop={handleDrop(task.id)}
              />
            );
          })}
        </div>

        {/* Archived section */}
        {archivedTasks.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{
                fontSize: 11, fontWeight: 600, color: 'var(--c-subtle)',
                textTransform: 'uppercase', letterSpacing: 1,
                padding: '6px 12px', borderRadius: 'var(--r-full)',
                boxShadow: showArchived ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
                background: 'var(--c-bg)', transition: 'box-shadow 0.2s',
              }}
            >
              Archived ({archivedTasks.length}) {showArchived ? '\u25BC' : '\u25B6'}
            </button>

            {showArchived && (
              <div style={{
                marginTop: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 8,
              }}>
                {archivedTasks.map(t => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 'var(--r-md)',
                    boxShadow: 'var(--shadow-raised-xs)', background: 'var(--c-bg)',
                  }}>
                    <StatusDotInline status={t.status} />
                    <span style={{
                      fontSize: 12, color: 'var(--c-muted)', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{t.title}</span>
                    <button
                      onClick={() => handleUnarchive(t.id)}
                      style={{
                        fontSize: 10, color: 'var(--c-accent)', padding: '3px 8px',
                        borderRadius: 'var(--r-full)', boxShadow: 'var(--shadow-raised-xs)',
                        background: 'var(--c-bg)',
                      }}
                    >Unarchive</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDotInline({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: '#38B2AC', failed: '#E05252', stopped: '#A0AEC0', paused: '#D4A017',
    working: '#D97757', queued: '#A0AEC0', validating: '#E8975A', ready_for_review: '#D97757',
  };
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: colors[status] ?? '#C8CDD6',
      display: 'inline-block', flexShrink: 0,
    }} />
  );
}

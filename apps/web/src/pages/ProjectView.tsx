import { useState, useEffect, useRef, useCallback } from 'react';
import type { Repository, Task, Session } from '@claudectrl/shared';
import type { ParsedOutput } from '../utils/parseOutput';
import { SessionPanel } from '../components/SessionPanel';
import { useLayoutStore } from '../hooks/useLayoutStore';
import type { PanelLayout } from '../hooks/useLayoutStore';
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
  const draftKey = `draft:${repo.id}`;
  const [newTaskInput, setNewTaskInput] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(true);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

  const { getLayout, setLayout } = useLayoutStore(repo.id);

  // Drag/resize state
  const dragging = useRef<{ taskId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizing = useRef<{ taskId: string; dir: 'right' | 'bottom' | 'corner'; startX: number; startY: number; origW: number; origH: number } | null>(null);
  const liveRef = useRef<Record<string, Partial<PanelLayout>>>({});
  const [liveLayouts, setLiveLayouts] = useState<Record<string, Partial<PanelLayout>>>({});

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    api.repos.fetch(repo.id).catch(() => {});
  }, [repo.id]);

  // Document-level mouse event listeners for drag/resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        const { taskId, startX, startY, origX, origY } = dragging.current;
        liveRef.current[taskId] = {
          x: Math.max(0, origX + e.clientX - startX),
          y: Math.max(0, origY + e.clientY - startY),
        };
        setLiveLayouts({ ...liveRef.current });
      }
      if (resizing.current) {
        const { taskId, dir, startX, startY, origW, origH } = resizing.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        liveRef.current[taskId] = {
          width: dir !== 'bottom' ? Math.max(220, origW + dx) : origW,
          height: dir !== 'right' ? Math.max(120, origH + dy) : origH,
        };
        setLiveLayouts({ ...liveRef.current });
      }
    };
    const onUp = () => {
      for (const ref of [dragging, resizing] as const) {
        if (ref.current) {
          const { taskId } = ref.current;
          if (liveRef.current[taskId]) {
            setLayout(taskId, liveRef.current[taskId]);
            delete liveRef.current[taskId];
            setLiveLayouts({ ...liveRef.current });
          }
          ref.current = null;
        }
      }
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [setLayout]);

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
        ['working', 'validating', 'committing', 'merging', 'resolving_conflict', 'queued', 'ready_for_review', 'paused'].includes(st.status)
      );
      displayTasks.push(activeInSession ?? sessionTasks[0]);
    } else {
      displayTasks.push(t);
    }
  }

  // Sort: status priority, then creation time desc
  const statusPriority: Record<string, number> = {
    working: 0, validating: 1, queued: 2, ready_for_review: 3, paused: 4,
    failed: 5, stopped: 6, done: 7,
  };
  displayTasks.sort((a, b) => {
    const pa = statusPriority[a.status] ?? 99;
    const pb = statusPriority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const archivedTasks = repoTasks.filter(t => t.archived);

  // Layout resolver
  function resolvedLayout(taskId: string, idx: number): PanelLayout {
    const stored = getLayout(taskId, idx);
    const live = liveLayouts[taskId];
    return live ? { ...stored, ...live } : stored;
  }

  // Canvas min height
  const canvasMinHeight = displayTasks.reduce((max, t, i) => {
    const l = resolvedLayout(t.id, i);
    return Math.max(max, l.y + l.height + 40);
  }, 400);

  // Mobile: active tab
  const activeTask = displayTasks.find(t => t.id === activeTabId) ?? displayTasks[0];

  const handleNewTask = async () => {
    const msg = newTaskInput.trim();
    if (!msg) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.repos.submitTask(repo.id, msg);
      setNewTaskInput('');
      localStorage.removeItem(draftKey);
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

  const handleDragHeaderMouseDown = useCallback((taskId: string, idx: number) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    const layout = resolvedLayout(taskId, idx);
    dragging.current = { taskId, startX: e.clientX, startY: e.clientY, origX: layout.x, origY: layout.y };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLayouts]);

  const handleResizeMouseDown = useCallback((taskId: string, dir: 'right' | 'bottom' | 'corner', idx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    const layout = resolvedLayout(taskId, idx);
    resizing.current = { taskId, dir, startX: e.clientX, startY: e.clientY, origW: layout.width, origH: layout.height };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLayouts]);

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
            onChange={(e) => { setNewTaskInput(e.target.value); localStorage.setItem(draftKey, e.target.value); }}
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

      {/* Mobile: tab bar + active panel */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', overflowX: 'auto', gap: 6,
            padding: '8px 12px', flexShrink: 0, scrollbarWidth: 'none',
          }}>
            {displayTasks.map(task => {
              const isActiveTab = (activeTabId === task.id) || (!activeTabId && task === displayTasks[0]);
              return (
                <button key={task.id} onClick={() => setActiveTabId(task.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 'var(--r-full)',
                  fontSize: 12, fontWeight: isActiveTab ? 600 : 400,
                  color: isActiveTab ? 'var(--c-accent)' : 'var(--c-muted)',
                  boxShadow: isActiveTab ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
                  background: 'var(--c-bg)', flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  <StatusDotInline status={task.status} />
                  {task.title.slice(0, 30)}
                </button>
              );
            })}
          </div>
          {activeTask && (() => {
            const sessionTasks = activeTask.sessionRef ? (tasksBySession.get(activeTask.sessionRef) ?? []) : [];
            const activeQueued = sessionTasks.filter(st => st.id !== activeTask.id && st.status === 'queued');
            return (
              <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                <SessionPanel
                  task={activeTask}
                  repoId={repo.id}
                  output={getTaskOutput(activeTask.id)}
                  parsed={getTaskParsed(activeTask.id)}
                  queuedTasks={activeQueued}
                  onAddToQueue={handleAddToQueue}
                />
              </div>
            );
          })()}
          {displayTasks.length === 0 && <EmptyState />}
        </div>
      ) : (
        /* Desktop: canvas */
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ position: 'relative', minHeight: canvasMinHeight }}>
            {displayTasks.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState />
              </div>
            )}
            {displayTasks.map((task, idx) => {
              const layout = resolvedLayout(task.id, idx);
              const sessionTasks = task.sessionRef ? (tasksBySession.get(task.sessionRef) ?? []) : [];
              const queued = sessionTasks.filter(st => st.id !== task.id && st.status === 'queued');
              return (
                <div key={task.id} style={{
                  position: 'absolute',
                  left: layout.x, top: layout.y,
                  width: layout.width, height: layout.height,
                }}>
                  <SessionPanel
                    task={task}
                    repoId={repo.id}
                    output={getTaskOutput(task.id)}
                    parsed={getTaskParsed(task.id)}
                    queuedTasks={queued}
                    onAddToQueue={handleAddToQueue}
                    onDragHandleMouseDown={handleDragHeaderMouseDown(task.id, idx)}
                    onResizeMouseDown={(dir) => handleResizeMouseDown(task.id, dir, idx)}
                  />
                </div>
              );
            })}
          </div>

          {/* Archived section — normal flow below canvas */}
          {archivedTasks.length > 0 && (
            <div style={{ padding: '0 20px 20px' }}>
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
                      >Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
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

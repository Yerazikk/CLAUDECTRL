import { useState, useCallback, useEffect } from 'react';
import { useStore } from './hooks/useStore';
import { Dashboard } from './pages/Dashboard';
import { ProjectView } from './pages/ProjectView';
import { AddProject } from './pages/AddProject';
import { Settings } from './pages/Settings';
import { UsageBars } from './components/UsageBars';
import { ConnectionIndicator } from './components/ConnectionIndicator';

type View = { type: 'dashboard' } | { type: 'project'; repoId: string } | { type: 'add' } | { type: 'settings' };

interface OpenTab {
  repoId: string;
  name: string;
}

function useCommandPalette(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}

export default function App() {
  const { state, getTaskOutput } = useStore();
  const [view, setView] = useState<View>({ type: 'dashboard' });
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const openProject = useCallback((repoId: string) => {
    const repo = state.repos.find((r) => r.id === repoId);
    if (!repo) {
      // Repo not yet in state (e.g. just cloned, waiting for WS event) — queue it
      setPendingOpenId(repoId);
      return;
    }
    setView({ type: 'project', repoId });
    setOpenTabs((prev) => {
      if (prev.some((t) => t.repoId === repoId)) return prev;
      return [...prev, { repoId, name: repo.name }];
    });
  }, [state.repos]);

  const closeTab = useCallback((repoId: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.repoId !== repoId));
    setView((v) => v.type === 'project' && v.repoId === repoId ? { type: 'dashboard' } : v);
  }, []);

  // Open a repo as soon as it arrives in state (handles post-clone navigation)
  useEffect(() => {
    if (!pendingOpenId) return;
    const repo = state.repos.find((r) => r.id === pendingOpenId);
    if (!repo) return;
    setPendingOpenId(null);
    setView({ type: 'project', repoId: pendingOpenId });
    setOpenTabs((prev) =>
      prev.some((t) => t.repoId === pendingOpenId)
        ? prev
        : [...prev, { repoId: pendingOpenId, name: repo.name }]
    );
  }, [pendingOpenId, state.repos]);

  useCommandPalette(() => setView({ type: 'dashboard' }));

  useEffect(() => {
    const handleNotification = (event: CustomEvent) => {
      if (Notification.permission === 'granted') {
        const { title, body } = event.detail;
        new Notification(title, { body });
      }
    };
    window.addEventListener('claudectrl:notify', handleNotification as EventListener);
    return () => window.removeEventListener('claudectrl:notify', handleNotification as EventListener);
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const prevTaskStatuses = useState<Map<string, string>>(new Map())[0];
  useEffect(() => {
    for (const task of state.tasks) {
      const prev = prevTaskStatuses.get(task.id);
      if (prev !== task.status) {
        const repo = state.repos.find((r) => r.id === task.repoId);
        if (task.status === 'ready_for_review' && prev && Notification.permission === 'granted') {
          new Notification(`${repo?.name ?? 'Project'} ready for review`, { body: task.title });
        }
        if (task.status === 'failed' && prev && Notification.permission === 'granted') {
          new Notification(`${repo?.name ?? 'Project'} task failed`, { body: task.title });
        }
        prevTaskStatuses.set(task.id, task.status);
      }
    }
  }, [state.tasks, state.repos, prevTaskStatuses]);

  const currentRepo = view.type === 'project'
    ? state.repos.find((r) => r.id === view.repoId)
    : null;

  const repoTasks = currentRepo
    ? state.tasks.filter((t) => t.repoId === currentRepo.id)
    : [];

  const repoSessions = currentRepo
    ? state.sessions.filter((s) => s.repoId === currentRepo.id)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-bg)' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 56,
        flexShrink: 0,
        gap: 10,
        overflow: 'hidden',
        background: 'var(--c-bg)',
        boxShadow: '0 4px 12px rgb(163 177 198 / 0.4), 0 1px 0 rgba(255,255,255,0.6)',
        position: 'relative',
        zIndex: 10,
      }}>
        {/* Logo */}
        <button
          onClick={() => setView({ type: 'dashboard' })}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: 'var(--c-accent)',
            padding: '6px 14px',
            borderRadius: 'var(--r-full)',
            boxShadow: view.type === 'dashboard' ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
            flexShrink: 0,
            transition: 'box-shadow 0.3s ease-out',
          }}
        >
          CLAUDECTRL
        </button>

        {/* Project tabs (desktop) */}
        {!isMobile && openTabs.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            overflow: 'hidden',
            gap: 6,
          }}>
            {openTabs.map((tab) => {
              const isActive = view.type === 'project' && view.repoId === tab.repoId;
              const hasActivity = state.tasks.some((t) =>
                t.repoId === tab.repoId && ['working', 'validating', 'ready_for_review'].includes(t.status)
              );
              return (
                <div key={tab.repoId} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 2 }}>
                  <button
                    onClick={() => setView({ type: 'project', repoId: tab.repoId })}
                    style={{
                      fontSize: 12,
                      padding: '5px 12px',
                      height: 32,
                      borderRadius: 'var(--r-full)',
                      color: isActive ? 'var(--c-accent)' : 'var(--c-muted)',
                      fontWeight: isActive ? 600 : 400,
                      boxShadow: isActive ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
                      background: 'var(--c-bg)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'box-shadow 0.3s ease-out, color 0.2s ease-out',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {hasActivity && (
                      <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--c-accent)',
                        display: 'inline-block',
                        animation: 'pulse 2s ease-in-out infinite',
                        flexShrink: 0,
                      }} />
                    )}
                    {tab.name}
                  </button>
                  <button
                    onClick={() => closeTab(tab.repoId)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      fontSize: 12,
                      color: 'var(--c-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: 'var(--shadow-raised-xs)',
                      background: 'var(--c-bg)',
                      transition: 'color 0.2s ease-out',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-failed)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-subtle)')}
                    aria-label={`Close ${tab.name} tab`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setView({ type: 'add' })}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                fontSize: 16,
                color: 'var(--c-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-raised-xs)',
                background: 'var(--c-bg)',
                flexShrink: 0,
                transition: 'color 0.2s ease-out, box-shadow 0.2s ease-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--c-accent)';
                e.currentTarget.style.boxShadow = 'var(--shadow-raised-sm)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--c-subtle)';
                e.currentTarget.style.boxShadow = 'var(--shadow-raised-xs)';
              }}
              title="Add project"
            >
              +
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <ConnectionIndicator connected={state.connected} />

        <button
          onClick={() => setView({ type: 'settings' })}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            fontSize: 15,
            color: view.type === 'settings' ? 'var(--c-accent)' : 'var(--c-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: view.type === 'settings' ? 'var(--shadow-inset-sm)' : 'var(--shadow-raised-xs)',
            background: 'var(--c-bg)',
            transition: 'box-shadow 0.3s ease-out, color 0.2s ease-out',
          }}
          onMouseEnter={(e) => {
            if (view.type !== 'settings') e.currentTarget.style.color = 'var(--c-fg)';
          }}
          onMouseLeave={(e) => {
            if (view.type !== 'settings') e.currentTarget.style.color = 'var(--c-muted)';
          }}
          aria-label="Settings"
          title="Settings"
        >
          ⚙
        </button>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view.type === 'dashboard' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <Dashboard
              repos={state.repos}
              tasks={state.tasks}
              onSelectRepo={openProject}
              onAddRepo={() => setView({ type: 'add' })}
            />
          </div>
        )}

        {view.type === 'project' && currentRepo && (
          <ProjectView
            repo={currentRepo}
            tasks={repoTasks}
            sessions={repoSessions}
            onBack={() => setView({ type: 'dashboard' })}
            getTaskOutput={getTaskOutput}
          />
        )}

        {view.type === 'add' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <AddProject
              onDone={(repoId) => {
                if (repoId) openProject(repoId);
                else setView({ type: 'dashboard' });
              }}
            />
          </div>
        )}

        {view.type === 'settings' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <Settings onBack={() => setView({ type: 'dashboard' })} />
          </div>
        )}
      </main>

      {/* Usage bars */}
      <div style={{ flexShrink: 0 }}>
        <UsageBars usage={state.usage} />
      </div>
    </div>
  );
}

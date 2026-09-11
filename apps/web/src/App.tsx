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

// Simple command palette hook
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
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const openProject = useCallback((repoId: string) => {
    const repo = state.repos.find((r) => r.id === repoId);
    if (!repo) return;
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

  useCommandPalette(() => setView({ type: 'dashboard' }));

  // Notification support
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

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Fire notifications for important events (ready_for_review, failed)
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top chrome */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 40,
        borderBottom: '1px solid var(--c-border)',
        flexShrink: 0,
        gap: 8,
        overflow: 'hidden',
      }}>
        {/* Logo / home button */}
        <button
          onClick={() => setView({ type: 'dashboard' })}
          style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2, flexShrink: 0 }}
        >
          CLAUDECTRL
        </button>

        {/* Project tabs (desktop) */}
        {!isMobile && openTabs.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'stretch',
            flex: 1,
            overflow: 'hidden',
            gap: 0,
            borderLeft: '1px solid var(--c-border)',
            marginLeft: 8,
            paddingLeft: 4,
          }}>
            {openTabs.map((tab) => {
              const isActive = view.type === 'project' && view.repoId === tab.repoId;
              const repo = state.repos.find((r) => r.id === tab.repoId);
              const hasActivity = state.tasks.some((t) =>
                t.repoId === tab.repoId && ['working', 'validating', 'ready_for_review'].includes(t.status)
              );
              return (
                <div key={tab.repoId} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <button
                    onClick={() => setView({ type: 'project', repoId: tab.repoId })}
                    style={{
                      fontSize: 12,
                      padding: '0 10px',
                      height: 40,
                      color: isActive ? 'var(--c-fg)' : 'var(--c-muted)',
                      fontWeight: isActive ? 500 : 400,
                      borderBottom: isActive ? '2px solid var(--c-fg)' : '2px solid transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {hasActivity && (
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#0a0a0a', display: 'inline-block' }} />
                    )}
                    {tab.name}
                  </button>
                  <button
                    onClick={() => closeTab(tab.repoId)}
                    style={{ fontSize: 11, color: 'var(--c-subtle)', padding: '0 4px', height: 40 }}
                    aria-label={`Close ${tab.name} tab`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setView({ type: 'add' })}
              style={{ fontSize: 13, color: 'var(--c-subtle)', padding: '0 8px', flexShrink: 0 }}
              title="Add project"
            >
              +
            </button>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Connection + Settings */}
        <ConnectionIndicator connected={state.connected} />
        <button
          onClick={() => setView({ type: 'settings' })}
          style={{ fontSize: 12, color: 'var(--c-subtle)', padding: '0 4px', marginLeft: 8 }}
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

      {/* Usage bars at bottom */}
      <div style={{ flexShrink: 0 }}>
        <UsageBars usage={state.usage} />
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Repository, Task, Session, UsageSnapshot, Preview } from '@claudectrl/shared';
import type { ServerEvent, StateSnapshot } from '@claudectrl/shared';

export interface AppState {
  repos: Repository[];
  tasks: Task[];
  sessions: Session[];
  usage: UsageSnapshot | null;
  previews: Preview[];
  connected: boolean;
}

const initialState: AppState = {
  repos: [],
  tasks: [],
  sessions: [],
  usage: null,
  previews: [],
  connected: false,
};

function applyEvent(state: AppState, event: ServerEvent): AppState {
  switch (event.type) {
    case 'state.snapshot':
      return { ...state, ...event.data, connected: true };

    case 'repo.updated':
      return {
        ...state,
        repos: state.repos.some((r) => r.id === event.repo.id)
          ? state.repos.map((r) => (r.id === event.repo.id ? event.repo : r))
          : [...state.repos, event.repo],
      };

    case 'task.created':
    case 'task.started':
    case 'task.ready_for_review':
    case 'task.done':
      return {
        ...state,
        tasks: state.tasks.some((t) => t.id === event.task.id)
          ? state.tasks.map((t) => (t.id === event.task.id ? event.task : t))
          : [...state.tasks, event.task],
      };

    case 'task.status':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? { ...t, status: event.status, lastResult: event.message ?? t.lastResult }
            : t
        ),
      };

    case 'task.failed':
    case 'task.stopped':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? { ...t, status: event.type === 'task.failed' ? 'failed' : 'stopped' }
            : t
        ),
      };

    case 'session.started':
    case 'session.resumed':
      return {
        ...state,
        sessions: state.sessions.some((s) => s.id === event.session.id)
          ? state.sessions.map((s) => (s.id === event.session.id ? event.session : s))
          : [...state.sessions, event.session],
      };

    case 'preview.started':
      return {
        ...state,
        previews: [...state.previews.filter((p) => p.id !== event.preview.id), event.preview],
      };

    case 'preview.stopped':
      return {
        ...state,
        previews: state.previews.map((p) =>
          p.id === event.previewId ? { ...p, active: false } : p
        ),
      };

    case 'usage.updated':
      return { ...state, usage: event.usage };

    default:
      return state;
  }
}

const WS_URL = (() => {
  const { protocol, hostname, port } = window.location;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev mode (port 5173), connect to server port 4173
  const serverPort = port === '5173' ? '4173' : port;
  return `${wsProto}//${hostname}:${serverPort}/ws`;
})();

export function useStore() {
  const [state, setState] = useState<AppState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskOutputs = useRef<Map<string, string[]>>(new Map());
  const [taskOutputMap, setTaskOutputMap] = useState<Map<string, string[]>>(new Map());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as ServerEvent;
        if (event.type === 'task.output') {
          const lines = taskOutputs.current.get(event.taskId) ?? [];
          lines.push(event.line);
          if (lines.length > 500) lines.splice(0, lines.length - 500); // keep last 500
          taskOutputs.current.set(event.taskId, lines);
          setTaskOutputMap(new Map(taskOutputs.current));
          return;
        }
        setState((s) => applyEvent(s, event));
      } catch {}
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const getTaskOutput = useCallback((taskId: string): string[] => {
    return taskOutputMap.get(taskId) ?? [];
  }, [taskOutputMap]);

  return { state, getTaskOutput };
}

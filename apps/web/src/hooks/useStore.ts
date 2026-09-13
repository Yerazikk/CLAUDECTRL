import { useState, useEffect, useCallback, useRef } from 'react';
import type { Repository, Task, Session, UsageSnapshot, Preview, TranscriptEntry } from '@claudectrl/shared';
import type { ServerEvent, StateSnapshot } from '@claudectrl/shared';
import { mergeEntry } from '../utils/transcript';
import { api } from '../utils/api';

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
    case 'task.paused':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? { ...t, status: event.type === 'task.failed' ? 'failed' : event.type === 'task.paused' ? 'paused' : 'stopped' }
            : t
        ),
      };

    case 'task.archived':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === event.taskId
            ? { ...t, archived: event.archived }
            : t
        ),
      };

    case 'task.deleted':
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== event.taskId),
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
  const serverPort = port === '5173' ? '4173' : port;
  return `${wsProto}//${hostname}:${serverPort}/ws`;
})();

export function useStore() {
  const [state, setState] = useState<AppState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transcript entries per task. A session's card stitches together the tasks
  // that belong to it, so a queue reads as one continuous conversation.
  const [transcripts, setTranscripts] = useState<Map<string, TranscriptEntry[]>>(new Map());
  const requestedHistory = useRef<Set<string>>(new Set());

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

        if (event.type === 'task.transcript') {
          const { taskId } = event.entry;
          setTranscripts((prev) => {
            const next = new Map(prev);
            next.set(taskId, mergeEntry(prev.get(taskId) ?? [], event.entry));
            return next;
          });
          return;
        }

        if (event.type === 'task.transcript_cleared') {
          setTranscripts((prev) => {
            const next = new Map(prev);
            // A clear covers the whole session, so drop every task we hold for it
            for (const [taskId, entries] of prev) {
              const belongs = taskId === event.taskId
                || (event.sessionRef !== null && entries.some((e) => e.sessionRef === event.sessionRef));
              if (belongs) next.set(taskId, []);
            }
            return next;
          });
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

  /**
   * Load a task's stored transcript once, so a card is complete after a page
   * reload instead of only showing what streamed in live.
   */
  const loadTranscript = useCallback((repoId: string, taskId: string) => {
    if (requestedHistory.current.has(taskId)) return;
    requestedHistory.current.add(taskId);
    api.repos.transcript(repoId, taskId)
      .then((entries) => {
        setTranscripts((prev) => {
          const next = new Map(prev);
          // Live entries may have landed while this was in flight — merge, don't replace
          let merged = entries;
          for (const live of prev.get(taskId) ?? []) merged = mergeEntry(merged, live);
          next.set(taskId, merged);
          return next;
        });
      })
      .catch(() => requestedHistory.current.delete(taskId));
  }, []);

  /** The merged transcript for a set of tasks (one session's worth). */
  const getTranscript = useCallback((taskIds: string[]): TranscriptEntry[] => {
    const all: TranscriptEntry[] = [];
    const seen = new Set<number>();
    for (const id of taskIds) {
      for (const entry of transcripts.get(id) ?? []) {
        if (seen.has(entry.seq)) continue;
        seen.add(entry.seq);
        all.push(entry);
      }
    }
    return all.sort((a, b) => a.seq - b.seq);
  }, [transcripts]);

  return { state, getTranscript, loadTranscript };
}

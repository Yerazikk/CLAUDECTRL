// WebSocket event protocol between server and client

import type { Task, Repository, Session, Message, Decision, UsageSnapshot, Preview } from './types';

export type ServerEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.started'; task: Task }
  | { type: 'task.status'; taskId: string; status: Task['status']; message?: string }
  | { type: 'task.ready_for_review'; task: Task }
  | { type: 'task.done'; task: Task }
  | { type: 'task.failed'; taskId: string; error: string }
  | { type: 'task.stopped'; taskId: string }
  | { type: 'task.paused'; taskId: string }
  | { type: 'task.archived'; taskId: string; archived: boolean }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'task.output'; taskId: string; line: string }
  | { type: 'session.started'; session: Session }
  | { type: 'session.resumed'; session: Session }
  | { type: 'session.stopped'; sessionId: string }
  | { type: 'repo.updated'; repo: Repository }
  | { type: 'message.created'; message: Message }
  | { type: 'git.branch_created'; repoId: string; branch: string }
  | { type: 'git.commit_created'; repoId: string; branch: string; message: string }
  | { type: 'git.push'; repoId: string; branch: string }
  | { type: 'git.merge'; repoId: string; from: string; into: string }
  | { type: 'preview.started'; preview: Preview }
  | { type: 'preview.stopped'; previewId: string }
  | { type: 'decision.requested'; decision: Decision }
  | { type: 'usage.updated'; usage: UsageSnapshot }
  | { type: 'server.shutdown' }
  | { type: 'server.restart_needed' }
  | { type: 'state.snapshot'; data: StateSnapshot };

export interface StateSnapshot {
  repos: Repository[];
  tasks: Task[];
  sessions: Session[];
  usage: UsageSnapshot | null;
  previews: Preview[];
}

export type ClientEvent =
  | { type: 'subscribe'; repoId?: string }
  | { type: 'ping' };

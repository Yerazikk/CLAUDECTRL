// Core domain types shared between server and web client

export type RepoStatus = 'idle' | 'working' | 'validating' | 'ready_for_review' | 'not_cloned';

export type TaskStatus =
  | 'queued'
  | 'working'
  | 'validating'
  | 'ready_for_review'
  | 'done'
  | 'failed'
  | 'stopped';

export type SessionStatus = 'active' | 'idle' | 'stopped';

export interface Repository {
  id: string;
  name: string;
  path: string;
  githubOwner: string | null;
  githubRepo: string | null;
  isCloned: boolean;
  status: RepoStatus;
  currentBranch: string | null;
  activeTaskId: string | null;
  previewUrl: string | null;
  lastActivityAt: string | null;
}

export interface Task {
  id: string;
  repoId: string;
  title: string;
  status: TaskStatus;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  lastMessage: string | null;
  lastResult: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Session {
  id: string;
  repoId: string;
  taskId: string | null;
  claudeSessionId: string | null;
  status: SessionStatus;
  title: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  taskId: string;
  sessionId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  taskId: string;
  prompt: string;
  options: string[] | null;
  resolved: boolean;
  response: string | null;
  createdAt: string;
}

export interface UsageSnapshot {
  id: string;
  hourlyUsed: number;
  hourlyLimit: number;
  hourlyResetAt: string | null;
  weeklyUsed: number;
  weeklyLimit: number;
  weeklyResetAt: string | null;
  raw: string | null;
  capturedAt: string;
}

export interface Preview {
  id: string;
  repoId: string;
  taskId: string | null;
  localUrl: string;
  proxyPath: string;
  active: boolean;
  createdAt: string;
}

export interface GitEvent {
  id: string;
  repoId: string;
  taskId: string | null;
  type: 'branch_created' | 'commit_created' | 'merge' | 'push' | 'worktree_created' | 'worktree_removed';
  ref: string | null;
  message: string | null;
  createdAt: string;
}

export interface AppSettings {
  reposDirectory: string;
  serverHost: string;
  serverPort: number;
  voiceEnabled: boolean;
  notificationsEnabled: boolean;
  vercelEnabled: boolean;
}

// Core domain types shared between server and web client

export type RepoStatus = 'idle' | 'working' | 'validating' | 'ready_for_review' | 'not_cloned';

export type TaskStatus =
  | 'queued'
  | 'working'
  | 'validating'
  | 'ready_for_review'
  | 'committing'
  | 'merging'
  | 'resolving_conflict'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'paused';

export type SessionStatus = 'active' | 'idle' | 'stopped';

export type ClaudeModel = 'default' | 'opus' | 'sonnet' | 'haiku';

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
  sessionRef: string | null;
  lastMessage: string | null;
  lastResult: string | null;
  commitMessage: string | null;
  branchSlug: string | null;
  model: string | null;
  /** False when the session works directly in the repo checkout instead of a worktree */
  useWorktree: boolean;
  archived: boolean;
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
  branch: string | null;
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

/**
 * One line in a session's compressed transcript.
 *
 * The transcript is a deterministic, filtered projection of Claude's raw
 * stream-json output — Claude's own words are preserved verbatim, tool
 * execution is collapsed to a single line, and tool internals (diffs,
 * command strings, stdout/stderr) are dropped entirely.
 */
export type TranscriptKind =
  | 'user'    // a message you sent (right side)
  | 'text'    // Claude's narration / final answer (left side)
  | 'tool'    // one collapsed tool activity line
  | 'turn'    // end-of-response footer: duration + tokens
  | 'error'   // a run that failed
  | 'notice'; // system note, e.g. "Context cleared"

export interface TranscriptEntry {
  /** Globally monotonic — also the ordering key and the client-side identity */
  seq: number;
  taskId: string;
  sessionRef: string | null;
  kind: TranscriptKind;
  /** Prose for user/text/error/notice entries */
  text: string | null;
  /** Tool identity for 'tool' entries: 'Update' | 'Write' | 'Read' | 'Bash' | ... */
  label: string | null;
  /** File the tool touched, repo-relative where known */
  path: string | null;
  /** Sub-line under a tool, e.g. "Added 2 lines, removed 2 lines" */
  detail: string | null;
  /** Same edit size as `detail`, as numbers, for the card's totals */
  linesAdded: number | null;
  linesRemoved: number | null;
  /** How many consecutive identical activities this line stands for */
  count: number | null;
  durationMs: number | null;
  tokens: number | null;
  createdAt: string;
}

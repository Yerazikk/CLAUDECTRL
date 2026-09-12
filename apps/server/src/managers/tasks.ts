import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { newId } from '../utils/id';
import { getDb } from '../db';
import { broker } from '../services/events';
import { getConfig, loadRepoConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { runClaude } from './claude';
import { refreshUsage } from './usage';
import {
  getCurrentBranch,
  getDefaultBranch,
  createWorktree,
  removeWorktree,
  getWorktreeSiblingPath,
  getBranchName,
  mergeIntoMain,
  pushMain,
  commit,
  renameBranch,
} from './git';
import type { Task, Repository, Session } from '@claudectrl/shared';

// In-memory abort controllers for running tasks
const activeAbortControllers = new Map<string, AbortController>();

// Sessions with a task currently executing — guards against dequeuing a
// queued task while another task in the same session is still running
const sessionRunning = new Set<string>();

/**
 * Pick up the next queued task in a session, if nothing is already running
 * for it. Called whenever a task finishes in a state that allows the queue
 * to continue (i.e. not failed/paused/stopped), and whenever a new task is
 * queued into a session that's currently idle.
 */
function scheduleNextInSession(sessionRef: string, repo: Repository): void {
  if (sessionRunning.has(sessionRef)) return;
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM tasks WHERE session_ref = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1"
  ).get(sessionRef) as Record<string, unknown> | undefined;
  if (!row) return;

  const nextTask = dbRowToTask(row);
  sessionRunning.add(sessionRef);
  runTask(nextTask, repo, nextTask.lastMessage ?? nextTask.title, false, sessionRef).catch((err) => {
    logger.error(`Queued task ${nextTask.id} failed unexpectedly`, err);
  });
}

function dbRowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    repoId: row.repo_id as string,
    title: row.title as string,
    status: row.status as Task['status'],
    branch: row.branch as string | null,
    worktreePath: row.worktree_path as string | null,
    sessionId: row.session_id as string | null,
    sessionRef: row.session_ref as string | null,
    lastMessage: row.last_message as string | null,
    lastResult: row.last_result as string | null,
    commitMessage: row.commit_message as string | null,
    branchSlug: row.branch_slug as string | null,
    archived: Boolean(row.archived),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
  };
}

function dbRowToRepo(row: Record<string, unknown>): Repository {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    githubOwner: row.github_owner as string | null,
    githubRepo: row.github_repo as string | null,
    isCloned: Boolean(row.is_cloned),
    status: row.status as Repository['status'],
    currentBranch: row.current_branch as string | null,
    activeTaskId: row.active_task_id as string | null,
    previewUrl: row.preview_url as string | null,
    lastActivityAt: row.last_activity_at as string | null,
  };
}

function dbRowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    repoId: row.repo_id as string,
    taskId: row.task_id as string | null,
    claudeSessionId: row.claude_session_id as string | null,
    status: row.status as Session['status'],
    title: row.title as string | null,
    worktreePath: row.worktree_path as string | null,
    branch: row.branch as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getTask(taskId: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  return row ? dbRowToTask(row) : null;
}

export function getRepo(repoId: string): Repository | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as Record<string, unknown> | undefined;
  return row ? dbRowToRepo(row) : null;
}

export function getAllRepos(): Repository[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM repositories ORDER BY last_activity_at DESC').all() as Record<string, unknown>[]).map(dbRowToRepo);
}

export function getRepoTasks(repoId: string): Task[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM tasks WHERE repo_id = ? ORDER BY created_at DESC').all(repoId) as Record<string, unknown>[]).map(dbRowToTask);
}

export function getActiveTasks(): Task[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM tasks WHERE status IN ('queued','working','validating') ORDER BY created_at ASC").all() as Record<string, unknown>[]).map(dbRowToTask);
}

/** All non-archived tasks (for initial WS snapshot) */
export function getRecentTasks(): Task[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM tasks WHERE archived = 0 ORDER BY created_at DESC LIMIT 100").all() as Record<string, unknown>[]).map(dbRowToTask);
}

export function getSession(sessionId: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
  return row ? dbRowToSession(row) : null;
}

export function getRepoSessions(repoId: string): Session[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM sessions WHERE repo_id = ? ORDER BY created_at DESC').all(repoId) as Record<string, unknown>[]).map(dbRowToSession);
}

function updateTask(taskId: string, updates: Partial<Task>): Task {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.branch !== undefined) { fields.push('branch = ?'); values.push(updates.branch); }
  if (updates.worktreePath !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktreePath); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }
  if (updates.sessionRef !== undefined) { fields.push('session_ref = ?'); values.push(updates.sessionRef); }
  if (updates.lastMessage !== undefined) { fields.push('last_message = ?'); values.push(updates.lastMessage); }
  if (updates.lastResult !== undefined) { fields.push('last_result = ?'); values.push(updates.lastResult); }
  if (updates.commitMessage !== undefined) { fields.push('commit_message = ?'); values.push(updates.commitMessage); }
  if (updates.branchSlug !== undefined) { fields.push('branch_slug = ?'); values.push(updates.branchSlug); }
  if (updates.startedAt !== undefined) { fields.push('started_at = ?'); values.push(updates.startedAt); }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
  if (updates.archived !== undefined) { fields.push('archived = ?'); values.push(updates.archived ? 1 : 0); }
  fields.push("updated_at = datetime('now')");

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, taskId);
  return getTask(taskId)!;
}

function updateRepo(repoId: string, updates: Partial<Repository>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.currentBranch !== undefined) { fields.push('current_branch = ?'); values.push(updates.currentBranch); }
  if (updates.activeTaskId !== undefined) { fields.push('active_task_id = ?'); values.push(updates.activeTaskId); }
  if (updates.previewUrl !== undefined) { fields.push('preview_url = ?'); values.push(updates.previewUrl); }
  fields.push("last_activity_at = datetime('now')");
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE repositories SET ${fields.join(', ')} WHERE id = ?`).run(...values, repoId);
}

function updateSession(sessionId: string, updates: Partial<Session>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.taskId !== undefined) { fields.push('task_id = ?'); values.push(updates.taskId); }
  if (updates.claudeSessionId !== undefined) { fields.push('claude_session_id = ?'); values.push(updates.claudeSessionId); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.worktreePath !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktreePath); }
  if (updates.branch !== undefined) { fields.push('branch = ?'); values.push(updates.branch); }
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values, sessionId);
}

/** Derive repo status from its active tasks (no more hardcoded activeTaskId) */
export function deriveRepoStatus(repoId: string): Repository['status'] {
  const db = getDb();
  const statuses = (db.prepare(
    "SELECT DISTINCT status FROM tasks WHERE repo_id = ? AND status IN ('working','validating','committing','merging','resolving_conflict','queued','ready_for_review','paused')"
  ).all(repoId) as { status: string }[]).map(r => r.status);

  if (statuses.includes('working') || statuses.includes('validating') || statuses.includes('committing') || statuses.includes('merging') || statuses.includes('resolving_conflict')) return 'working';
  if (statuses.includes('queued')) return 'working';
  if (statuses.includes('ready_for_review')) return 'ready_for_review';
  return 'idle';
}

function syncRepoStatus(repoId: string): void {
  const status = deriveRepoStatus(repoId);
  updateRepo(repoId, { status });
  const repo = getRepo(repoId);
  if (repo) broker.publish({ type: 'repo.updated', repo });
}

function publishTaskStatus(task: Task, message?: string): void {
  broker.publish({ type: 'task.status', taskId: task.id, status: task.status, message });
  syncRepoStatus(task.repoId);
}

/**
 * Pull the trailing `COMMIT:` / `BRANCH:` metadata lines that the task prompt
 * asks Claude to append, and strip them out of the text shown to the user.
 */
function extractCommitMetadata(text: string): { commitMessage: string | null; branchSlug: string | null; cleaned: string } {
  const commitMatch = text.match(/^COMMIT:\s*(.+)$/im);
  const branchMatch = text.match(/^BRANCH:\s*(.+)$/im);

  const cleaned = text
    .replace(/^COMMIT:\s*.+$/im, '')
    .replace(/^BRANCH:\s*.+$/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const commitMessage = commitMatch
    ? commitMatch[1].trim().replace(/^["'`]|["'`]$/g, '').slice(0, 72)
    : null;

  const branchSlug = branchMatch
    ? branchMatch[1].trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
    : null;

  return { commitMessage: commitMessage || null, branchSlug: branchSlug || null, cleaned };
}

function loadPrompt(promptPath: string): string {
  const resolved = path.isAbsolute(promptPath) ? promptPath : path.resolve(process.cwd(), promptPath);
  if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf8');
  return '';
}

function buildPrompt(task: Task, repo: Repository, userMessage: string): string {
  const cfg = getConfig();
  const repoCfg = loadRepoConfig(repo.path);
  const wrapper = loadPrompt(cfg.prompts.task_wrapper);
  const repoInstructions = repoCfg.agent?.instructions ?? '';

  const projectCommands = repoCfg.commands ?? {};

  return [
    wrapper,
    repoInstructions ? `\n## Repository Instructions\n${repoInstructions}` : '',
    projectCommands.test ? `\nTest command: ${projectCommands.test}` : '',
    projectCommands.build ? `\nBuild command: ${projectCommands.build}` : '',
    projectCommands.lint ? `\nLint command: ${projectCommands.lint}` : '',
    '\n## Task\n',
    userMessage,
  ]
    .filter(Boolean)
    .join('\n');
}

// On server startup, mark any tasks that were interrupted mid-run as failed
export function recoverInterruptedTasks(): void {
  const db = getDb();
  const stuck = db.prepare(
    "SELECT * FROM tasks WHERE status IN ('working', 'queued', 'validating')"
  ).all() as Record<string, unknown>[];

  if (stuck.length === 0) return;

  logger.info(`Recovering ${stuck.length} interrupted task(s) from previous run`);
  for (const row of stuck) {
    const taskId = row.id as string;
    const repoId = row.repo_id as string;
    db.prepare(
      "UPDATE tasks SET status = 'failed', last_result = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run('Server restarted — task was interrupted', taskId);
    // Sync repo status via derive instead of hardcoding idle
    const status = deriveRepoStatus(repoId);
    updateRepo(repoId, { status, activeTaskId: null });
    logger.info(`Marked interrupted task ${taskId} as failed`);
  }
}

/**
 * Create a task, optionally within an existing session (for queuing).
 * If sessionRef is provided, the task joins that session's queue.
 * Otherwise, a new session + worktree is created.
 */
export async function createTask(repoId: string, userMessage: string, sessionRef?: string): Promise<Task> {
  const db = getDb();
  const repo = getRepo(repoId);
  if (!repo) throw new Error(`Repository ${repoId} not found`);

  const taskId = newId();
  const title = userMessage;

  db.prepare(`
    INSERT INTO tasks (id, repo_id, title, status, last_message, session_ref)
    VALUES (?, ?, ?, 'queued', ?, ?)
  `).run(taskId, repoId, title, userMessage, sessionRef ?? null);

  // Save user message
  db.prepare(`
    INSERT INTO messages (id, task_id, role, content)
    VALUES (?, ?, 'user', ?)
  `).run(newId(), taskId, userMessage);

  const task = getTask(taskId)!;
  broker.publish({ type: 'task.created', task });

  if (sessionRef) {
    // Queue within existing session — only starts if nothing else is running for it
    scheduleNextInSession(sessionRef, repo);
  } else {
    // New independent task — no lock needed, creates its own worktree
    runTask(task, repo, userMessage).catch((err) => {
      logger.error(`Task ${taskId} failed unexpectedly`, err);
    });
  }

  return task;
}

export async function submitFeedback(taskId: string, userMessage: string): Promise<void> {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const repo = getRepo(task.repoId);
  if (!repo) throw new Error(`Repo not found`);

  db.prepare(`
    INSERT INTO messages (id, task_id, role, content)
    VALUES (?, ?, 'user', ?)
  `).run(newId(), taskId, userMessage);

  const updated = updateTask(taskId, { status: 'working', lastMessage: userMessage });
  publishTaskStatus(updated, 'Resuming work...');

  runTask(updated, repo, userMessage, true).catch((err) => {
    logger.error(`Task ${taskId} feedback run failed`, err);
  });
}

export async function stopTask(taskId: string): Promise<void> {
  const controller = activeAbortControllers.get(taskId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(taskId);
  }
  const task = updateTask(taskId, { status: 'stopped', completedAt: new Date().toISOString() });
  publishTaskStatus(task);
  broker.publish({ type: 'task.stopped', taskId });
}

export async function pauseTask(taskId: string): Promise<void> {
  const controller = activeAbortControllers.get(taskId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(taskId);
  }
  const task = updateTask(taskId, { status: 'paused' });
  publishTaskStatus(task);
  broker.publish({ type: 'task.paused', taskId });
}

export async function resumeTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!['paused', 'stopped'].includes(task.status)) {
    throw new Error('Only paused or stopped tasks can be resumed');
  }
  if (!task.sessionId) {
    throw new Error('No Claude session to resume — use retry instead');
  }

  const repo = getRepo(task.repoId);
  if (!repo) throw new Error('Repo not found');

  const message = task.lastMessage ?? task.title;
  const updated = updateTask(taskId, { status: 'working', completedAt: null });
  publishTaskStatus(updated, 'Resuming...');

  runTask(updated, repo, message, true).catch((err) => {
    logger.error(`Task ${taskId} resume failed`, err);
  });
}

export async function archiveTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  updateTask(taskId, { archived: true });
  broker.publish({ type: 'task.archived', taskId, archived: true });
}

export async function unarchiveTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  updateTask(taskId, { archived: false });
  broker.publish({ type: 'task.archived', taskId, archived: false });
}

async function runTask(task: Task, repo: Repository, userMessage: string, isResume = false, sessionRef?: string): Promise<void> {
  const db = getDb();
  const controller = new AbortController();
  activeAbortControllers.set(task.id, controller);

  // Track which session this run belongs to so completion can safely
  // hand off to the next queued task (set below once known, for brand-new tasks)
  let effectiveSessionRef = task.sessionRef ?? sessionRef;
  if (effectiveSessionRef) sessionRunning.add(effectiveSessionRef);

  try {
    let workDir = repo.path;
    let branch = task.branch;
    let claudeSessionIdToResume: string | undefined;

    if (isResume) {
      // Resume: reuse existing worktree + session
      workDir = task.worktreePath ?? repo.path;
      branch = task.branch;
      claudeSessionIdToResume = task.sessionId ?? undefined;
    } else if (sessionRef) {
      // Queued task in existing session: reuse session's worktree + Claude session
      const session = getSession(sessionRef);
      if (session) {
        // Worktree may have been cleaned up after approval — fall back to repo.path
        const wtPath = session.worktreePath;
        workDir = (wtPath && fs.existsSync(wtPath)) ? wtPath : repo.path;
        branch = session.branch;
        claudeSessionIdToResume = session.claudeSessionId ?? undefined;
        updateTask(task.id, { worktreePath: workDir !== repo.path ? workDir : null, branch, sessionRef });
      }
    } else {
      // New task: create branch + worktree + session
      const branchType = detectBranchType(userMessage);
      const slug = userMessage.slice(0, 20).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
      branch = getBranchName(branchType, slug);

      broker.publish({ type: 'task.status', taskId: task.id, status: 'queued', message: 'Creating worktree...' });

      const worktreePath = getWorktreeSiblingPath(repo.path, branch);
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

      try {
        if (fs.existsSync(worktreePath)) {
          logger.warn(`Stale worktree found at ${worktreePath}, cleaning up before recreating`);
          removeWorktree(repo.path, worktreePath);
        }
        createWorktree(repo.path, branch, worktreePath);
        workDir = worktreePath;

        db.prepare('DELETE FROM worktrees WHERE path = ?').run(worktreePath);
        db.prepare(`
          INSERT INTO worktrees (id, repo_id, task_id, path, branch, active)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(newId(), repo.id, task.id, worktreePath, branch);

        broker.publish({ type: 'git.branch_created', repoId: repo.id, branch });
      } catch (e) {
        logger.warn(`Worktree creation failed, using main checkout: ${e}`);
        workDir = repo.path;
        branch = null;
      }

      // Create the session record
      const sessId = newId();
      db.prepare(`
        INSERT INTO sessions (id, repo_id, task_id, claude_session_id, status, title, worktree_path, branch)
        VALUES (?, ?, ?, NULL, 'active', ?, ?, ?)
      `).run(sessId, repo.id, task.id, task.title, workDir !== repo.path ? workDir : null, branch);
      updateTask(task.id, { sessionRef: sessId });
      // Update local reference for this run
      sessionRef = sessId;
      effectiveSessionRef = sessId;
      sessionRunning.add(sessId);
    }

    const updatedTask = updateTask(task.id, {
      status: 'working',
      branch,
      worktreePath: workDir !== repo.path ? workDir : task.worktreePath,
      startedAt: task.startedAt ?? new Date().toISOString(),
    });

    syncRepoStatus(repo.id);
    publishTaskStatus(updatedTask, 'Starting Claude...');
    broker.publish({ type: 'task.started', task: updatedTask });

    const prompt = buildPrompt(updatedTask, repo, userMessage);

    const result = await runClaude({
      taskId: task.id,
      workDir,
      prompt,
      sessionId: claudeSessionIdToResume,
      onStatusUpdate: (status) => {
        broker.publish({ type: 'task.status', taskId: task.id, status: 'working', message: status });
      },
      onSessionId: (claudeSessId) => {
        updateTask(task.id, { sessionId: claudeSessId });
        // Update the session record with Claude's session ID
        if (sessionRef) {
          updateSession(sessionRef, { claudeSessionId: claudeSessId, taskId: task.id });
        }
      },
      signal: controller.signal,
    });

    if (controller.signal.aborted) return; // Was stopped/paused

    if (result.sessionId) {
      updateTask(task.id, { sessionId: result.sessionId });
      if (sessionRef) {
        updateSession(sessionRef, { claudeSessionId: result.sessionId });
      }
    }

    // Save assistant response — pull out the COMMIT:/BRANCH: metadata the
    // prompt asks for so it doesn't show up in the text shown to the user
    if (result.resultText) {
      const { commitMessage, branchSlug, cleaned } = extractCommitMetadata(result.resultText);
      const displayText = cleaned || result.resultText;

      db.prepare(`
        INSERT INTO messages (id, task_id, role, content)
        VALUES (?, ?, 'assistant', ?)
      `).run(newId(), task.id, displayText);

      updateTask(task.id, {
        lastResult: displayText,
        ...(commitMessage ? { commitMessage } : {}),
        ...(branchSlug ? { branchSlug } : {}),
      });
    }

    if (!result.success) {
      const failed = updateTask(task.id, { status: 'failed', completedAt: new Date().toISOString() });
      syncRepoStatus(repo.id);
      publishTaskStatus(failed, result.error);
      broker.publish({ type: 'task.failed', taskId: task.id, error: result.error ?? 'Unknown error' });
      return;
    }

    // Validate
    await runValidation(task.id, repo, workDir, sessionRef);

  } catch (err: unknown) {
    if (controller.signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Task ${task.id} error`, err);
    const failed = updateTask(task.id, { status: 'failed', completedAt: new Date().toISOString() });
    syncRepoStatus(task.repoId);
    publishTaskStatus(failed, msg);
    broker.publish({ type: 'task.failed', taskId: task.id, error: msg });
  } finally {
    activeAbortControllers.delete(task.id);
    refreshUsage().catch(() => {});

    if (effectiveSessionRef) {
      sessionRunning.delete(effectiveSessionRef);
      const finalTask = getTask(task.id);
      if (finalTask && !['failed', 'paused', 'stopped'].includes(finalTask.status)) {
        scheduleNextInSession(effectiveSessionRef, repo);
      }
    }
  }
}

function detectBranchType(message: string): 'feature' | 'fix' | 'refactor' {
  const lower = message.toLowerCase();
  if (lower.match(/\b(fix|bug|error|issue|crash|broken|fail)\b/)) return 'fix';
  if (lower.match(/\b(refactor|cleanup|clean up|reorganize|restructure)\b/)) return 'refactor';
  return 'feature';
}

async function runValidation(taskId: string, repo: Repository, workDir: string, sessionRef?: string): Promise<void> {
  const db = getDb();
  const cfg = getConfig();
  const repoCfg = loadRepoConfig(repo.path);
  const commands = repoCfg.commands ?? cfg.commands ?? {};

  const validationCmds = [commands.lint, commands.test, commands.build].filter(Boolean) as string[];

  if (validationCmds.length === 0) {
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf8'));
        if (pkgJson.scripts?.test) validationCmds.push('npm test');
        if (pkgJson.scripts?.build) validationCmds.push('npm run build');
        if (pkgJson.scripts?.lint) validationCmds.push('npm run lint');
      } catch {}
    }
  }

  if (validationCmds.length === 0) {
    await markReadyForReview(taskId, repo);
    return;
  }

  const task = getTask(taskId);
  if (!task) return;

  const validating = updateTask(taskId, { status: 'validating' });
  publishTaskStatus(validating, 'Running validation...');

  for (const cmd of validationCmds) {
    try {
      execSync(cmd, { cwd: workDir, stdio: 'pipe', timeout: 120_000 });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.warn(`Validation failed for task ${taskId}: ${cmd}`, errMsg);

      const currentTask = getTask(taskId);
      if (!currentTask) return;

      const fixPrompt = `Validation failed with: ${errMsg}\n\nFix the issue and ensure all validation passes. Run the validation commands again to confirm.`;
      const result = await runClaude({
        taskId,
        workDir,
        prompt: fixPrompt,
        sessionId: currentTask.sessionId ?? undefined,
        onStatusUpdate: (status) => {
          broker.publish({ type: 'task.status', taskId, status: 'working', message: status });
        },
        onSessionId: (claudeSessId) => {
          updateTask(taskId, { sessionId: claudeSessId });
          if (sessionRef) {
            updateSession(sessionRef, { claudeSessionId: claudeSessId });
          }
        },
      });

      if (!result.success) {
        const failed = updateTask(taskId, { status: 'failed', completedAt: new Date().toISOString() });
        syncRepoStatus(repo.id);
        publishTaskStatus(failed, 'Validation failed and could not be auto-fixed');
        broker.publish({ type: 'task.failed', taskId, error: 'Validation failed' });
        return;
      }
      await runValidation(taskId, repo, workDir, sessionRef);
      return;
    }
  }

  await markReadyForReview(taskId, repo);
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const active = ['working', 'validating', 'queued', 'committing', 'merging', 'resolving_conflict'];
  if (active.includes(task.status)) {
    throw new Error('Cannot delete an active task — stop it first');
  }

  // Clean up worktree if it exists and no other tasks use this session
  if (task.worktreePath && task.sessionRef) {
    const siblingTasks = (db.prepare(
      'SELECT id FROM tasks WHERE session_ref = ? AND id != ?'
    ).all(task.sessionRef, taskId) as { id: string }[]);
    if (siblingTasks.length === 0) {
      try {
        const repo = getRepo(task.repoId);
        if (repo) removeWorktree(repo.path, task.worktreePath);
      } catch (e) {
        logger.warn(`Worktree cleanup during delete failed for task ${taskId}`, e);
      }
      db.prepare('UPDATE worktrees SET active = 0 WHERE task_id = ?').run(taskId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(task.sessionRef);
    }
  }

  db.prepare('DELETE FROM messages WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

  broker.publish({ type: 'task.deleted', taskId });
  logger.info(`Deleted task ${taskId}`);
}

export function editQueuedTask(taskId: string, newMessage: string): Task {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'queued') throw new Error('Can only edit queued tasks');

  const title = newMessage;
  db.prepare(
    "UPDATE tasks SET title = ?, last_message = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, newMessage, taskId);

  // Update the latest user message for this task
  db.prepare(
    "UPDATE messages SET content = ? WHERE id = (SELECT id FROM messages WHERE task_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1)"
  ).run(newMessage, taskId);

  const updated = getTask(taskId)!;
  broker.publish({ type: 'task.created', task: updated });
  return updated;
}

export async function retryTask(taskId: string): Promise<Task> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const retryable = ['failed', 'stopped'];
  if (!retryable.includes(task.status)) {
    throw new Error('Only failed or stopped tasks can be retried');
  }

  const message = task.lastMessage ?? task.title;
  if (!message) throw new Error('No original message to retry with');

  return createTask(task.repoId, message);
}

async function markReadyForReview(taskId: string, repo: Repository): Promise<void> {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return;

  // If this session has more queued tasks, auto-complete without review so the
  // queue runs through uninterrupted. Only the last task in the queue gets reviewed.
  if (task.sessionRef) {
    const nextQueued = db.prepare(
      "SELECT id FROM tasks WHERE session_ref = ? AND id != ? AND status = 'queued' LIMIT 1"
    ).get(task.sessionRef, taskId) as { id: string } | undefined;

    if (nextQueued) {
      const done = updateTask(taskId, { status: 'done', completedAt: new Date().toISOString() });
      syncRepoStatus(repo.id);
      publishTaskStatus(done);
      broker.publish({ type: 'task.done', task: done });
      return;
    }
  }

  const updated = updateTask(taskId, { status: 'ready_for_review' });
  syncRepoStatus(repo.id);
  publishTaskStatus(updated);
  broker.publish({ type: 'task.ready_for_review', task: updated });
}

export async function approveTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const repo = getRepo(task.repoId);
  if (!repo) throw new Error('Repo not found');

  updateTask(taskId, { status: 'committing' });
  syncRepoStatus(repo.id);
  publishTaskStatus(getTask(taskId)!, 'Committing changes...');

  // Prefer the branch name Claude suggested (keeping the existing type prefix)
  // over the slug-of-the-first-message name it was created with
  let branch = task.branch;
  if (branch && task.branchSlug) {
    const prefix = branch.match(/^([a-z]+\/)/)?.[1] ?? '';
    const renamed = `${prefix}${task.branchSlug}`;
    if (renamed !== branch) {
      try {
        renameBranch(task.worktreePath ?? repo.path, branch, renamed);
        updateTask(taskId, { branch: renamed });
        if (task.sessionRef) updateSession(task.sessionRef, { branch: renamed });
        getDb().prepare('UPDATE worktrees SET branch = ? WHERE task_id = ?').run(renamed, taskId);
        branch = renamed;
      } catch (e) {
        logger.warn(`Branch rename failed for task ${taskId}`, e);
      }
    }
  }

  try {
    const workDir = task.worktreePath ?? repo.path;
    commit(workDir, task.commitMessage ?? task.title);

    if (branch) {
      updateTask(taskId, { status: 'merging' });
      syncRepoStatus(repo.id);
      publishTaskStatus(getTask(taskId)!, 'Merging into main...');

      try {
        mergeIntoMain(repo.path, branch);
        broker.publish({ type: 'git.merge', repoId: repo.id, from: branch, into: getDefaultBranch(repo.path) });
      } catch (e: unknown) {
        logger.warn(`Merge conflict during approval of task ${taskId}`, e);
        const errMsg = e instanceof Error ? e.message : String(e);

        updateTask(taskId, { status: 'resolving_conflict' });
        syncRepoStatus(repo.id);
        publishTaskStatus(getTask(taskId)!, 'Merge conflict detected — asking Claude to fix it...');

        const result = await runClaude({
          taskId,
          workDir: repo.path,
          prompt: `There's a merge conflict when merging ${branch} into main. Error: ${errMsg}\n\nResolve all merge conflicts, commit the resolution, and ensure the code is working.`,
          sessionId: task.sessionId ?? undefined,
          onStatusUpdate: (status) => {
            broker.publish({ type: 'task.status', taskId, status: 'resolving_conflict', message: status });
          },
        });

        if (!result.success) {
          const failed = updateTask(taskId, { status: 'failed', completedAt: new Date().toISOString() });
          publishTaskStatus(failed, 'Merge conflict could not be resolved');
          broker.publish({ type: 'task.failed', taskId, error: 'Merge conflict unresolved' });
          return;
        }
      }
    }

    const cfg = getConfig();
    if (cfg.git.approval.push_main) {
      try {
        pushMain(repo.path);
        broker.publish({ type: 'git.push', repoId: repo.id, branch: getDefaultBranch(repo.path) });
      } catch (e) {
        logger.warn(`Push failed for task ${taskId}`, e);
      }
    }

    // Clean up worktree only if no other tasks use this session
    if (task.worktreePath && branch && task.sessionRef) {
      const db = getDb();
      const queuedInSession = (db.prepare(
        "SELECT id FROM tasks WHERE session_ref = ? AND id != ? AND status IN ('queued', 'working', 'validating', 'paused')"
      ).all(task.sessionRef, taskId) as { id: string }[]);

      if (queuedInSession.length === 0) {
        try {
          removeWorktree(repo.path, task.worktreePath);
          getDb().prepare('UPDATE worktrees SET active = 0 WHERE task_id = ?').run(taskId);
          broker.publish({ type: 'git.branch_created', repoId: repo.id, branch: `removed:${branch}` });
        } catch (e) {
          logger.warn(`Worktree cleanup failed for task ${taskId}`, e);
        }
      }
    }

    const done = updateTask(taskId, { status: 'done', completedAt: new Date().toISOString() });
    syncRepoStatus(repo.id);
    publishTaskStatus(done);
    broker.publish({ type: 'task.done', task: done });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Approval failed for task ${taskId}`, err);
    const failed = updateTask(taskId, { status: 'failed', completedAt: new Date().toISOString() });
    syncRepoStatus(repo.id);
    publishTaskStatus(failed, msg);
    broker.publish({ type: 'task.failed', taskId, error: msg });
  }
}

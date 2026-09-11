import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { newId } from '../utils/id';
import { getDb } from '../db';
import { broker } from '../services/events';
import { getConfig, loadRepoConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { runClaude } from './claude';
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
} from './git';
import type { Task, Repository } from '@claudectrl/shared';

// In-memory abort controllers for running tasks
const activeAbortControllers = new Map<string, AbortController>();

// Per-repo task execution lock: prevents concurrent same-checkout runs
// key = repoId, value = promise of the current running task
const repoLocks = new Map<string, Promise<void>>();

async function withRepoLock(repoId: string, fn: () => Promise<void>): Promise<void> {
  const existing = repoLocks.get(repoId) ?? Promise.resolve();
  const next = existing.then(() => fn()).catch(() => {});
  repoLocks.set(repoId, next);
  await next;
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
    lastMessage: row.last_message as string | null,
    lastResult: row.last_result as string | null,
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

function updateTask(taskId: string, updates: Partial<Task>): Task {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.branch !== undefined) { fields.push('branch = ?'); values.push(updates.branch); }
  if (updates.worktreePath !== undefined) { fields.push('worktree_path = ?'); values.push(updates.worktreePath); }
  if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId); }
  if (updates.lastMessage !== undefined) { fields.push('last_message = ?'); values.push(updates.lastMessage); }
  if (updates.lastResult !== undefined) { fields.push('last_result = ?'); values.push(updates.lastResult); }
  if (updates.startedAt !== undefined) { fields.push('started_at = ?'); values.push(updates.startedAt); }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
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

function publishTaskStatus(task: Task, message?: string): void {
  broker.publish({ type: 'task.status', taskId: task.id, status: task.status, message });
  const repo = getRepo(task.repoId);
  if (repo) broker.publish({ type: 'repo.updated', repo });
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
    db.prepare(
      "UPDATE repositories SET status = 'idle', active_task_id = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(repoId);
    logger.info(`Marked interrupted task ${taskId} as failed`);
  }
}

export async function createTask(repoId: string, userMessage: string): Promise<Task> {
  const db = getDb();
  const repo = getRepo(repoId);
  if (!repo) throw new Error(`Repository ${repoId} not found`);

  const taskId = newId();
  const title = userMessage.slice(0, 80);

  db.prepare(`
    INSERT INTO tasks (id, repo_id, title, status, last_message)
    VALUES (?, ?, ?, 'queued', ?)
  `).run(taskId, repoId, title, userMessage);

  // Save user message
  db.prepare(`
    INSERT INTO messages (id, task_id, role, content)
    VALUES (?, ?, 'user', ?)
  `).run(newId(), taskId, userMessage);

  const task = getTask(taskId)!;
  broker.publish({ type: 'task.created', task });

  // Start task in background, serialized per repo (tasks with worktrees don't block other worktree tasks)
  withRepoLock(repoId, () => runTask(task, repo, userMessage)).catch((err) => {
    logger.error(`Task ${taskId} failed unexpectedly`, err);
  });

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

async function runTask(task: Task, repo: Repository, userMessage: string, isResume = false): Promise<void> {
  const db = getDb();
  const controller = new AbortController();
  activeAbortControllers.set(task.id, controller);

  try {
    // Determine working directory (use worktree if exists, else create one for new tasks)
    let workDir = repo.path;
    let branch = task.branch;

    if (!isResume) {
      // Create branch + worktree for new tasks
      const branchType = detectBranchType(userMessage);
      const slug = userMessage.slice(0, 20).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
      branch = getBranchName(branchType, slug);

      broker.publish({ type: 'task.status', taskId: task.id, status: 'queued', message: 'Creating worktree...' });

      const worktreePath = getWorktreeSiblingPath(repo.path, branch);
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

      try {
        // Clean up stale worktree from a previous crashed run if it already exists
        if (fs.existsSync(worktreePath)) {
          logger.warn(`Stale worktree found at ${worktreePath}, cleaning up before recreating`);
          removeWorktree(repo.path, worktreePath);
        }
        createWorktree(repo.path, branch, worktreePath);
        workDir = worktreePath;

        // Remove any stale DB row for this path before inserting
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
    } else {
      workDir = task.worktreePath ?? repo.path;
      branch = task.branch;
    }

    const updatedTask = updateTask(task.id, {
      status: 'working',
      branch,
      worktreePath: workDir !== repo.path ? workDir : task.worktreePath,
      startedAt: task.startedAt ?? new Date().toISOString(),
    });

    updateRepo(repo.id, {
      status: 'working',
      activeTaskId: task.id,
      currentBranch: branch ?? getCurrentBranch(repo.path),
    });

    publishTaskStatus(updatedTask, 'Starting Claude...');
    broker.publish({ type: 'task.started', task: updatedTask });

    const prompt = buildPrompt(updatedTask, repo, userMessage);

    const result = await runClaude({
      taskId: task.id,
      workDir,
      prompt,
      sessionId: isResume ? task.sessionId ?? undefined : undefined,
      onStatusUpdate: (status) => {
        broker.publish({ type: 'task.status', taskId: task.id, status: 'working', message: status });
      },
      onSessionId: (sessionId) => {
        updateTask(task.id, { sessionId });
        db.prepare(`
          INSERT OR IGNORE INTO sessions (id, repo_id, task_id, claude_session_id, status, title)
          VALUES (?, ?, ?, ?, 'active', ?)
        `).run(newId(), repo.id, task.id, sessionId, task.title);
      },
      signal: controller.signal,
    });

    if (controller.signal.aborted) return; // Was stopped

    if (result.sessionId) {
      updateTask(task.id, { sessionId: result.sessionId });
    }

    // Save assistant response
    if (result.resultText) {
      db.prepare(`
        INSERT INTO messages (id, task_id, role, content)
        VALUES (?, ?, 'assistant', ?)
      `).run(newId(), task.id, result.resultText);

      updateTask(task.id, { lastResult: result.resultText.slice(0, 500) });
    }

    if (!result.success) {
      const failed = updateTask(task.id, { status: 'failed', completedAt: new Date().toISOString() });
      updateRepo(repo.id, { status: 'idle', activeTaskId: null });
      publishTaskStatus(failed, result.error);
      broker.publish({ type: 'task.failed', taskId: task.id, error: result.error ?? 'Unknown error' });
      return;
    }

    // Validate
    await runValidation(task.id, repo, workDir);

  } catch (err: unknown) {
    if (controller.signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Task ${task.id} error`, err);
    const failed = updateTask(task.id, { status: 'failed', completedAt: new Date().toISOString() });
    updateRepo(task.repoId, { status: 'idle', activeTaskId: null });
    publishTaskStatus(failed, msg);
    broker.publish({ type: 'task.failed', taskId: task.id, error: msg });
  } finally {
    activeAbortControllers.delete(task.id);
  }
}

function detectBranchType(message: string): 'feature' | 'fix' | 'refactor' {
  const lower = message.toLowerCase();
  if (lower.match(/\b(fix|bug|error|issue|crash|broken|fail)\b/)) return 'fix';
  if (lower.match(/\b(refactor|cleanup|clean up|reorganize|restructure)\b/)) return 'refactor';
  return 'feature';
}

async function runValidation(taskId: string, repo: Repository, workDir: string): Promise<void> {
  const db = getDb();
  const cfg = getConfig();
  const repoCfg = loadRepoConfig(repo.path);
  const commands = repoCfg.commands ?? cfg.commands ?? {};

  const validationCmds = [commands.lint, commands.test, commands.build].filter(Boolean) as string[];

  if (validationCmds.length === 0) {
    // Auto-detect
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
    // No validation commands, go directly to review
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

      // Ask Claude to fix
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
        onSessionId: (sessionId) => {
          updateTask(taskId, { sessionId });
        },
      });

      if (!result.success) {
        const failed = updateTask(taskId, { status: 'failed', completedAt: new Date().toISOString() });
        updateRepo(repo.id, { status: 'idle', activeTaskId: null });
        publishTaskStatus(failed, 'Validation failed and could not be auto-fixed');
        broker.publish({ type: 'task.failed', taskId, error: 'Validation failed' });
        return;
      }
      // Retry validation from start
      await runValidation(taskId, repo, workDir);
      return;
    }
  }

  await markReadyForReview(taskId, repo);
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const active = ['working', 'validating', 'queued'];
  if (active.includes(task.status)) {
    throw new Error('Cannot delete an active task — stop it first');
  }

  // Clean up worktree if it exists
  if (task.worktreePath) {
    try {
      const repo = getRepo(task.repoId);
      if (repo) removeWorktree(repo.path, task.worktreePath);
    } catch (e) {
      logger.warn(`Worktree cleanup during delete failed for task ${taskId}`, e);
    }
    db.prepare('UPDATE worktrees SET active = 0 WHERE task_id = ?').run(taskId);
  }

  db.prepare('DELETE FROM messages WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM sessions WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

  broker.publish({ type: 'task.deleted', taskId });
  logger.info(`Deleted task ${taskId}`);
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
  const task = getTask(taskId);
  if (!task) return;
  const updated = updateTask(taskId, { status: 'ready_for_review' });
  updateRepo(repo.id, { status: 'ready_for_review' });
  publishTaskStatus(updated);
  broker.publish({ type: 'task.ready_for_review', task: updated });
}

export async function approveTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const repo = getRepo(task.repoId);
  if (!repo) throw new Error('Repo not found');

  updateTask(taskId, { status: 'working' });
  updateRepo(repo.id, { status: 'working' });
  publishTaskStatus(getTask(taskId)!, 'Merging into main...');

  try {
    // Ensure work is committed
    const workDir = task.worktreePath ?? repo.path;
    commit(workDir, task.title);

    // Merge branch into main
    if (task.branch) {
      try {
        mergeIntoMain(repo.path, task.branch);
        broker.publish({ type: 'git.merge', repoId: repo.id, from: task.branch, into: getDefaultBranch(repo.path) });
      } catch (e: unknown) {
        // Merge conflict - ask Claude to fix
        logger.warn(`Merge conflict during approval of task ${taskId}`, e);
        const errMsg = e instanceof Error ? e.message : String(e);

        const result = await runClaude({
          taskId,
          workDir: repo.path,
          prompt: `There's a merge conflict when merging ${task.branch} into main. Error: ${errMsg}\n\nResolve all merge conflicts, commit the resolution, and ensure the code is working.`,
          sessionId: task.sessionId ?? undefined,
          onStatusUpdate: (status) => {
            broker.publish({ type: 'task.status', taskId, status: 'working', message: status });
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

    // Push main
    const cfg = getConfig();
    if (cfg.git.approval.push_main) {
      try {
        pushMain(repo.path);
        broker.publish({ type: 'git.push', repoId: repo.id, branch: getDefaultBranch(repo.path) });
      } catch (e) {
        logger.warn(`Push failed for task ${taskId}`, e);
        // Non-fatal for now
      }
    }

    // Clean up worktree
    if (task.worktreePath && task.branch) {
      try {
        removeWorktree(repo.path, task.worktreePath);
        getDb().prepare('UPDATE worktrees SET active = 0 WHERE task_id = ?').run(taskId);
        broker.publish({ type: 'git.branch_created', repoId: repo.id, branch: `removed:${task.branch}` });
      } catch (e) {
        logger.warn(`Worktree cleanup failed for task ${taskId}`, e);
      }
    }

    const done = updateTask(taskId, { status: 'done', completedAt: new Date().toISOString() });
    updateRepo(repo.id, { status: 'idle', activeTaskId: null });
    publishTaskStatus(done);
    broker.publish({ type: 'task.done', task: done });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Approval failed for task ${taskId}`, err);
    const failed = updateTask(taskId, { status: 'failed', completedAt: new Date().toISOString() });
    updateRepo(repo.id, { status: 'idle', activeTaskId: null });
    publishTaskStatus(failed, msg);
    broker.publish({ type: 'task.failed', taskId, error: msg });
  }
}

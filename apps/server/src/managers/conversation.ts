/**
 * The back-and-forth with Claude.
 *
 * A session is one long conversation, not a one-shot job: Claude answers, you
 * reply, it answers again. This module owns two things about that exchange.
 *
 * 1. The record. Both sides go into `messages` and are broadcast as they land,
 *    so the thread is durable and readable from any device — not rebuilt from
 *    whatever a single browser happens to remember.
 *
 * 2. The distinction between an answer and new work. Claude runs as
 *    `claude --print` (one shot, stdin closed), so it can never block mid-run
 *    waiting on you: every question arrives as the end of a run, and your
 *    answer starts the next one, resumed into the same Claude session. When
 *    that next run only explains something and touches no code, it isn't work —
 *    it shouldn't drag a lint/test/build cycle behind it, and it shouldn't push
 *    the task into review. `noteReplyBaseline` + `consumeReplyBaseline` let the
 *    task runner tell those two cases apart by fingerprinting the worktree
 *    either side of the run.
 */
import fs from 'fs';
import { getDb } from '../db';
import { newId } from '../utils/id';
import { broker } from '../services/events';
import { fingerprintWorktree } from './git';
import { getTask, getRepo } from './tasks';
import type { Message, Task } from '@claudectrl/shared';

function dbRowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    sessionId: row.session_id as string | null,
    role: row.role as Message['role'],
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

/** Persist one side of the conversation and tell every connected client about it. */
export function insertMessage(taskId: string, role: Message['role'], content: string): Message {
  const db = getDb();
  const id = newId();
  const task = getTask(taskId);

  db.prepare(`
    INSERT INTO messages (id, task_id, session_id, role, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, taskId, task?.sessionRef ?? null, role, content);

  const message = dbRowToMessage(
    db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown>
  );
  broker.publish({ type: 'message.created', message });
  return message;
}

/** The conversation for one task, oldest first. */
export function getTaskMessages(taskId: string): Message[] {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(taskId) as Record<string, unknown>[]).map(dbRowToMessage);
}

/**
 * The conversation across every task in a session, oldest first — a session
 * card shows one thread even though queued follow-ups are separate task rows.
 */
export function getSessionMessages(sessionRef: string): Message[] {
  const db = getDb();
  return (db.prepare(`
    SELECT m.* FROM messages m
    JOIN tasks t ON t.id = m.task_id
    WHERE t.session_ref = ?
    ORDER BY m.created_at ASC, m.rowid ASC
  `).all(sessionRef) as Record<string, unknown>[]).map(dbRowToMessage);
}

/** The directory a task's Claude session actually runs in right now. */
export function resolveWorkDir(task: Task): string {
  const repo = getRepo(task.repoId);
  const fallback = repo?.path ?? process.cwd();
  return task.worktreePath && fs.existsSync(task.worktreePath) ? task.worktreePath : fallback;
}

/**
 * What the worktree looked like when a reply started, and where the task should
 * go back to if Claude only answers. Keyed by task, consumed by the run that
 * follows.
 */
interface ReplyBaseline {
  fingerprint: string | null;
  priorStatus: Task['status'];
}
const replyBaselines = new Map<string, ReplyBaseline>();

/** Record the pre-reply state of the worktree, before Claude is resumed. */
export function noteReplyBaseline(task: Task): void {
  replyBaselines.set(task.id, {
    fingerprint: fingerprintWorktree(resolveWorkDir(task)),
    priorStatus: task.status,
  });
}

export interface ReplyOutcome {
  /** The reply left the worktree byte-for-byte as it found it */
  unchanged: boolean;
  /** Status the task held before you asked */
  priorStatus: Task['status'];
}

/**
 * Whether the run that just finished was a reply that changed nothing — Claude
 * answered a question, so there is nothing to lint, test, build or approve, and
 * the task belongs back in the state it was in before you asked.
 *
 * Returns null when this run wasn't a reply, or when no comparable snapshot
 * could be taken (in which case validate as usual). Consumes the baseline
 * either way, so it can only ever apply to a single run.
 */
export function consumeReplyBaseline(taskId: string, workDir: string): ReplyOutcome | null {
  const baseline = replyBaselines.get(taskId);
  if (!baseline) return null;
  replyBaselines.delete(taskId);

  if (!baseline.fingerprint) return null;
  return {
    unchanged: fingerprintWorktree(workDir) === baseline.fingerprint,
    priorStatus: baseline.priorStatus,
  };
}

export function clearReplyBaseline(taskId: string): void {
  replyBaselines.delete(taskId);
}

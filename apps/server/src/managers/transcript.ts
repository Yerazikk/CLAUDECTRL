/**
 * The session transcript: a deterministic, compressed projection of Claude's
 * raw stream-json output.
 *
 * This is NOT a summary — nothing here is re-written or generated. Claude's own
 * prose is stored verbatim; everything else is a filter:
 *
 *   Claude's narration / final answer  ->  kept, in full, in order
 *   Edit/Write on a file               ->  one line: Update(path) + line counts
 *   the diff itself                    ->  dropped
 *   Read                               ->  "Read N files" (consecutive ones merge)
 *   Bash(<command>)                    ->  "Bashing" (the command is dropped)
 *   stdout / stderr / tool results      ->  dropped
 *   end of a response                  ->  one footer line: duration + tokens
 *
 * Entries are persisted so a card survives a page reload or a server restart,
 * and are keyed by session so a queue of tasks reads as one continuous terminal.
 */
import { getDb } from '../db';
import { broker } from '../services/events';
import { logger } from '../utils/logger';
import { stripCommitMetadata } from '../utils/claudeText';
import type { TranscriptEntry, TranscriptKind } from '@claudectrl/shared';

/** Hard cap per task so a runaway loop can't grow the DB without bound */
const MAX_ENTRIES_PER_TASK = 2000;

interface NewEntry {
  kind: TranscriptKind;
  text?: string | null;
  label?: string | null;
  path?: string | null;
  detail?: string | null;
  linesAdded?: number | null;
  linesRemoved?: number | null;
  count?: number | null;
  durationMs?: number | null;
  tokens?: number | null;
}

/** Last written line per task, so consecutive identical activity merges into it */
const lastLine = new Map<string, { seq: number; label: string }>();

function rowToEntry(row: Record<string, unknown>): TranscriptEntry {
  return {
    seq: row.seq as number,
    taskId: row.task_id as string,
    sessionRef: row.session_ref as string | null,
    kind: row.kind as TranscriptKind,
    text: row.text as string | null,
    label: row.label as string | null,
    path: row.path as string | null,
    detail: row.detail as string | null,
    linesAdded: row.lines_added as number | null,
    linesRemoved: row.lines_removed as number | null,
    count: row.count as number | null,
    durationMs: row.duration_ms as number | null,
    tokens: row.tokens as number | null,
    createdAt: row.created_at as string,
  };
}

function getEntry(seq: number): TranscriptEntry | null {
  const row = getDb().prepare('SELECT * FROM transcript_entries WHERE seq = ?')
    .get(seq) as Record<string, unknown> | undefined;
  return row ? rowToEntry(row) : null;
}

function sessionRefOf(taskId: string): string | null {
  const task = getDb().prepare('SELECT session_ref FROM tasks WHERE id = ?')
    .get(taskId) as { session_ref: string | null } | undefined;
  return task?.session_ref ?? null;
}

function entryCount(taskId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM transcript_entries WHERE task_id = ?')
    .get(taskId) as { n: number };
  return row.n;
}

/** Append one line to a task's transcript and push it to every connected client. */
export function appendEntry(taskId: string, entry: NewEntry): TranscriptEntry | null {
  try {
    if (entryCount(taskId) >= MAX_ENTRIES_PER_TASK) return null;

    const info = getDb().prepare(`
      INSERT INTO transcript_entries
        (task_id, session_ref, kind, text, label, path, detail, lines_added, lines_removed, count, duration_ms, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      sessionRefOf(taskId),
      entry.kind,
      entry.text ?? null,
      entry.label ?? null,
      entry.path ?? null,
      entry.detail ?? null,
      entry.linesAdded ?? null,
      entry.linesRemoved ?? null,
      entry.count ?? null,
      entry.durationMs ?? null,
      entry.tokens ?? null,
    );

    const seq = Number(info.lastInsertRowid);
    if (entry.kind === 'tool' && entry.label) {
      lastLine.set(taskId, { seq, label: entry.label });
    } else {
      lastLine.delete(taskId);
    }

    const saved = getEntry(seq);
    if (saved) broker.publish({ type: 'task.transcript', entry: saved });
    return saved;
  } catch (e) {
    logger.warn(`Transcript append failed for task ${taskId}`, e);
    return null;
  }
}

/** Bump the count on the previous line instead of adding a near-identical one. */
function bumpLastLine(seq: number): void {
  getDb().prepare('UPDATE transcript_entries SET count = COALESCE(count, 1) + 1 WHERE seq = ?').run(seq);
  const updated = getEntry(seq);
  if (updated) broker.publish({ type: 'task.transcript', entry: updated });
}

export function appendUserMessage(taskId: string, text: string): void {
  appendEntry(taskId, { kind: 'user', text });
}

export function appendNotice(taskId: string, text: string): void {
  appendEntry(taskId, { kind: 'notice', text });
}

export function appendError(taskId: string, text: string): void {
  appendEntry(taskId, { kind: 'error', text });
}

/**
 * Backfill session_ref on entries written before the session row existed
 * (the first user message is stored the moment a task is created).
 */
export function attachSessionRef(taskId: string, sessionRef: string): void {
  getDb().prepare('UPDATE transcript_entries SET session_ref = ? WHERE task_id = ? AND session_ref IS NULL')
    .run(sessionRef, taskId);
}

/**
 * The whole session's transcript when the task belongs to one, so queued
 * follow-ups read as a continuation rather than a separate card.
 */
export function getTranscript(taskId: string): TranscriptEntry[] {
  const db = getDb();
  const sessionRef = sessionRefOf(taskId);
  const rows = sessionRef
    ? db.prepare('SELECT * FROM transcript_entries WHERE session_ref = ? OR task_id = ? ORDER BY seq ASC')
        .all(sessionRef, taskId) as Record<string, unknown>[]
    : db.prepare('SELECT * FROM transcript_entries WHERE task_id = ? ORDER BY seq ASC')
        .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/** Wipe the visible transcript for a task's whole session (the Clear button). */
export function clearTranscript(taskId: string): void {
  const db = getDb();
  const sessionRef = sessionRefOf(taskId);
  if (sessionRef) {
    const taskIds = (db.prepare('SELECT id FROM tasks WHERE session_ref = ?')
      .all(sessionRef) as { id: string }[]).map((r) => r.id);
    db.prepare('DELETE FROM transcript_entries WHERE session_ref = ? OR task_id = ?').run(sessionRef, taskId);
    for (const id of taskIds) lastLine.delete(id);
  } else {
    db.prepare('DELETE FROM transcript_entries WHERE task_id = ?').run(taskId);
  }
  lastLine.delete(taskId);
  broker.publish({ type: 'task.transcript_cleared', taskId, sessionRef });
}

export function deleteTranscriptForTask(taskId: string): void {
  getDb().prepare('DELETE FROM transcript_entries WHERE task_id = ?').run(taskId);
  lastLine.delete(taskId);
}

// ---------------------------------------------------------------------------
// The transform itself — pure functions, no I/O, so they can be unit tested.
// ---------------------------------------------------------------------------

export interface ToolLine {
  label: string;
  path?: string;
  detail?: string;
  linesAdded?: number;
  linesRemoved?: number;
  /** Consecutive lines with the same label collapse into one with a count */
  mergeable: boolean;
}

function countLines(s: unknown): number {
  if (typeof s !== 'string' || s === '') return 0;
  return s.split('\n').length;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Added 2 lines, removed 2 lines" — the same counts the CLI shows for an edit. */
function editDetail(added: number, removed: number): string | undefined {
  const parts: string[] = [];
  if (added) parts.push(`Added ${plural(added, 'line')}`);
  if (removed) parts.push(`removed ${plural(removed, 'line')}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** Trim an absolute path down to something repo-relative-looking. */
export function shortenPath(full: string, roots: string[] = []): string {
  if (!full) return '';
  const p = full.replace(/\\/g, '/');
  for (const root of roots) {
    if (!root) continue;
    const r = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1);
  }
  // Unknown root — keep the tail, which is what identifies the file anyway
  const parts = p.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : p;
}

/**
 * Collapse one tool call into a single transcript line. Returns null for tools
 * whose activity isn't worth a line of its own.
 */
export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
  roots: string[] = [],
): ToolLine | null {
  const filePath = typeof input.file_path === 'string' ? input.file_path
    : typeof input.path === 'string' ? input.path
    : typeof input.notebook_path === 'string' ? input.notebook_path
    : '';
  const short = shortenPath(filePath, roots);

  switch (name) {
    case 'Edit': {
      const removed = countLines(input.old_string);
      const added = countLines(input.new_string);
      return {
        label: 'Update', path: short, detail: editDetail(added, removed),
        linesAdded: added, linesRemoved: removed, mergeable: false,
      };
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [];
      let added = 0;
      let removed = 0;
      for (const e of edits) {
        removed += countLines(e.old_string);
        added += countLines(e.new_string);
      }
      return {
        label: 'Update', path: short, detail: editDetail(added, removed),
        linesAdded: added, linesRemoved: removed, mergeable: false,
      };
    }
    case 'Write': {
      const lines = countLines(input.content);
      return {
        label: 'Write',
        path: short,
        detail: lines ? `Wrote ${plural(lines, 'line')}` : undefined,
        linesAdded: lines,
        mergeable: false,
      };
    }
    case 'NotebookEdit':
      return { label: 'Update', path: short, mergeable: false };

    case 'Read':
      return { label: 'Read', mergeable: true };

    // The command and its output are exactly the noise we're dropping
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return { label: 'Bash', mergeable: true };

    case 'Glob':
    case 'Grep':
      return { label: 'Search', mergeable: true };

    case 'WebFetch':
    case 'WebSearch':
      return { label: 'Web', mergeable: true };

    case 'Task':
    case 'Agent':
      return { label: 'Agent', mergeable: true };

    case 'TodoWrite':
      return { label: 'Todo', mergeable: true };

    case 'Skill':
    case 'SlashCommand': {
      const skill = typeof input.skill === 'string' ? input.skill
        : typeof input.command === 'string' ? input.command : '';
      return { label: 'Skill', path: skill, mergeable: false };
    }

    case 'ExitPlanMode':
      return { label: 'Plan', mergeable: false };

    default:
      return { label: name || 'Tool', mergeable: true };
  }
}

// ---------------------------------------------------------------------------
// Ingestion — one raw stream-json line at a time, as Claude produces it.
// ---------------------------------------------------------------------------

interface StreamBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  message?: { content?: StreamBlock[] | string };
  usage?: Record<string, number>;
  duration_ms?: number;
  is_error?: boolean;
}

/** Where this task's files live, so paths can be shown repo-relative. */
function pathRootsFor(taskId: string): string[] {
  const row = getDb().prepare(`
    SELECT t.worktree_path AS wt, r.path AS repo
    FROM tasks t JOIN repositories r ON r.id = t.repo_id
    WHERE t.id = ?
  `).get(taskId) as { wt: string | null; repo: string | null } | undefined;
  return [row?.wt ?? '', row?.repo ?? ''].filter(Boolean);
}

const rootsCache = new Map<string, string[]>();

export function ingestClaudeLine(taskId: string, rawLine: string): void {
  let event: StreamEvent;
  try {
    event = JSON.parse(rawLine);
  } catch {
    return; // not JSON — nothing structured to show
  }

  if (event.type === 'assistant' && event.message?.content) {
    const blocks = Array.isArray(event.message.content) ? event.message.content : [];

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = stripCommitMetadata(block.text).trim();
        if (text) appendEntry(taskId, { kind: 'text', text });
        continue;
      }

      if (block.type === 'tool_use') {
        let roots = rootsCache.get(taskId);
        if (!roots) {
          roots = pathRootsFor(taskId);
          rootsCache.set(taskId, roots);
        }

        const tool = describeToolUse(block.name ?? '', block.input ?? {}, roots);
        if (!tool) continue;

        const prev = lastLine.get(taskId);
        if (tool.mergeable && prev && prev.label === tool.label) {
          bumpLastLine(prev.seq);
        } else {
          appendEntry(taskId, {
            kind: 'tool',
            label: tool.label,
            path: tool.path ?? null,
            detail: tool.detail ?? null,
            linesAdded: tool.linesAdded ?? null,
            linesRemoved: tool.linesRemoved ?? null,
            count: 1,
          });
        }
      }
    }
    return;
  }

  // End of one Claude invocation — the footer line (duration + tokens).
  // The `result` text itself is skipped: it duplicates the last text block.
  if (event.type === 'result') {
    const u = event.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
    appendEntry(taskId, {
      kind: 'turn',
      durationMs: event.duration_ms ?? null,
      tokens: tokens || null,
    });
    rootsCache.delete(taskId);
  }
}

/** Forget in-memory coalescing state for a task (it has stopped running). */
export function endTranscriptRun(taskId: string): void {
  lastLine.delete(taskId);
  rootsCache.delete(taskId);
}

import type { TranscriptEntry } from '@claudectrl/shared';

/**
 * Display helpers for the session transcript. The transform itself happens on
 * the server (apps/server/src/managers/transcript.ts) — everything here is
 * formatting only, so the card never invents information.
 */

export function formatDuration(ms: number): string {
  if (!ms) return '';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export function formatTokens(n: number): string {
  if (!n) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** "6:22 PM" */
export function formatClock(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The one line a collapsed tool activity shows, mirroring the CLI's wording. */
export function toolText(entry: TranscriptEntry): string {
  const n = entry.count ?? 1;
  const times = n > 1 ? ` ×${n}` : '';

  switch (entry.label) {
    case 'Read':
      return n > 1 ? `Read ${n} files` : 'Read 1 file';
    case 'Bash':
      return `Bashing${times}`;
    case 'Search':
      return `Searching${times}`;
    case 'Web':
      return `Fetching from the web${times}`;
    case 'Agent':
      return `Delegating${times}`;
    case 'Todo':
      return `Planning${times}`;
    case 'Plan':
      return 'Presenting a plan';
    case 'Skill':
      return entry.path ? `Skill(${entry.path})` : 'Running a skill';
    case 'Update':
    case 'Write':
      return entry.path ? `${entry.label}(${entry.path})` : entry.label;
    default:
      return `${entry.label ?? 'Tool'}${times}`;
  }
}

export interface SessionStats {
  tokens: number;
  durationMs: number;
  files: number;
  lines: number;
}

export function sessionStats(entries: TranscriptEntry[]): SessionStats {
  const files = new Set<string>();
  let tokens = 0;
  let durationMs = 0;
  let lines = 0;

  for (const e of entries) {
    if (e.kind === 'turn') {
      tokens += e.tokens ?? 0;
      durationMs += e.durationMs ?? 0;
    }
    if (e.kind === 'tool' && (e.label === 'Update' || e.label === 'Write')) {
      if (e.path) files.add(e.path);
      lines += (e.linesAdded ?? 0) + (e.linesRemoved ?? 0);
    }
  }

  return { tokens, durationMs, files: files.size, lines };
}

/**
 * What the session is doing right now — the newest activity line, shown next to
 * the pulsing dot while a task is running.
 */
export function liveAction(entries: TranscriptEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'turn') return ''; // the last response already finished
    if (e.kind === 'tool') return toolText(e);
    if (e.kind === 'text') return 'Writing...';
  }
  return '';
}

/** Everything Claude said this session, for the expanded read-through. */
export function fullText(entries: TranscriptEntry[]): string {
  return entries
    .filter((e) => e.kind === 'text' && e.text)
    .map((e) => e.text as string)
    .join('\n\n');
}

/** Merge one live entry into a list, replacing it if that seq is already there. */
export function mergeEntry(list: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const idx = list.findIndex((e) => e.seq === entry.seq);
  if (idx >= 0) {
    const next = list.slice();
    next[idx] = entry;
    return next;
  }
  // Append, keeping seq order (entries normally arrive in order)
  if (list.length === 0 || list[list.length - 1].seq < entry.seq) return [...list, entry];
  return [...list, entry].sort((a, b) => a.seq - b.seq);
}

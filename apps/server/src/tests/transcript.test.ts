import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { initDb, closeDb, getDb } from '../db';
import {
  describeToolUse,
  shortenPath,
  ingestClaudeLine,
  getTranscript,
  appendUserMessage,
  clearTranscript,
} from '../managers/transcript';
import { stripCommitMetadata } from '../utils/claudeText';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudectrl-transcript-'));
  initDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A task row the transcript can hang off */
function seedTask(taskId = 'task-1'): string {
  const db = getDb();
  db.prepare(`INSERT INTO repositories (id, name, path, is_cloned, status) VALUES ('r1', 'repo', ?, 1, 'idle')`)
    .run('C:/work/repo');
  db.prepare(`INSERT INTO tasks (id, repo_id, title, status) VALUES (?, 'r1', 'do a thing', 'working')`)
    .run(taskId);
  return taskId;
}

function assistant(...blocks: unknown[]): string {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}

describe('tool activity collapsing', () => {
  it('turns an Edit into Update(path) plus the line counts the CLI shows', () => {
    const line = describeToolUse('Edit', {
      file_path: 'C:/work/repo/apps/server/src/managers/tasks.ts',
      old_string: 'a\nb',
      new_string: 'c\nd',
    }, ['C:/work/repo']);

    expect(line).toMatchObject({
      label: 'Update',
      path: 'apps/server/src/managers/tasks.ts',
      detail: 'Added 2 lines, removed 2 lines',
      linesAdded: 2,
      linesRemoved: 2,
    });
  });

  it('reports a Write by how much it wrote', () => {
    const line = describeToolUse('Write', { file_path: '/repo/new.ts', content: 'x\ny\nz' });
    expect(line?.label).toBe('Write');
    expect(line?.detail).toBe('Wrote 3 lines');
  });

  it('sums a MultiEdit across its edits', () => {
    const line = describeToolUse('MultiEdit', {
      file_path: '/repo/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b\nc' },
        { old_string: 'd\ne', new_string: 'f' },
      ],
    });
    expect(line?.linesAdded).toBe(3);
    expect(line?.linesRemoved).toBe(3);
  });

  it('drops the bash command entirely', () => {
    const line = describeToolUse('Bash', { command: 'npm test -- --reporter=verbose' });
    expect(line).toMatchObject({ label: 'Bash', mergeable: true });
    expect(JSON.stringify(line)).not.toContain('npm test');
  });

  it('keeps a path readable when the root is unknown', () => {
    expect(shortenPath('C:/elsewhere/deep/nested/tree/file.ts')).toBe('nested/tree/file.ts');
    expect(shortenPath('C:/work/repo/src/a.ts', ['C:/work/repo'])).toBe('src/a.ts');
  });
});

describe('ingesting a stream', () => {
  it('keeps Claude prose verbatim and collapses tools around it', () => {
    const taskId = seedTask();

    ingestClaudeLine(taskId, assistant({ type: 'text', text: "Now let's update the prompt:" }));
    ingestClaudeLine(taskId, assistant({
      type: 'tool_use',
      name: 'Edit',
      input: { file_path: 'C:/work/repo/prompts/task.md', old_string: 'a', new_string: 'b\nc' },
    }));
    ingestClaudeLine(taskId, assistant({ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }));
    ingestClaudeLine(taskId, JSON.stringify({
      type: 'result',
      duration_ms: 5000,
      usage: { input_tokens: 100, output_tokens: 20 },
    }));

    const entries = getTranscript(taskId);
    expect(entries.map((e) => e.kind)).toEqual(['text', 'tool', 'tool', 'turn']);
    expect(entries[0].text).toBe("Now let's update the prompt:");
    expect(entries[1]).toMatchObject({ label: 'Update', path: 'prompts/task.md' });
    expect(entries[2].label).toBe('Bash');
    expect(entries[3]).toMatchObject({ durationMs: 5000, tokens: 120 });
  });

  it('merges consecutive reads into one counted line', () => {
    const taskId = seedTask();
    const read = assistant({ type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } });

    ingestClaudeLine(taskId, read);
    ingestClaudeLine(taskId, read);
    ingestClaudeLine(taskId, read);

    const tools = getTranscript(taskId).filter((e) => e.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ label: 'Read', count: 3 });
  });

  it('does not merge edits to different files', () => {
    const taskId = seedTask();
    ingestClaudeLine(taskId, assistant({ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } }));
    ingestClaudeLine(taskId, assistant({ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/b.ts', old_string: 'a', new_string: 'b' } }));
    expect(getTranscript(taskId).filter((e) => e.kind === 'tool')).toHaveLength(2);
  });

  it('never shows the COMMIT:/BRANCH: machine lines', () => {
    const taskId = seedTask();
    ingestClaudeLine(taskId, assistant({
      type: 'text',
      text: 'Fixed the reset handler.\n\nCOMMIT: fix reset handler firing twice\nBRANCH: fix-reset-handler',
    }));

    const text = getTranscript(taskId)[0].text ?? '';
    expect(text).toBe('Fixed the reset handler.');
    expect(stripCommitMetadata('a\nCOMMIT: x\nBRANCH: y')).toBe('a');
  });

  it('ignores non-JSON and tool result lines', () => {
    const taskId = seedTask();
    ingestClaudeLine(taskId, 'not json at all');
    ingestClaudeLine(taskId, JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'thousands of lines of stdout' }] },
    }));
    expect(getTranscript(taskId)).toHaveLength(0);
  });
});

describe('session transcript', () => {
  it('reads as one thread across the tasks in a session', () => {
    const db = getDb();
    seedTask('t1');
    db.prepare(`INSERT INTO sessions (id, repo_id, task_id, status) VALUES ('s1', 'r1', 't1', 'active')`).run();
    db.prepare(`INSERT INTO tasks (id, repo_id, title, status, session_ref) VALUES ('t2', 'r1', 'next', 'queued', 's1')`).run();
    db.prepare(`UPDATE tasks SET session_ref = 's1' WHERE id = 't1'`).run();

    appendUserMessage('t1', 'first request');
    ingestClaudeLine('t1', assistant({ type: 'text', text: 'done' }));
    appendUserMessage('t2', 'follow-up');

    const entries = getTranscript('t2');
    expect(entries.map((e) => e.text)).toEqual(['first request', 'done', 'follow-up']);
  });

  it('clearing empties the whole session', () => {
    const taskId = seedTask();
    appendUserMessage(taskId, 'hello');
    expect(getTranscript(taskId)).toHaveLength(1);

    clearTranscript(taskId);
    expect(getTranscript(taskId)).toHaveLength(0);
  });
});

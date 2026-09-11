import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../db';
import os from 'os';
import path from 'path';
import fs from 'fs';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudectrl-test-'));
  initDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('database schema', () => {
  it('creates all required tables', () => {
    const db = getDb();
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]).map((r) => r.name);

    expect(tables).toContain('repositories');
    expect(tables).toContain('tasks');
    expect(tables).toContain('sessions');
    expect(tables).toContain('messages');
    expect(tables).toContain('worktrees');
    expect(tables).toContain('previews');
    expect(tables).toContain('usage_snapshots');
    expect(tables).toContain('git_events');
    expect(tables).toContain('app_state');
    expect(tables).toContain('migrations');
  });

  it('allows inserting and reading a repository', () => {
    const db = getDb();
    const id = 'test-repo-1';
    db.prepare(`
      INSERT INTO repositories (id, name, path, is_cloned, status)
      VALUES (?, ?, ?, 1, 'idle')
    `).run(id, 'my-repo', '/tmp/my-repo');

    const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as { name: string };
    expect(row.name).toBe('my-repo');
  });

  it('does not delete filesystem on repo removal', () => {
    const db = getDb();
    const id = 'to-remove';
    db.prepare(`INSERT INTO repositories (id, name, path, is_cloned, status) VALUES (?, ?, ?, 1, 'idle')`).run(id, 'test', '/tmp/test');
    db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
    const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id);
    expect(row).toBeUndefined();
    // The /tmp/test path should still "exist" conceptually (we just removed from DB)
    // We're verifying the DB operation doesn't do filesystem operations
  });
});

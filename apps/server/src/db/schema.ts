import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrations: Array<{ name: string; sql: string; }> = [
    {
      name: '001_initial',
      sql: `
        CREATE TABLE IF NOT EXISTS repositories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          github_owner TEXT,
          github_repo TEXT,
          is_cloned INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'idle',
          current_branch TEXT,
          active_task_id TEXT,
          preview_url TEXT,
          last_activity_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repositories(id),
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          branch TEXT,
          worktree_path TEXT,
          session_id TEXT,
          last_message TEXT,
          last_result TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repositories(id),
          task_id TEXT REFERENCES tasks(id),
          claude_session_id TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          title TEXT,
          worktree_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          session_id TEXT REFERENCES sessions(id),
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS decisions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          prompt TEXT NOT NULL,
          options TEXT,
          resolved INTEGER NOT NULL DEFAULT 0,
          response TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS worktrees (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repositories(id),
          task_id TEXT REFERENCES tasks(id),
          path TEXT NOT NULL UNIQUE,
          branch TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS previews (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repositories(id),
          task_id TEXT REFERENCES tasks(id),
          local_url TEXT NOT NULL,
          proxy_path TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS usage_snapshots (
          id TEXT PRIMARY KEY,
          hourly_used INTEGER,
          hourly_limit INTEGER,
          hourly_reset_at TEXT,
          weekly_used INTEGER,
          weekly_limit INTEGER,
          weekly_reset_at TEXT,
          raw TEXT,
          captured_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS git_events (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repositories(id),
          task_id TEXT REFERENCES tasks(id),
          type TEXT NOT NULL,
          ref TEXT,
          message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_sessions_repo_id ON sessions(repo_id);
        CREATE INDEX IF NOT EXISTS idx_messages_task_id ON messages(task_id);
        CREATE INDEX IF NOT EXISTS idx_git_events_repo_id ON git_events(repo_id);
      `,
    },
    {
      name: '002_sessions_and_archive',
      sql: `
        ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN session_ref TEXT REFERENCES sessions(id);
        ALTER TABLE sessions ADD COLUMN branch TEXT;
        CREATE INDEX IF NOT EXISTS idx_tasks_session_ref ON tasks(session_ref);
      `,
    },
    {
      name: '003_commit_message_and_branch_slug',
      sql: `
        ALTER TABLE tasks ADD COLUMN commit_message TEXT;
        ALTER TABLE tasks ADD COLUMN branch_slug TEXT;
      `,
    },
    {
      name: '004_task_model',
      sql: `
        ALTER TABLE tasks ADD COLUMN model TEXT;
      `,
    },
    {
      name: '005_transcript_entries',
      sql: `
        CREATE TABLE IF NOT EXISTS transcript_entries (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          session_ref TEXT,
          kind TEXT NOT NULL,
          text TEXT,
          label TEXT,
          path TEXT,
          detail TEXT,
          count INTEGER,
          duration_ms INTEGER,
          tokens INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_transcript_task_id ON transcript_entries(task_id);
        CREATE INDEX IF NOT EXISTS idx_transcript_session_ref ON transcript_entries(session_ref);
      `,
    },
    {
      name: '007_task_use_worktree',
      sql: `
        ALTER TABLE tasks ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1;
      `,
    },
    {
      name: '008_transcript_line_counts',
      sql: `
        ALTER TABLE transcript_entries ADD COLUMN lines_added INTEGER;
        ALTER TABLE transcript_entries ADD COLUMN lines_removed INTEGER;
      `,
    },
  ];

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map((r) => r.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
    }
  }
}

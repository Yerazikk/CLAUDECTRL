/**
 * General workspace - operates at the repos.directory level
 * Allows cross-repo work, cloning, registering, and modifying ClaudeCTRL itself
 */
import path from 'path';
import { getDb } from '../db';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';
import type { Repository } from '@claudectrl/shared';

export const GENERAL_ID = 'general';

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

export function ensureGeneralWorkspace(): void {
  const cfg = getConfig();
  const db = getDb();

  const existing = db.prepare('SELECT id FROM repositories WHERE id = ?').get(GENERAL_ID);
  if (existing) {
    // Update path if config changed
    if (cfg.repos.directory) {
      db.prepare("UPDATE repositories SET path = ?, updated_at = datetime('now') WHERE id = ?")
        .run(cfg.repos.directory, GENERAL_ID);
    }
    return;
  }

  // Use repos.directory or a unique placeholder that won't conflict with real repos
  const workDir = cfg.repos.directory || `__general__:${process.cwd()}`;
  db.prepare(`
    INSERT OR IGNORE INTO repositories (id, name, path, is_cloned, status, current_branch)
    VALUES (?, 'General', ?, 1, 'idle', null)
  `).run(GENERAL_ID, workDir);

  logger.info(`General workspace initialized at ${workDir}`);
}

export function getGeneralWorkspace(): Repository | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(GENERAL_ID) as Record<string, unknown> | undefined;
  return row ? dbRowToRepo(row) : null;
}

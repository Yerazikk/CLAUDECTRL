import { getDb } from '../db';
import { broker } from '../services/events';
import { logger } from '../utils/logger';
import { newId } from '../utils/id';
import type { Preview } from '@claudectrl/shared';

function dbRowToPreview(row: Record<string, unknown>): Preview {
  return {
    id: row.id as string,
    repoId: row.repo_id as string,
    taskId: row.task_id as string | null,
    localUrl: row.local_url as string,
    proxyPath: row.proxy_path as string,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
  };
}

export function registerPreview(repoId: string, taskId: string | null, localUrl: string): Preview {
  const db = getDb();
  const proxyPath = `/preview/${repoId}`;

  // Deactivate existing previews for repo
  db.prepare("UPDATE previews SET active = 0 WHERE repo_id = ?").run(repoId);

  const id = newId();
  db.prepare(`
    INSERT INTO previews (id, repo_id, task_id, local_url, proxy_path, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, repoId, taskId, localUrl, proxyPath);

  const preview = dbRowToPreview(db.prepare('SELECT * FROM previews WHERE id = ?').get(id) as Record<string, unknown>);
  broker.publish({ type: 'preview.started', preview });

  // Update repo's preview URL
  db.prepare("UPDATE repositories SET preview_url = ? WHERE id = ?").run(localUrl, repoId);

  logger.info(`Registered preview for repo ${repoId}: ${localUrl} -> ${proxyPath}`);
  return preview;
}

export function deactivatePreview(previewId: string): void {
  const db = getDb();
  db.prepare("UPDATE previews SET active = 0 WHERE id = ?").run(previewId);
  broker.publish({ type: 'preview.stopped', previewId });
}

export function getActivePreviewForRepo(repoId: string): Preview | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM previews WHERE repo_id = ? AND active = 1 LIMIT 1').get(repoId) as Record<string, unknown> | undefined;
  return row ? dbRowToPreview(row) : null;
}

export function getAllActivePreviews(): Preview[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM previews WHERE active = 1').all() as Record<string, unknown>[]).map(dbRowToPreview);
}

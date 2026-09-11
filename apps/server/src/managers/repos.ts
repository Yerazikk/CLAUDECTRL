import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { newId } from '../utils/id';
import { getDb } from '../db';
import { broker } from '../services/events';
import { getConfig, reloadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { getCurrentBranch } from './git';
import type { Repository } from '@claudectrl/shared';

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

export function getAllRepos(): Repository[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM repositories ORDER BY last_activity_at DESC NULLS LAST, created_at DESC').all() as Record<string, unknown>[]).map(dbRowToRepo);
}

export function getRepo(id: string): Repository | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? dbRowToRepo(row) : null;
}

export function scanReposDirectory(): Repository[] {
  const cfg = getConfig();
  const reposDir = cfg.repos.directory;
  if (!reposDir || !fs.existsSync(reposDir)) return [];

  const db = getDb();
  const entries = fs.readdirSync(reposDir, { withFileTypes: true });
  const registered: Repository[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(reposDir, entry.name);
    const gitDir = path.join(repoPath, '.git');
    if (!fs.existsSync(gitDir)) continue;

    // Check if already registered
    const existing = db.prepare('SELECT * FROM repositories WHERE path = ?').get(repoPath) as Record<string, unknown> | undefined;
    if (existing) {
      registered.push(dbRowToRepo(existing));
      continue;
    }

    // Auto-register
    const repo = registerLocalRepo(repoPath);
    if (repo) registered.push(repo);
  }

  return registered;
}

export function registerLocalRepo(repoPath: string): Repository | null {
  const db = getDb();

  // Security: validate path is within repos directory or an explicit absolute path
  const cfg = getConfig();
  const normalizedPath = path.resolve(repoPath);

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Path does not exist: ${normalizedPath}`);
  }
  if (!fs.existsSync(path.join(normalizedPath, '.git'))) {
    throw new Error(`Not a git repository: ${normalizedPath}`);
  }
  // Prevent registering parent directory that would include the repos directory itself
  if (cfg.repos.directory && normalizedPath === path.resolve(cfg.repos.directory)) {
    throw new Error('Cannot register the repos root directory itself');
  }

  const existing = db.prepare('SELECT * FROM repositories WHERE path = ?').get(normalizedPath) as Record<string, unknown> | undefined;
  if (existing) return dbRowToRepo(existing);

  const name = path.basename(normalizedPath);
  let githubOwner: string | null = null;
  let githubRepo: string | null = null;

  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: normalizedPath, encoding: 'utf8', stdio: 'pipe' }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) {
      githubOwner = match[1];
      githubRepo = match[2];
    }
  } catch {}

  const branch = getCurrentBranch(normalizedPath);
  const id = newId();

  db.prepare(`
    INSERT INTO repositories (id, name, path, github_owner, github_repo, is_cloned, status, current_branch)
    VALUES (?, ?, ?, ?, ?, 1, 'idle', ?)
  `).run(id, name, normalizedPath, githubOwner, githubRepo, branch);

  const repo = getRepo(id)!;
  broker.publish({ type: 'repo.updated', repo });
  logger.info(`Registered repo: ${name} at ${normalizedPath}`);
  return repo;
}

export async function cloneRepo(githubOwner: string, githubRepo: string): Promise<Repository> {
  // Always reload config so changes to default.yml are picked up without restart
  const cfg = reloadConfig();
  const targetDir = cfg.repos.directory;
  if (!targetDir) throw new Error('repos.directory not configured — set it in config/default.yml and try again');

  const repoPath = path.join(targetDir, githubRepo);
  if (fs.existsSync(repoPath)) {
    return registerLocalRepo(repoPath)!;
  }

  logger.info(`Cloning ${githubOwner}/${githubRepo} into ${repoPath}`);
  execSync(`gh repo clone ${githubOwner}/${githubRepo} "${repoPath}"`, {
    stdio: 'pipe',
    timeout: 120_000,
  });

  return registerLocalRepo(repoPath)!;
}

export async function listGithubRepos(): Promise<Array<{ owner: string; name: string; description: string; private: boolean }>> {
  try {
    const output = execSync('gh repo list --json name,owner,description,isPrivate --limit 100', {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const repos = JSON.parse(output) as Array<{ name: string; owner: { login: string }; description: string; isPrivate: boolean }>;
    return repos.map((r) => ({
      owner: r.owner.login,
      name: r.name,
      description: r.description ?? '',
      private: r.isPrivate,
    }));
  } catch (e) {
    logger.warn('Failed to list GitHub repos', e);
    return [];
  }
}

export function removeRepo(id: string): void {
  const db = getDb();
  const repo = getRepo(id);
  if (!repo) throw new Error(`Repository ${id} not found`);

  // HARD RULE: Only remove from ClaudeCTRL, never delete filesystem
  db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
  logger.info(`Removed repo ${repo.name} from ClaudeCTRL (filesystem untouched)`);
}

export function refreshRepoBranch(repoId: string): void {
  const db = getDb();
  const repo = getRepo(repoId);
  if (!repo || !repo.isCloned) return;
  try {
    const branch = getCurrentBranch(repo.path);
    db.prepare("UPDATE repositories SET current_branch = ?, updated_at = datetime('now') WHERE id = ?").run(branch, repoId);
  } catch {}
}

export function fetchRepo(repoId: string): void {
  const repo = getRepo(repoId);
  if (!repo || !repo.isCloned) return;
  // Skip placeholder paths (General workspace with no real directory)
  if (repo.path.startsWith('__general__:')) return;
  if (!fs.existsSync(repo.path)) return;
  try {
    execSync('git fetch --prune', { cwd: repo.path, stdio: 'pipe', timeout: 15_000 });
    refreshRepoBranch(repoId);
    const updated = getRepo(repoId)!;
    broker.publish({ type: 'repo.updated', repo: updated });
    logger.info(`Fetched ${repo.name}`);
  } catch (e) {
    logger.debug(`git fetch failed for ${repo.name} (non-fatal)`, e);
  }
}

// Cross-reference GitHub repos against local cloned status
export function annotateWithCloneStatus(
  githubRepos: Array<{ owner: string; name: string; description: string; private: boolean }>
): Array<{ owner: string; name: string; description: string; private: boolean; isCloned: boolean; repoId: string | null }> {
  const cfg = reloadConfig();
  const localRepos = getAllRepos();
  return githubRepos.map((r) => {
    const localPath = cfg.repos.directory ? path.join(cfg.repos.directory, r.name) : null;
    const existing = localRepos.find(
      (lr) => lr.githubRepo === r.name && lr.githubOwner === r.owner
    ) ?? (localPath && fs.existsSync(localPath) ? localRepos.find((lr) => lr.path === path.resolve(localPath)) : null);
    return { ...r, isCloned: !!existing, repoId: existing?.id ?? null };
  });
}

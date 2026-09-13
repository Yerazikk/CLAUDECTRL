import { execSync, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

// Git runs synchronously, so a command waiting on input (a credential prompt,
// a lock) would freeze the whole server — never prompt, and give up eventually.
const GIT_TIMEOUT_MS = 120_000;

function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  }).trim();
}

function runSafe(cmd: string, cwd: string): string {
  try {
    return run(cmd, cwd);
  } catch {
    return '';
  }
}

export function getCurrentBranch(repoPath: string): string {
  return runSafe('git rev-parse --abbrev-ref HEAD', repoPath) || 'main';
}

export function getDefaultBranch(repoPath: string): string {
  const remote = runSafe('git symbolic-ref refs/remotes/origin/HEAD', repoPath);
  if (remote) return remote.split('/').pop() ?? 'main';
  return 'main';
}

export function createBranch(repoPath: string, branchName: string, from?: string): void {
  const base = from ?? getDefaultBranch(repoPath);
  run(`git checkout -b ${branchName} ${base}`, repoPath);
  logger.info(`Created branch ${branchName} in ${repoPath}`);
}

export function checkoutBranch(repoPath: string, branch: string): void {
  run(`git checkout ${branch}`, repoPath);
}

/** Rename the branch currently checked out at worktreePath. Throws on failure (e.g. name collision). */
export function renameBranch(worktreePath: string, oldName: string, newName: string): void {
  run(`git branch -m ${oldName} ${newName}`, worktreePath);
}

export function branchExists(repoPath: string, branch: string): boolean {
  const result = runSafe(`git branch --list ${branch}`, repoPath);
  return result.length > 0;
}

export function commit(repoPath: string, message: string, allowEmpty = false): string | null {
  const cfg = getConfig();
  if (!cfg.git.commits.enabled) return null;
  // Sanitize message: strip AI attribution patterns
  let msg = message
    .replace(/co-authored-by:\s*claude.*$/gim, '')
    .replace(/generated (with|by) claude.*$/gim, '')
    .replace(/ai[- ]assisted.*$/gim, '')
    .trim();
  // Truncate
  if (msg.length > cfg.git.commits.max_subject_length) {
    msg = msg.slice(0, cfg.git.commits.max_subject_length).trim();
  }
  try {
    const stageResult = runSafe('git add -A', repoPath);
    const statusOut = run('git status --porcelain', repoPath);
    if (!statusOut && !allowEmpty) return null;
    const emptyFlag = allowEmpty ? ' --allow-empty' : '';
    run(`git commit${emptyFlag} -m "${msg.replace(/"/g, '\\"')}"`, repoPath);
    const sha = run('git rev-parse HEAD', repoPath);
    return sha;
  } catch (e) {
    logger.warn('Commit failed', e);
    return null;
  }
}

export function mergeIntoMain(repoPath: string, branch: string): void {
  const mainBranch = getDefaultBranch(repoPath);
  run(`git checkout ${mainBranch}`, repoPath);
  run(`git merge --no-ff ${branch} -m "merge ${branch}"`, repoPath);
  logger.info(`Merged ${branch} into ${mainBranch} in ${repoPath}`);
}

/** Back out of a half-finished merge so the checkout isn't left conflicted. */
export function abortMerge(repoPath: string): void {
  if (!runSafe('git rev-parse -q --verify MERGE_HEAD', repoPath)) return;
  runSafe('git merge --abort', repoPath);
  logger.info(`Aborted in-progress merge in ${repoPath}`);
}

export function pushMain(repoPath: string): void {
  const mainBranch = getDefaultBranch(repoPath);
  run(`git push origin ${mainBranch}`, repoPath);
  logger.info(`Pushed ${mainBranch} in ${repoPath}`);
}

export function createWorktree(repoPath: string, branch: string, worktreePath: string): void {
  // Create worktree directory under .git/worktrees won't work for absolute paths
  // Use absolute path next to repo
  if (branchExists(repoPath, branch)) {
    run(`git worktree add "${worktreePath}" ${branch}`, repoPath);
  } else {
    const base = getDefaultBranch(repoPath);
    run(`git worktree add -b ${branch} "${worktreePath}" ${base}`, repoPath);
  }
  logger.info(`Created worktree at ${worktreePath} for branch ${branch}`);
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  try {
    run(`git worktree remove --force "${worktreePath}"`, repoPath);
    logger.info(`Removed worktree at ${worktreePath}`);
  } catch (e) {
    logger.warn(`Failed to remove worktree ${worktreePath}`, e);
    // Cleanup manually if needed
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch {}
    runSafe(`git worktree prune`, repoPath);
  }
}

export function getWorktreeSiblingPath(repoPath: string, branch: string): string {
  const repoName = path.basename(repoPath);
  const sanitizedBranch = branch.replace(/[^a-zA-Z0-9-_]/g, '-');
  return path.join(path.dirname(repoPath), `.worktrees`, `${repoName}-${sanitizedBranch}`);
}

export function isCleanState(repoPath: string): boolean {
  const status = runSafe('git status --porcelain', repoPath);
  return status.length === 0;
}

/**
 * HEAD sha + the list of dirty files. Two identical fingerprints mean nothing
 * about the worktree moved — used to tell a reply that only answered a question
 * apart from one that actually changed code.
 * Returns null when the directory isn't a usable git worktree (e.g. it was
 * already cleaned up after a merge), in which case no comparison is possible.
 */
export function fingerprintWorktree(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const head = runSafe('git rev-parse HEAD', dir);
  if (!head) return null;
  return `${head}\n${runSafe('git status --porcelain', dir)}`;
}

export function stashChanges(repoPath: string): boolean {
  const result = runSafe('git stash', repoPath);
  return result.includes('Saved');
}

export function hasMergeConflicts(repoPath: string): boolean {
  const status = runSafe('git status --porcelain', repoPath);
  return status.split('\n').some((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD'));
}

export function getBranchName(type: 'feature' | 'fix' | 'refactor', slug: string): string {
  const cfg = getConfig();
  const prefixes = cfg.git.branch_prefixes;
  const map = { feature: prefixes.feature, fix: prefixes.bugfix, refactor: prefixes.refactor };
  const prefix = map[type] ?? 'feature/';
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `${prefix}${clean}`;
}

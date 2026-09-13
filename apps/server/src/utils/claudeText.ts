/**
 * Helpers for the text Claude produces, shared by the task lifecycle and the
 * transcript feed so both strip the same machine-only lines.
 */

/**
 * The trailing `COMMIT:` / `BRANCH:` lines the task prompt asks Claude to
 * append. They are parsed by the server and must never reach the user.
 */
export function extractCommitMetadata(text: string): {
  commitMessage: string | null;
  branchSlug: string | null;
  cleaned: string;
} {
  const commitMatch = text.match(/^COMMIT:\s*(.+)$/im);
  const branchMatch = text.match(/^BRANCH:\s*(.+)$/im);

  const commitMessage = commitMatch
    ? commitMatch[1].trim().replace(/^["'`]|["'`]$/g, '').slice(0, 72)
    : null;

  const branchSlug = branchMatch
    ? branchMatch[1].trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
    : null;

  return {
    commitMessage: commitMessage || null,
    branchSlug: branchSlug || null,
    cleaned: stripCommitMetadata(text),
  };
}

/** Same removal as above, for text that's only being displayed. */
export function stripCommitMetadata(text: string): string {
  return text
    .replace(/^COMMIT:\s*.+$/gim, '')
    .replace(/^BRANCH:\s*.+$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

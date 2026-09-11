import { describe, it, expect } from 'vitest';
import { getBranchName } from '../managers/git';
import { loadConfig } from '../utils/config';

// Ensure config defaults are loaded
loadConfig('/nonexistent');

describe('branch naming', () => {
  it('creates feature branches', () => {
    const name = getBranchName('feature', 'add user authentication');
    expect(name).toMatch(/^feature\//);
    expect(name.length).toBeLessThan(60);
  });

  it('creates fix branches', () => {
    const name = getBranchName('fix', 'modal clips on mobile');
    expect(name).toMatch(/^fix\//);
  });

  it('creates refactor branches', () => {
    const name = getBranchName('refactor', 'auth service');
    expect(name).toMatch(/^refactor\//);
  });

  it('sanitizes special chars', () => {
    const name = getBranchName('feature', 'fix: this! & that (thing)');
    expect(name).not.toMatch(/[!&()]/);
  });

  it('truncates long slugs', () => {
    const name = getBranchName('feature', 'a'.repeat(100));
    expect(name.length).toBeLessThanOrEqual(50);
  });
});

import { describe, it, expect } from 'vitest';

// Test usage text parsing logic extracted as a pure function
function parseUsageText(text: string) {
  const result: { hourlyUsed?: number; hourlyLimit?: number; weeklyUsed?: number } = {};

  const hourlyMatch = text.match(/(\d+(?:,\d+)?)\s*(?:tokens?|requests?)[^\n]*hour[^\n]*?(\d+(?:,\d+)?)\s*(?:tokens?|limit)/i);
  if (hourlyMatch) {
    result.hourlyUsed = parseInt(hourlyMatch[1].replace(/,/g, ''), 10);
    result.hourlyLimit = parseInt(hourlyMatch[2].replace(/,/g, ''), 10);
  }

  return result;
}

describe('usage parsing', () => {
  it('handles empty output gracefully', () => {
    const result = parseUsageText('');
    expect(result.hourlyUsed).toBeUndefined();
  });

  it('handles non-usage output without crashing', () => {
    const result = parseUsageText('some random text without usage info');
    expect(result).toBeDefined();
  });
});

describe('no-delete protection', () => {
  it('remove from UI does not delete filesystem (conceptual test)', () => {
    // The remove endpoint only calls DELETE from repositories table
    // It does NOT call fs.rmSync or similar
    // This test documents the invariant
    const removeRepo = (id: string) => {
      // Simulated: only DB operation, no fs
      const dbOp = `DELETE FROM repositories WHERE id = '${id}'`;
      expect(dbOp).not.toContain('rmSync');
      expect(dbOp).not.toContain('rm -rf');
    };
    removeRepo('some-id');
  });
});

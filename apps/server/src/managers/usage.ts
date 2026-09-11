import { getDb } from '../db';
import { broker } from '../services/events';
import { logger } from '../utils/logger';
import { newId } from '../utils/id';
import { queryUsage } from './claude';
import { getConfig } from '../utils/config';
import path from 'path';
import type { UsageSnapshot } from '@claudectrl/shared';

function dbRowToUsage(row: Record<string, unknown>): UsageSnapshot {
  return {
    id: row.id as string,
    hourlyUsed: row.hourly_used as number,
    hourlyLimit: row.hourly_limit as number,
    hourlyResetAt: row.hourly_reset_at as string | null,
    weeklyUsed: row.weekly_used as number,
    weeklyLimit: row.weekly_limit as number,
    weeklyResetAt: row.weekly_reset_at as string | null,
    raw: row.raw as string | null,
    capturedAt: row.captured_at as string,
  };
}

export function getLatestUsage(): UsageSnapshot | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM usage_snapshots ORDER BY captured_at DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  return row ? dbRowToUsage(row) : null;
}

function parseUsageOutput(raw: string): Partial<UsageSnapshot> | null {
  if (!raw) return null;
  try {
    // Try parsing as JSON first (if Claude outputs structured JSON)
    const parsed = JSON.parse(raw);
    // Look for usage fields in various formats
    if (parsed.result) {
      return parseUsageText(parsed.result);
    }
    if (typeof parsed === 'object') {
      return parseUsageText(JSON.stringify(parsed));
    }
  } catch {}
  return parseUsageText(raw);
}

function parseUsageText(text: string): Partial<UsageSnapshot> {
  const result: Partial<UsageSnapshot> = {};

  // Look for patterns like "X/Y requests" or "X% of hourly limit" or similar
  // Claude Code /usage output format (based on typical output):
  // "Usage: X tokens in last hour (Y% of hourly limit)"
  // "Weekly: X tokens (Y% of weekly limit)"

  // Try to extract hourly info
  const hourlyMatch = text.match(/(\d+(?:,\d+)?)\s*(?:tokens?|requests?|messages?)[^\n]*hour[^\n]*?(\d+(?:,\d+)?)\s*(?:tokens?|limit)/i);
  if (hourlyMatch) {
    result.hourlyUsed = parseInt(hourlyMatch[1].replace(/,/g, ''), 10);
    result.hourlyLimit = parseInt(hourlyMatch[2].replace(/,/g, ''), 10);
  }

  // Try percentage-based
  const hourlyPctMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(?:hourly|5.hour)/i);
  if (hourlyPctMatch) {
    const pct = parseFloat(hourlyPctMatch[1]) / 100;
    if (!result.hourlyUsed && result.hourlyLimit) {
      result.hourlyUsed = Math.round(pct * result.hourlyLimit);
    }
  }

  // Look for reset times
  const resetMatch = text.match(/resets?\s+in\s+(\d+)\s*(hour|minute|day)/i);
  if (resetMatch) {
    const amount = parseInt(resetMatch[1], 10);
    const unit = resetMatch[2].toLowerCase();
    const now = new Date();
    if (unit.startsWith('hour')) now.setHours(now.getHours() + amount);
    else if (unit.startsWith('minute')) now.setMinutes(now.getMinutes() + amount);
    else if (unit.startsWith('day')) now.setDate(now.getDate() + amount);
    result.hourlyResetAt = now.toISOString();
  }

  return result;
}

export async function refreshUsage(): Promise<UsageSnapshot | null> {
  const cfg = getConfig();
  const workDir = cfg.repos.directory || process.cwd();

  try {
    const raw = await queryUsage(workDir);
    if (!raw) return getLatestUsage();

    const parsed = parseUsageOutput(raw);
    const db = getDb();

    const id = newId();
    const snapshot: UsageSnapshot = {
      id,
      hourlyUsed: parsed?.hourlyUsed ?? 0,
      hourlyLimit: parsed?.hourlyLimit ?? 0,
      hourlyResetAt: parsed?.hourlyResetAt ?? null,
      weeklyUsed: parsed?.weeklyUsed ?? 0,
      weeklyLimit: parsed?.weeklyLimit ?? 0,
      weeklyResetAt: parsed?.weeklyResetAt ?? null,
      raw: raw.slice(0, 2000),
      capturedAt: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO usage_snapshots (id, hourly_used, hourly_limit, hourly_reset_at, weekly_used, weekly_limit, weekly_reset_at, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, snapshot.hourlyUsed, snapshot.hourlyLimit, snapshot.hourlyResetAt,
      snapshot.weeklyUsed, snapshot.weeklyLimit, snapshot.weeklyResetAt, snapshot.raw);

    broker.publish({ type: 'usage.updated', usage: snapshot });
    return snapshot;
  } catch (e) {
    logger.warn('Usage refresh failed (non-fatal)', e);
    return getLatestUsage();
  }
}

// Schedule periodic usage refresh (every 5 minutes)
let usageInterval: ReturnType<typeof setInterval> | null = null;

export function startUsageScheduler(): void {
  if (usageInterval) return;
  // Initial fetch after 10 seconds
  setTimeout(() => refreshUsage(), 10_000);
  usageInterval = setInterval(() => refreshUsage(), 5 * 60 * 1000);
}

export function stopUsageScheduler(): void {
  if (usageInterval) {
    clearInterval(usageInterval);
    usageInterval = null;
  }
}

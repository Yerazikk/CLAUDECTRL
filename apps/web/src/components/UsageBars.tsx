import type { UsageSnapshot } from '@claudectrl/shared';

function formatRemaining(resetAt: string | null, used: number, limit: number): string {
  if (resetAt) {
    const ms = new Date(resetAt).getTime() - Date.now();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const d = Math.floor(h / 24);
      if (d > 0) return `${d}d remaining`;
      if (h > 0) return `${h}h remaining`;
      return `${m}m remaining`;
    }
    return 'resetting soon';
  }
  if (limit > 0) {
    const pct = Math.round((1 - used / limit) * 100);
    return `${pct}% remaining`;
  }
  return '';
}

interface Props {
  usage: UsageSnapshot | null;
}

export function UsageBars({ usage }: Props) {
  if (!usage) return null;

  const hourlyPct = usage.hourlyLimit > 0 ? Math.min(usage.hourlyUsed / usage.hourlyLimit, 1) : 0;
  const weeklyPct = usage.weeklyLimit > 0 ? Math.min(usage.weeklyUsed / usage.weeklyLimit, 1) : 0;

  const hourlyLabel = formatRemaining(usage.hourlyResetAt, usage.hourlyUsed, usage.hourlyLimit);
  const weeklyLabel = formatRemaining(usage.weeklyResetAt, usage.weeklyUsed, usage.weeklyLimit);

  if (!hourlyLabel && !weeklyLabel) return null;

  return (
    <div style={{ padding: '12px 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hourlyLabel && (
        <UsageBar pct={hourlyPct} label={hourlyLabel} />
      )}
      {weeklyLabel && (
        <UsageBar pct={weeklyPct} label={weeklyLabel} />
      )}
    </div>
  );
}

function UsageBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div style={{
        height: 2,
        background: '#f0f0f0',
        borderRadius: 1,
        overflow: 'hidden',
        marginBottom: 4,
      }}>
        <div style={{
          height: '100%',
          width: `${Math.round(pct * 100)}%`,
          background: '#0a0a0a',
          transition: 'width 0.5s ease',
        }} />
      </div>
      <div style={{ fontSize: 11, color: '#999', lineHeight: 1 }}>{label}</div>
    </div>
  );
}

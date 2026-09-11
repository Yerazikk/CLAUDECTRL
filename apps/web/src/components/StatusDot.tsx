import type { TaskStatus, RepoStatus } from '@claudectrl/shared';

const colorMap: Record<string, string> = {
  working: '#D97757',
  validating: '#E8975A',
  queued: '#A0AEC0',
  ready_for_review: '#D97757',
  done: '#38B2AC',
  failed: '#E05252',
  stopped: '#A0AEC0',
  paused: '#D4A017',
  idle: '#A0AEC0',
  not_cloned: '#C8CDD6',
};

type StatusType = TaskStatus | RepoStatus;

interface Props {
  status: StatusType;
  size?: number;
  pulse?: boolean;
}

export function StatusDot({ status, size = 6, pulse }: Props) {
  const color = colorMap[status] ?? '#C8CDD6';
  const shouldPulse = pulse && (status === 'working' || status === 'validating' || status === 'queued');
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow: shouldPulse ? `0 0 0 2px rgba(217,119,87,0.2)` : undefined,
        animation: shouldPulse ? 'pulse 2s ease-in-out infinite' : undefined,
      }}
      aria-hidden="true"
    />
  );
}

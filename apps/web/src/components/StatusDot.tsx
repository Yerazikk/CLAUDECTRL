import type { TaskStatus, RepoStatus } from '@claudectrl/shared';

const styles: Record<string, React.CSSProperties> = {
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
};

const colorMap: Record<string, string> = {
  working: '#0a0a0a',
  validating: '#6b6b6b',
  queued: '#999',
  ready_for_review: '#0a0a0a',
  done: '#bbb',
  failed: '#c0392b',
  stopped: '#bbb',
  idle: '#ddd',
  not_cloned: '#ddd',
};

type StatusType = TaskStatus | RepoStatus;

interface Props {
  status: StatusType;
  size?: number;
  pulse?: boolean;
}

export function StatusDot({ status, size = 6, pulse }: Props) {
  const color = colorMap[status] ?? '#ddd';
  return (
    <span
      style={{
        ...styles.dot,
        width: size,
        height: size,
        background: color,
        animation: pulse && (status === 'working' || status === 'validating')
          ? 'pulse 2s ease-in-out infinite'
          : undefined,
      }}
      aria-hidden="true"
    />
  );
}

// Inject keyframes once
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`;
  document.head.appendChild(style);
}

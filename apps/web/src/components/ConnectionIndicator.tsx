interface Props {
  connected: boolean;
}

export function ConnectionIndicator({ connected }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 12px',
      borderRadius: 'var(--r-full)',
      boxShadow: 'var(--shadow-raised-xs)',
      background: 'var(--c-bg)',
      fontSize: 11,
      fontWeight: 500,
      color: connected ? 'var(--c-muted)' : 'var(--c-failed)',
      letterSpacing: 0.2,
    }}>
      <span style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: connected ? 'var(--c-success)' : 'var(--c-failed)',
        flexShrink: 0,
        animation: connected ? undefined : 'pulse 1.5s ease-in-out infinite',
        boxShadow: connected
          ? '0 0 0 2px rgba(56,178,172,0.25)'
          : '0 0 0 2px rgba(224,82,82,0.25)',
      }} />
      {connected ? 'Live' : 'Reconnecting'}
    </div>
  );
}

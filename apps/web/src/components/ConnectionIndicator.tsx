interface Props {
  connected: boolean;
}

export function ConnectionIndicator({ connected }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 11,
      color: connected ? 'var(--c-subtle)' : '#c0392b',
    }}>
      <span style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: connected ? '#22c55e' : '#c0392b',
        flexShrink: 0,
      }} />
      {connected ? 'connected' : 'reconnecting...'}
    </div>
  );
}

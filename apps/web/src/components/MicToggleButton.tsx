interface Props {
  isListening: boolean;
  onToggle: () => void;
  size?: number;
  title?: string;
}

// Toggle mic: click to start dictation, click again to stop. No hold gesture.
export function MicToggleButton({ isListening, onToggle, size = 30, title }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: isListening ? 'var(--c-accent)' : 'var(--c-bg)',
        color: isListening ? '#fff' : 'var(--c-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: isListening ? 'none' : 'var(--shadow-raised-xs)',
        transition: 'background 0.3s ease-out, box-shadow 0.3s ease-out, color 0.3s ease-out',
      }}
      aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
      aria-pressed={isListening}
      title={title ?? (isListening ? 'Stop dictation' : 'Start dictation')}
    >
      <MicIcon size={Math.round(size * 0.38)} pulse={isListening} />
    </button>
  );
}

function MicIcon({ size, pulse }: { size: number; pulse?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      style={pulse ? { animation: 'pulse 1.4s ease-in-out infinite' } : undefined}
    >
      <rect x="5" y="1" width="6" height="9" rx="3" />
      <path d="M3 8a5 5 0 0010 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="15" x2="11" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

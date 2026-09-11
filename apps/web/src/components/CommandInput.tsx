import { useState, useRef, useCallback, useEffect } from 'react';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { MicToggleButton } from './MicToggleButton';

interface Props {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  voiceEnabled?: boolean;
}

export function CommandInput({ onSubmit, disabled, placeholder = 'Tell Claude what to do...', voiceEnabled = true }: Props) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isListening, toggle: toggleListening, hasSupport } = useSpeechToText((finalizedText) => {
    // Append below whatever is already in the box — never overwrite it.
    setValue((prev) => {
      const trimmedPrev = prev.replace(/\s+$/, '');
      return trimmedPrev ? `${trimmedPrev}\n${finalizedText}` : finalizedText;
    });
  });

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = useCallback(() => {
    const msg = value.trim();
    if (!msg || disabled) return;
    onSubmit(msg);
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, disabled, onSubmit]);

  const hasValue = value.trim().length > 0;

  return (
    <div style={{
      padding: '12px 16px 16px',
      background: 'var(--c-bg)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        padding: '10px 10px 10px 16px',
        borderRadius: 'var(--r-xl)',
        boxShadow: isFocused ? 'var(--shadow-inset-deep)' : 'var(--shadow-inset)',
        background: 'var(--c-bg)',
        transition: 'box-shadow 0.3s ease-out',
      }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            style={{
              width: '100%',
              resize: 'none',
              minHeight: 36,
              maxHeight: 200,
              padding: '8px 0',
              fontSize: 14,
              lineHeight: 1.5,
              color: 'var(--c-fg)',
              background: 'transparent',
              fontFamily: 'var(--font)',
            }}
            aria-label="Command input"
          />
          {isListening && (
            <div style={{
              position: 'absolute',
              right: 0,
              bottom: '100%',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--c-accent)',
              pointerEvents: 'none',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--c-accent)', display: 'inline-block',
                animation: 'pulse 1.4s ease-in-out infinite',
              }} />
              Listening...
            </div>
          )}
        </div>

        {voiceEnabled && hasSupport && (
          <MicToggleButton isListening={isListening} onToggle={toggleListening} size={40} />
        )}

        <button
          onClick={handleSubmit}
          disabled={disabled || !hasValue}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: hasValue && !disabled ? 'var(--c-accent)' : 'var(--c-bg)',
            color: hasValue && !disabled ? '#fff' : 'var(--c-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: hasValue && !disabled
              ? '4px 4px 10px rgb(163 177 198 / 0.5), -2px -2px 6px rgba(255,255,255,0.4)'
              : 'var(--shadow-raised-xs)',
            transition: 'background 0.3s ease-out, box-shadow 0.3s ease-out, color 0.3s ease-out, transform 0.15s ease-out',
            cursor: hasValue && !disabled ? 'pointer' : 'default',
          }}
          onMouseEnter={(e) => {
            if (hasValue && !disabled) e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = ''; }}
          aria-label="Send"
        >
          <UpArrowIcon size={13} />
        </button>
      </div>
    </div>
  );
}

function UpArrowIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10V2M2 6l4-4 4 4"/>
    </svg>
  );
}

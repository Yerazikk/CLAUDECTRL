import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface Props {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  voiceEnabled?: boolean;
}

export function CommandInput({ onSubmit, disabled, placeholder = 'Tell Claude what to do...', voiceEnabled = true }: Props) {
  const [value, setValue] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const lockYRef = useRef<number | null>(null);

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

  const startListening = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const results = e.results;
      const parts: string[] = [];
      for (let i = 0; i < results.length; i++) {
        parts.push(results[i][0].transcript);
      }
      setValue(parts.join(''));
    };

    recognition.onend = () => {
      if (isLocked) return;
      setIsListening(false);
      setIsLocked(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
      setIsLocked(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isLocked]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setIsLocked(false);
    lockYRef.current = null;
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handleMicPointerDown = useCallback((e: React.PointerEvent) => {
    if (!voiceEnabled) return;
    e.preventDefault();
    lockYRef.current = e.clientY;
    if (isListening && isLocked) { stopListening(); return; }
    if (!isListening) startListening();
  }, [isListening, isLocked, voiceEnabled, startListening, stopListening]);

  const handleMicPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isListening || isLocked || lockYRef.current === null) return;
    if (lockYRef.current - e.clientY > 40) setIsLocked(true);
  }, [isListening, isLocked]);

  const handleMicPointerUp = useCallback(() => {
    if (isLocked) return;
    if (isListening) stopListening();
  }, [isListening, isLocked, stopListening]);

  const hasSpeechAPI = typeof window !== 'undefined' && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

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
          {isListening && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: 'var(--c-muted)',
              fontSize: 13,
              fontStyle: 'italic',
            }}>
              {isLocked ? 'Tap mic to stop recording...' : 'Listening...'}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={isListening ? '' : placeholder}
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
              color: isListening ? 'transparent' : 'var(--c-fg)',
              background: 'transparent',
              fontFamily: 'var(--font)',
            }}
            aria-label="Command input"
          />
        </div>

        {voiceEnabled && hasSpeechAPI && (
          <button
            ref={micButtonRef}
            onPointerDown={handleMicPointerDown}
            onPointerMove={handleMicPointerMove}
            onPointerUp={handleMicPointerUp}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: isListening
                ? (isLocked ? 'var(--c-accent)' : 'var(--c-accent-light)')
                : 'var(--c-bg)',
              color: isListening ? '#fff' : 'var(--c-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: isListening ? 'none' : 'var(--shadow-raised-xs)',
              transition: 'background 0.3s ease-out, box-shadow 0.3s ease-out, color 0.3s ease-out',
              touchAction: 'none',
              userSelect: 'none',
            }}
            aria-label={isListening ? 'Stop recording' : 'Start voice input'}
            title="Hold to record, slide up to lock"
          >
            <MicIcon size={15} />
          </button>
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

function MicIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="5" y="1" width="6" height="9" rx="3" />
      <path d="M3 8a5 5 0 0010 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="5" y1="15" x2="11" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function UpArrowIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10V2M2 6l4-4 4 4"/>
    </svg>
  );
}

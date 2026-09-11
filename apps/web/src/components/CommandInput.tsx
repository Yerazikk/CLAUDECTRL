import { useState, useRef, useCallback, useEffect } from 'react';

// Web Speech API types
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const lockYRef = useRef<number | null>(null);

  // Auto-resize textarea
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

  // Voice recording
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
      const transcript = parts.join('');
      setValue(transcript);
    };

    recognition.onend = () => {
      if (isLocked) return; // will re-start if locked
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
    // Focus textarea so user can review/edit
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // Hold-to-record: pointer down starts, pointer up stops (unless locked)
  const handleMicPointerDown = useCallback((e: React.PointerEvent) => {
    if (!voiceEnabled) return;
    e.preventDefault();
    lockYRef.current = e.clientY;
    if (isListening && isLocked) {
      stopListening();
      return;
    }
    if (!isListening) startListening();
  }, [isListening, isLocked, voiceEnabled, startListening, stopListening]);

  const handleMicPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isListening || isLocked || lockYRef.current === null) return;
    const dy = lockYRef.current - e.clientY;
    if (dy > 40) {
      // Slide up to lock
      setIsLocked(true);
    }
  }, [isListening, isLocked]);

  const handleMicPointerUp = useCallback(() => {
    if (isLocked) return; // stay listening when locked
    if (isListening) stopListening();
  }, [isListening, isLocked, stopListening]);

  const hasSpeechAPI = typeof window !== 'undefined' && !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--c-border)',
      background: 'var(--c-bg)',
    }}>
      <div style={{ flex: 1, position: 'relative' }}>
        {isListening && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            color: 'var(--c-muted)',
            fontSize: 13,
          }}>
            {isLocked ? 'Tap mic to stop' : 'Listening...'}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
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
            color: isListening ? 'transparent' : 'inherit',
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
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: isListening ? (isLocked ? '#0a0a0a' : '#333') : 'transparent',
            color: isListening ? '#fff' : 'var(--c-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s',
            touchAction: 'none',
            userSelect: 'none',
          }}
          aria-label={isListening ? 'Stop recording' : 'Start voice input'}
          title="Hold to record, slide up to lock"
        >
          <MicIcon size={14} />
        </button>
      )}

      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: value.trim() && !disabled ? 'var(--c-fg)' : 'var(--c-border)',
          color: value.trim() && !disabled ? '#fff' : 'var(--c-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
        aria-label="Send"
      >
        <UpArrowIcon size={12} />
      </button>
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
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10V2M2 6l4-4 4 4"/>
    </svg>
  );
}

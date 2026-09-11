import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const hasSpeechRecognitionSupport = !!getSpeechRecognitionCtor();

// Errors that mean "don't bother retrying" (permission denied, no mic, etc).
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * Toggle-based dictation (click to start, click to stop — no press-and-hold).
 * Never sees or touches whatever is already in the caller's text box: it only
 * ever hands back newly-finalized speech via onCommit, which the caller
 * appends. Finalized phrases are committed as soon as the browser confirms
 * them (not batched until the end), and the underlying recognizer is
 * auto-restarted if the browser silently ends the session (common after
 * ~60s of continuous listening or brief silence) so a long dictation run
 * keeps going — and nothing already committed is ever at risk, since it
 * already left the recognizer and landed in the caller's own state.
 */
export function useSpeechToText(onCommit: (finalizedText: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListeningRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  const lastErrorRef = useRef<string | null>(null);
  const restartCountRef = useRef(0);
  const restartWindowStartRef = useRef(0);
  onCommitRef.current = onCommit;

  const createRecognition = useCallback((): SpeechRecognitionInstance | null => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      restartCountRef.current = 0;
      let finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalChunk += result[0]?.transcript ?? '';
      }
      const trimmed = finalChunk.trim();
      if (trimmed) onCommitRef.current(trimmed);
    };

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      lastErrorRef.current = e.error;
    };

    recognition.onend = () => {
      if (!wantListeningRef.current) {
        setIsListening(false);
        return;
      }
      if (lastErrorRef.current && FATAL_ERRORS.has(lastErrorRef.current)) {
        wantListeningRef.current = false;
        setIsListening(false);
        return;
      }
      // Browser auto-stopped (silence/segment-length limit) but the user
      // hasn't toggled off — restart so long dictation sessions survive.
      const now = Date.now();
      if (now - restartWindowStartRef.current > 10_000) {
        restartWindowStartRef.current = now;
        restartCountRef.current = 0;
      }
      restartCountRef.current += 1;
      if (restartCountRef.current > 8) {
        // Restarting in a tight loop with no successful results — bail out
        // instead of spinning forever.
        wantListeningRef.current = false;
        setIsListening(false);
        return;
      }
      lastErrorRef.current = null;
      try {
        recognition.start();
      } catch {
        setTimeout(() => {
          if (wantListeningRef.current) {
            try { recognition.start(); } catch { /* give up silently */ }
          }
        }, 250);
      }
    };

    return recognition;
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const recognition = createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    lastErrorRef.current = null;
    restartCountRef.current = 0;
    restartWindowStartRef.current = Date.now();
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      wantListeningRef.current = false;
    }
  }, [createRecognition]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop(); else start();
  }, [isListening, start, stop]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  return { isListening, toggle, hasSupport: hasSpeechRecognitionSupport };
}

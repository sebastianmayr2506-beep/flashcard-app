// Thin typed wrapper around the browser's Web Speech API.
// On Chrome/Edge/Safari this transcribes locally without sending audio
// anywhere we control — perfect for our "AI Prüfung" feature where we
// only want the *text* to reach our LLM provider.
//
// Firefox does not implement SpeechRecognition; isSupported() returns
// false there and the UI must fall back to the text-only mode.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
}

interface SpeechRecognitionErrorLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend:    (() => void) | null;
  onerror:  ((e: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function getCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export interface RecognizerOptions {
  lang?: string;
  /** Called whenever a final or interim chunk is recognized. */
  onResult: (text: string, isFinal: boolean) => void;
  /** Called when recognition ends (user stop, timeout, or error). */
  onEnd?: () => void;
  /** Called on errors like "no-speech", "not-allowed" (mic blocked), etc. */
  onError?: (code: string, message?: string) => void;
}

export interface RecognizerHandle {
  start: () => void;
  stop: () => void;
}

/**
 * Creates and configures a SpeechRecognition instance. Returns null if
 * the browser doesn't support the API — caller should already have
 * checked isSpeechRecognitionSupported(), this is a defensive belt.
 */
export function createRecognizer(opts: RecognizerOptions): RecognizerHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = opts.lang ?? 'de-DE';
  rec.continuous = true;       // keep listening until user stops
  rec.interimResults = true;   // show partial transcripts live

  rec.onresult = (e) => {
    // Walk new results since resultIndex; pass each chunk up.
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const transcript = result[0]?.transcript ?? '';
      opts.onResult(transcript, result.isFinal);
    }
  };
  rec.onend = () => opts.onEnd?.();
  rec.onerror = (e) => opts.onError?.(e.error, e.message);

  return {
    start: () => {
      try { rec.start(); }
      catch (err) {
        // start() throws if already started — surface as error
        opts.onError?.('start-failed', (err as Error).message);
      }
    },
    stop: () => {
      try { rec.stop(); } catch { /* ignore */ }
    },
  };
}

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
  /**
   * Keep the recognizer alive across the browser's auto-end events.
   *
   * Mobile browsers (Android Chrome, iOS Safari) end the session after a few
   * seconds of silence even with continuous=true. With keepAlive=true we
   * silently restart on `onend`/`no-speech` so the user can pause mid-sentence
   * without having to tap the mic button again. The handle's stop() flips a
   * "manual" flag so an explicit user-stop does NOT trigger a restart.
   */
  keepAlive?: boolean;
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

  // Used by keepAlive logic to distinguish user-initiated stops from
  // browser-initiated auto-ends (silence timeout, "no-speech", etc.).
  let manualStop = false;
  // Defensive throttle: if something keeps killing the session immediately
  // (e.g. permission revoked) we don't want to spin in a restart loop.
  let restartAttempts = 0;
  let lastRestartAt = 0;
  // Holds the *current* recognizer. We replace it on every keepAlive restart
  // because some mobile browsers (notably Samsung Internet on Galaxy phones
  // — including foldables) keep the previous session's `e.results` buffer
  // alive across rec.start() calls. Reusing the same instance causes every
  // already-finalised chunk to be re-emitted on each restart, which then
  // gets re-appended by the caller and produces the exponentially-growing
  // "Liquiditätskrise Liquiditätskrise Liquiditätskrise…" duplication.
  // A fresh instance per restart guarantees a clean results buffer.
  let rec: SpeechRecognitionInstance | null = null;

  const buildRecognizer = (): SpeechRecognitionInstance => {
    const r = new Ctor();
    r.lang = opts.lang ?? 'de-DE';
    r.continuous = true;       // keep listening until user stops
    r.interimResults = true;   // show partial transcripts live

    r.onresult = (e) => {
      // Walk new results since resultIndex; pass each chunk up.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? '';
        opts.onResult(transcript, result.isFinal);
      }
    };
    r.onend = () => {
      // Mobile auto-end after silence: silently restart if the caller asked us to.
      if (tryRestart()) return;
      opts.onEnd?.();
    };
    r.onerror = (e) => {
      // "no-speech" and "aborted" on mobile are normal silence/auto-end signals.
      // Don't bubble them up if keepAlive will recover — only surface fatal errors.
      if (opts.keepAlive && !manualStop && (e.error === 'no-speech' || e.error === 'aborted')) {
        // onend will fire next and tryRestart will pick up. Swallow the error.
        return;
      }
      opts.onError?.(e.error, e.message);
    };
    return r;
  };

  const tryRestart = () => {
    if (!opts.keepAlive || manualStop) return false;
    const now = Date.now();
    if (now - lastRestartAt > 5000) restartAttempts = 0; // reset window
    if (restartAttempts >= 5) return false; // give up if 5 restarts within 5s
    restartAttempts++;
    lastRestartAt = now;
    // CRITICAL: build a *fresh* recognizer for the restart — see comment on
    // `let rec` above. Reusing the old instance leaks its results buffer.
    try {
      rec = buildRecognizer();
      rec.start();
      return true;
    } catch {
      return false;
    }
  };

  return {
    start: () => {
      manualStop = false;
      restartAttempts = 0;
      try {
        rec = buildRecognizer();
        rec.start();
      } catch (err) {
        // start() throws if already started — surface as error
        opts.onError?.('start-failed', (err as Error).message);
      }
    },
    stop: () => {
      manualStop = true;
      try { rec?.stop(); } catch { /* ignore */ }
    },
  };
}

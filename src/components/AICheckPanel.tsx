// Self-contained KI-Prüfung widget that can be embedded anywhere.
// Two outcome modes:
//   - 'srs'    → 4-button rating (Nochmal/Schwer/Gut/Einfach) — used by StudySession
//   - 'binary' → 2-button gewusst/nicht-gewusst, with a score-based threshold
//                (default 60/100) — used by ExamMode
//
// State machine: input → loading → (probing → finalizing)? → result.
// Probing phase exists when the user picks "Nachbohren"-Modus and the AI
// determines that the first answer has gaps; the AI then asks 1–3 follow-up
// questions before producing the final grade.
//
// The suggested rating/recommendation is ALWAYS advisory. The user clicks
// the actual rating themselves — same convention as before.

import { useEffect, useRef, useState } from 'react';
import {
  checkAnswerWithAI,
  probeAnswerForGaps,
  finalGradeWithProbes,
  type AnswerCheckResult,
  type ProbeAnswer,
} from '../utils/aiAnswerCheck';
import {
  createRecognizer,
  isSpeechRecognitionSupported,
  type RecognizerHandle,
} from '../utils/speechRecognition';

type AICheckMode = 'text' | 'mic';
type AIProbeMode = 'strict' | 'probe';

type State =
  | { status: 'input';      mode: AICheckMode; text: string; listening: boolean; probeMode: AIProbeMode }
  | { status: 'loading';    mode: AICheckMode; text: string; probeMode: AIProbeMode }
  | { status: 'probing';    mode: AICheckMode; originalText: string; followUps: string[]; idx: number; answers: string[]; currentText: string; listening: boolean }
  | { status: 'finalizing'; mode: AICheckMode; originalText: string; followUps: string[]; answers: string[] }
  | { status: 'result';     mode: AICheckMode; text: string; result: AnswerCheckResult; probes?: ProbeAnswer[] };

interface Keys { gemini?: string; anthropic?: string; groq?: string }

interface Props {
  front: string;
  back: string;
  apiKeys: Keys;
  /** 'srs' = 4 buttons (default), 'binary' = gewusst / nicht gewusst */
  outcome: 'srs' | 'binary';
  /** Score threshold for "gewusst" recommendation in binary mode. Default 60. */
  binaryThreshold?: number;
  /** Default probe mode. 'probe' = Nachbohren (Default for ExamMode), 'strict' = single shot. */
  defaultProbeMode?: AIProbeMode;
  /** Called for binary outcome — true = gewusst, false = nicht gewusst. */
  onPickBinary?: (gewusst: boolean) => void;
  /** Called for SRS outcome — 0..3 mapping to Nochmal..Einfach. */
  onPickSrs?: (rating: 0 | 1 | 2 | 3) => void;
  onClose: () => void;
  onApiError?: (msg: string) => void;
}

export default function AICheckPanel({
  front, back, apiKeys, outcome,
  binaryThreshold = 60, defaultProbeMode = 'probe',
  onPickBinary, onPickSrs, onClose, onApiError,
}: Props) {
  const speechSupported = isSpeechRecognitionSupported();
  const [state, setState] = useState<State>(() => ({
    status: 'input',
    mode: speechSupported ? 'mic' : 'text',
    text: '',
    listening: false,
    probeMode: defaultProbeMode,
  }));

  const recognizerRef = useRef<RecognizerHandle | null>(null);
  const micFinalRef = useRef('');

  const stopRecognizer = () => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
  };

  // Cleanup on unmount or card switch
  useEffect(() => () => { if (recognizerRef.current) stopRecognizer(); }, []);

  // ─── State helpers ─────────────────────────────────────────────────────
  const setMode = (mode: AICheckMode) => {
    if (state.status !== 'input') return;
    if (state.listening) stopRecognizer();
    setState({ ...state, mode, listening: false });
  };
  const setProbeMode = (probeMode: AIProbeMode) => {
    if (state.status !== 'input') return;
    setState({ ...state, probeMode });
  };
  const setText = (text: string) => {
    setState(prev => {
      if (prev.status === 'input')   return { ...prev, text };
      if (prev.status === 'probing') return { ...prev, currentText: text };
      return prev;
    });
  };

  const toggleMic = () => {
    if (state.status !== 'input' && state.status !== 'probing') return;

    if (state.listening) {
      stopRecognizer();
      setState(prev => {
        if (prev.status === 'input' || prev.status === 'probing') return { ...prev, listening: false };
        return prev;
      });
      return;
    }

    const seedText = state.status === 'input' ? state.text : state.currentText;
    micFinalRef.current = seedText ? seedText.trimEnd() + ' ' : '';

    const writeText = (value: string) => {
      setState(prev => {
        if (prev.status === 'input')   return { ...prev, text: value };
        if (prev.status === 'probing') return { ...prev, currentText: value };
        return prev;
      });
    };
    const writeListening = (listening: boolean) => {
      setState(prev => {
        if (prev.status === 'input' || prev.status === 'probing') return { ...prev, listening };
        return prev;
      });
    };

    const handle = createRecognizer({
      lang: 'de-DE',
      keepAlive: true,
      onResult: (chunk, isFinal) => {
        if (isFinal) {
          micFinalRef.current += chunk + ' ';
          writeText(micFinalRef.current.trim());
        } else {
          writeText((micFinalRef.current + chunk).trim());
        }
      },
      onEnd: () => {
        recognizerRef.current = null;
        writeListening(false);
      },
      onError: (code, message) => {
        recognizerRef.current = null;
        writeListening(false);
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          onApiError?.('Mikrofon-Zugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen — oder wechsle in den Text-Modus.');
        } else if (code !== 'no-speech' && code !== 'aborted') {
          onApiError?.(`Spracherkennung-Fehler: ${message ?? code}`);
        }
      },
    });
    if (!handle) {
      onApiError?.('Spracherkennung wird in diesem Browser nicht unterstützt — bitte Text-Modus nutzen.');
      return;
    }
    recognizerRef.current = handle;
    handle.start();
    writeListening(true);
  };

  // ─── Submit & probing flow ─────────────────────────────────────────────
  const submitInitial = async () => {
    if (state.status !== 'input') return;
    if (state.listening) stopRecognizer();
    const explanation = state.text.trim();
    if (!explanation) {
      onApiError?.('Bitte erst etwas eintippen oder einsprechen.');
      return;
    }
    const mode = state.mode;
    const probeMode = state.probeMode;
    setState({ status: 'loading', mode, text: explanation, probeMode });

    try {
      if (probeMode === 'strict') {
        const result = await checkAnswerWithAI(apiKeys, front, back, explanation);
        setState({ status: 'result', mode, text: explanation, result });
        return;
      }
      const probeResult = await probeAnswerForGaps(apiKeys, front, back, explanation);
      if (probeResult.kind === 'graded') {
        setState({ status: 'result', mode, text: explanation, result: probeResult.result });
      } else {
        setState({
          status: 'probing', mode,
          originalText: explanation,
          followUps: probeResult.followUps,
          idx: 0,
          answers: [],
          currentText: '',
          listening: false,
        });
      }
    } catch (err) {
      onClose();
      onApiError?.(err instanceof Error ? err.message : 'KI-Prüfung fehlgeschlagen');
    }
  };

  const finalize = async (s: Extract<State, { status: 'probing' }>, lastAnswer: string) => {
    if (s.listening) stopRecognizer();
    const allAnswers = [...s.answers, lastAnswer];
    setState({
      status: 'finalizing', mode: s.mode,
      originalText: s.originalText,
      followUps: s.followUps,
      answers: allAnswers,
    });
    const probes: ProbeAnswer[] = s.followUps.map((q, i) => ({
      question: q,
      answer: allAnswers[i] ?? '',
    }));
    try {
      const result = await finalGradeWithProbes(apiKeys, front, back, s.originalText, probes);
      setState({
        status: 'result', mode: s.mode,
        text: s.originalText,
        result,
        probes,
      });
    } catch (err) {
      onClose();
      onApiError?.(err instanceof Error ? err.message : 'KI-Prüfung fehlgeschlagen');
    }
  };

  const submitProbe = (skip = false) => {
    if (state.status !== 'probing') return;
    if (state.listening) stopRecognizer();

    const answer = skip ? '' : state.currentText.trim();
    if (!skip && !answer) {
      onApiError?.('Bitte erst antworten oder „Überspringen" wählen.');
      return;
    }

    const isLast = state.idx + 1 >= state.followUps.length;
    if (isLast) {
      finalize(state, answer);
    } else {
      setState({
        ...state,
        idx: state.idx + 1,
        answers: [...state.answers, answer],
        currentText: '',
        listening: false,
      });
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="w-full space-y-2.5 p-3 rounded-2xl bg-[#15172a] border border-purple-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🎓</span>
          <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">KI Prüfung</p>
        </div>
        <button
          onClick={onClose}
          className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-all"
        >
          Schließen
        </button>
      </div>

      {state.status === 'input' && (
        <>
          {/* Probe-mode toggle */}
          <div className="flex gap-1 text-[11px] p-0.5 rounded-lg bg-[#1e2130] border border-[#2d3148]">
            <button
              type="button"
              onClick={() => setProbeMode('probe')}
              title="Bei Lücken stellt die KI Folgefragen — wie ein echter Prüfer"
              className={`flex-1 px-2 py-1 rounded-md transition-colors ${
                state.probeMode === 'probe'
                  ? 'bg-purple-500/20 text-purple-200 font-semibold'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              🔍 Nachbohren
            </button>
            <button
              type="button"
              onClick={() => setProbeMode('strict')}
              title="Eine Antwort, sofortige Bewertung"
              className={`flex-1 px-2 py-1 rounded-md transition-colors ${
                state.probeMode === 'strict'
                  ? 'bg-purple-500/20 text-purple-200 font-semibold'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              🎯 Streng
            </button>
          </div>

          {/* Input mode toggle */}
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setMode('mic')}
              disabled={!speechSupported}
              className={`flex-1 px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                state.mode === 'mic'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-[#9ca3af] hover:text-white border border-transparent'
              } ${!speechSupported ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              🎤 Sprechen{!speechSupported && ' (n/a)'}
            </button>
            <button
              type="button"
              onClick={() => setMode('text')}
              className={`flex-1 px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                state.mode === 'text'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-[#9ca3af] hover:text-white border border-transparent'
              }`}
            >
              ⌨️ Tippen
            </button>
          </div>

          <p className="text-[11px] text-[#9ca3af] leading-relaxed">
            Erkläre die Antwort in eigenen Worten. Die KI prüft, ob du den Kern erfasst hast und schlägt eine Bewertung vor.
          </p>

          {state.mode === 'mic' && speechSupported && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`w-full py-3 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  state.listening
                    ? 'bg-red-500/15 border-red-500/40 text-red-300 animate-pulse'
                    : 'bg-purple-500/10 border-purple-500/40 text-purple-300 hover:bg-purple-500/20'
                }`}
              >
                {state.listening ? (
                  <>
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
                    Aufnahme läuft — klicken zum Stoppen
                  </>
                ) : <>🎤 Aufnahme starten</>}
              </button>
              <textarea
                value={state.text}
                onChange={e => setText(e.target.value)}
                placeholder={state.listening ? 'Sprich jetzt — Transkript erscheint hier live…' : 'Klicke auf "Aufnahme starten" oder tippe direkt hier…'}
                rows={4}
                className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>
          )}

          {(state.mode === 'text' || !speechSupported) && (
            <textarea
              value={state.text}
              onChange={e => setText(e.target.value)}
              placeholder="Tippe deine Erklärung hier…"
              rows={5}
              autoFocus
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
            />
          )}

          <button
            type="button"
            onClick={submitInitial}
            disabled={!state.text.trim() || state.listening}
            className="w-full py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            ✨ Bewerten lassen
          </button>
        </>
      )}

      {state.status === 'loading' && (
        <div className="py-4 flex flex-col items-center gap-2">
          <span className="inline-block w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-purple-300">
            {state.probeMode === 'probe' ? 'KI denkt nach…' : 'KI prüft deine Erklärung…'}
          </p>
        </div>
      )}

      {state.status === 'probing' && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-300/80">
                Der Prüfer hakt nach
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-semibold">
                {state.idx + 1} / {state.followUps.length}
              </span>
            </div>
            <div className="flex gap-0.5">
              {state.followUps.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i < state.idx ? 'bg-green-400' :
                    i === state.idx ? 'bg-purple-400' :
                    'bg-[#2d3148]'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <p className="text-[11px] font-semibold text-purple-300/80 uppercase tracking-wider mb-1">Frage</p>
            <p className="text-sm text-white leading-snug">{state.followUps[state.idx]}</p>
          </div>

          {state.mode === 'mic' && speechSupported && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={toggleMic}
                className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  state.listening
                    ? 'bg-red-500/15 border-red-500/40 text-red-300 animate-pulse'
                    : 'bg-purple-500/10 border-purple-500/40 text-purple-300 hover:bg-purple-500/20'
                }`}
              >
                {state.listening ? (
                  <>
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
                    Aufnahme läuft — klicken zum Stoppen
                  </>
                ) : <>🎤 Antwort einsprechen</>}
              </button>
              <textarea
                value={state.currentText}
                onChange={e => setText(e.target.value)}
                placeholder={state.listening ? 'Sprich jetzt…' : 'Klicke auf "Antwort einsprechen" oder tippe direkt hier…'}
                rows={3}
                className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>
          )}

          {(state.mode === 'text' || !speechSupported) && (
            <textarea
              value={state.currentText}
              onChange={e => setText(e.target.value)}
              placeholder="Tippe deine Antwort hier…"
              rows={3}
              autoFocus
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
            />
          )}

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => submitProbe(true)}
              className="px-3 py-2 rounded-xl text-xs text-[#9ca3af] hover:text-white border border-[#2d3148] hover:border-[#3d4168] transition-colors"
            >
              Überspringen
            </button>
            <button
              type="button"
              onClick={() => submitProbe(false)}
              disabled={!state.currentText.trim() || state.listening}
              className="flex-1 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
            >
              {state.idx + 1 >= state.followUps.length ? '✨ Fertig — bewerten' : 'Weiter →'}
            </button>
          </div>

          <p className="text-[10px] text-[#6b7280] leading-relaxed">
            💡 Wie in einer mündlichen Prüfung — Wissen, das hier kommt, zählt voll mit.
          </p>
        </div>
      )}

      {state.status === 'finalizing' && (
        <div className="py-4 flex flex-col items-center gap-2">
          <span className="inline-block w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-purple-300">Prüfer fasst zusammen…</p>
        </div>
      )}

      {state.status === 'result' && (
        <ResultView
          result={state.result}
          userText={state.text}
          probes={state.probes}
          outcome={outcome}
          binaryThreshold={binaryThreshold}
          onPickBinary={onPickBinary}
          onPickSrs={onPickSrs}
        />
      )}
    </div>
  );
}

// ─── Result view ────────────────────────────────────────────────────────────
function ResultView({
  result, userText, probes,
  outcome, binaryThreshold,
  onPickBinary, onPickSrs,
}: {
  result: AnswerCheckResult;
  userText: string;
  probes?: ProbeAnswer[];
  outcome: 'srs' | 'binary';
  binaryThreshold: number;
  onPickBinary?: (g: boolean) => void;
  onPickSrs?: (r: 0 | 1 | 2 | 3) => void;
}) {
  const scoreColor =
    result.score >= 80 ? 'text-green-400 border-green-500/40 bg-green-500/10' :
    result.score >= 50 ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' :
    'text-red-400 border-red-500/40 bg-red-500/10';

  const scoreEmoji = result.score >= 80 ? '🎉' : result.score >= 50 ? '👍' : '📚';
  const recommendsGewusst = result.score >= binaryThreshold;

  return (
    <div className="space-y-3">
      {/* Score header */}
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${scoreColor}`}>
        <span className="text-2xl">{scoreEmoji}</span>
        <div className="flex-1">
          <p className="text-sm font-bold">{result.score} / 100</p>
          {result.reasoning && (
            <p className="text-[11px] opacity-90 leading-snug mt-0.5">{result.reasoning}</p>
          )}
        </div>
      </div>

      {userText && (
        <details className="group">
          <summary className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest cursor-pointer hover:text-[#9ca3af]">
            Deine Erklärung anzeigen
          </summary>
          <p className="text-[11px] text-[#9ca3af] mt-1 px-2 py-1.5 rounded-lg bg-[#1e2130] border border-[#2d3148] leading-relaxed italic">
            „{userText}"
          </p>
        </details>
      )}

      {probes && probes.length > 0 && (
        <details className="group" open>
          <summary className="text-[10px] font-semibold text-purple-300/80 uppercase tracking-widest cursor-pointer hover:text-purple-300">
            🔍 Nachfragen ({probes.length})
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {probes.map((p, i) => {
              const skipped = !p.answer.trim();
              return (
                <div key={i} className="px-2 py-1.5 rounded-lg bg-[#1e2130] border border-[#2d3148] space-y-1">
                  <p className="text-[11px] text-purple-300/90 leading-snug">
                    <span className="opacity-60 mr-1">F{i + 1}:</span>{p.question}
                  </p>
                  <p className={`text-[11px] leading-snug ${skipped ? 'text-[#6b7280] italic' : 'text-[#d1d5db]'}`}>
                    <span className="opacity-60 mr-1">A:</span>
                    {skipped ? '(übersprungen)' : `„${p.answer}"`}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {result.captured.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-green-400/80 uppercase tracking-widest px-1">✓ Du hattest</p>
          <ul className="space-y-0.5 px-1">
            {result.captured.map((c, i) => (
              <li key={i} className="text-[11px] text-green-300/90 leading-snug flex gap-1.5">
                <span className="opacity-60 shrink-0">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.missing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-red-400/80 uppercase tracking-widest px-1">✗ Was gefehlt hat</p>
          <ul className="space-y-0.5 px-1">
            {result.missing.map((m, i) => (
              <li key={i} className="text-[11px] text-red-300/90 leading-snug flex gap-1.5">
                <span className="opacity-60 shrink-0">•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outcome buttons */}
      <div className="space-y-1.5 pt-1 border-t border-white/5">
        {outcome === 'binary' ? (
          <>
            <p className="text-[10px] text-[#6b7280] px-1 leading-snug">
              {recommendsGewusst
                ? `KI-Empfehlung: ✓ Gewusst (≥${binaryThreshold} Punkte)`
                : `KI-Empfehlung: ✗ Nicht gewusst (<${binaryThreshold} Punkte)`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onPickBinary?.(false)}
                className={`py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  !recommendsGewusst
                    ? 'bg-red-500/20 border-red-500/50 text-red-300 ring-1 ring-red-500/30'
                    : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                }`}
              >
                ❌ Nicht gewusst
              </button>
              <button
                onClick={() => onPickBinary?.(true)}
                className={`py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  recommendsGewusst
                    ? 'bg-green-500/20 border-green-500/50 text-green-300 ring-1 ring-green-500/30'
                    : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                }`}
              >
                ✅ Gewusst
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[10px] text-[#6b7280] px-1">
              KI-Empfehlung: <strong className="text-purple-300">{['Nochmal', 'Schwer', 'Gut', 'Einfach'][result.suggestedRating]}</strong>
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {(['Nochmal', 'Schwer', 'Gut', 'Einfach'] as const).map((label, i) => (
                <button
                  key={label}
                  onClick={() => onPickSrs?.(i as 0 | 1 | 2 | 3)}
                  className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                    result.suggestedRating === i
                      ? 'bg-purple-500/20 border border-purple-500/50 text-purple-300 ring-1 ring-purple-500/30'
                      : 'bg-[#1e2130] border border-[#2d3148] text-[#9ca3af] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

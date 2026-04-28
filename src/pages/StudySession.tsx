import { useState, useMemo, useRef, useEffect } from 'react';
import type { Flashcard, AppSettings, RatingValue, CardSet, CardLink } from '../types/card';
import { isDueToday, STUDY_RATINGS } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import MarkdownText from '../components/MarkdownText';
import { LinkedCardsPanel } from '../components/LinkedCards';
import QuickEditModal from '../components/QuickEditModal';
import { getNewCardsDoneToday } from '../utils/dailyGoal';
import { generateMCHintBundle } from '../utils/geminiMCHint';
import type { MCHintResult } from '../utils/geminiMCHint';
import { checkAnswerWithAI, probeAnswerForGaps, finalGradeWithProbes } from '../utils/aiAnswerCheck';
import type { AnswerCheckResult, ProbeAnswer } from '../utils/aiAnswerCheck';
import { isSpeechRecognitionSupported, createRecognizer } from '../utils/speechRecognition';
import type { RecognizerHandle } from '../utils/speechRecognition';

export interface DailyPlanSession {
  reviewCards: Flashcard[];
  newCards: Flashcard[];
  totalPlanned: number;
}

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  sets: CardSet[];
  links: CardLink[];
  preFilteredCards?: Flashcard[] | null;
  dailyPlan?: DailyPlanSession | null;
  onRate: (id: string, rating: RatingValue) => void;
  onUpdateCard: (id: string, data: Partial<Flashcard>) => void;
  onDeleteCard: (id: string) => void;
  onSplitCard?: (cardId: string, afterSplit: (newCardIds: string[]) => void) => void;
  onSessionComplete: () => void;
  onNavigate: (page: string) => void;
  onApiError?: (message: string) => void;
}

type SessionState = 'setup' | 'studying' | 'summary';
type StudyOrder = 'new-first' | 'review-first' | 'mixed';

/** One learner answer attempt — tracks what was picked and whether it was right. */
interface MCAnswer { selected: string[]; isCorrect: boolean }

/** MC hint state — bundle of up to 3 questions, stepped through one by one.
 *  Null means idle; cardId auto-invalidates when card changes. */
type MCHintState =
  | { cardId: string; status: 'loading' }
  | { cardId: string; status: 'ready';     questions: MCHintResult[]; index: number; answers: MCAnswer[]; selected: string[] }
  | { cardId: string; status: 'submitted'; questions: MCHintResult[]; index: number; answers: MCAnswer[]; selected: string[]; isCorrect: boolean }
  | { cardId: string; status: 'finished';  questions: MCHintResult[]; answers: MCAnswer[] };

/** AI Prüfung — learner explains the answer in their own words (mic or text)
 *  and the AI grades the explanation, suggests a rating. Pure learning aid;
 *  the user still taps the actual rating button themselves.
 *
 *  Two grading styles:
 *  - 'strict' = one-shot grading (legacy behaviour)
 *  - 'probe'  = examiner-style: AI asks 1–3 follow-ups for missing aspects
 *               *before* finalising the grade — credits knowledge the learner
 *               has but didn't volunteer in the first answer. */
type AICheckMode = 'text' | 'mic';
type AIProbeMode = 'strict' | 'probe';
type AICheckState =
  | { cardId: string; status: 'input';      mode: AICheckMode; text: string; listening: boolean; probeMode: AIProbeMode }
  | { cardId: string; status: 'loading';    mode: AICheckMode; text: string; probeMode: AIProbeMode }
  // Nachbohren phase: stepping through follow-up questions one at a time.
  // `idx` points at the current unanswered follow-up. `answers[i]` matches
  // `followUps[i]`; entries beyond `idx` are not yet collected.
  | { cardId: string; status: 'probing';    mode: AICheckMode; originalText: string;
      followUps: string[]; idx: number; answers: string[]; currentText: string; listening: boolean }
  | { cardId: string; status: 'finalizing'; mode: AICheckMode; originalText: string;
      followUps: string[]; answers: string[] }
  | { cardId: string; status: 'result';     mode: AICheckMode; text: string; result: AnswerCheckResult;
      probes?: ProbeAnswer[] };

interface RatingCount {
  nochmal: number; schwer: number; gut: number; einfach: number;
}

export default function StudySession({ cards, settings, sets, links, preFilteredCards, dailyPlan, onRate, onUpdateCard, onDeleteCard, onSplitCard, onSessionComplete, onNavigate, onApiError }: Props) {
  const isDailyMode = !!dailyPlan;

  // Restore in-progress study session from sessionStorage on mount.
  // Reasons we want this: (a) refresh / accidental F5; (b) foldable Android
  // phones reload the page on unfold (config change); (c) Safari tab eviction.
  // We only restore the 'studying' phase — 'setup' isn't worth restoring,
  // 'summary' is terminal. Card data is re-resolved from the live `cards`
  // prop so post-restore card edits / sync updates are reflected. If any
  // persisted card was deleted in the meantime, it's silently dropped.
  const restoredSession = useMemo<{
    sessionCards: Flashcard[];
    currentIdx: number;
    ratings: RatingCount;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem('studySession:state');
      if (!raw) return null;
      const obj = JSON.parse(raw) as {
        sessionState?: SessionState;
        cardIds?: string[];
        currentIdx?: number;
        ratings?: RatingCount;
      };
      if (obj.sessionState !== 'studying' || !Array.isArray(obj.cardIds)) return null;
      const resolved = obj.cardIds
        .map(id => cards.find(c => c.id === id))
        .filter((c): c is Flashcard => !!c);
      if (resolved.length === 0) return null;
      return {
        sessionCards: resolved,
        currentIdx: Math.min(Math.max(obj.currentIdx ?? 0, 0), resolved.length - 1),
        ratings: obj.ratings ?? { nochmal: 0, schwer: 0, gut: 0, einfach: 0 },
      };
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally one-shot — only attempt restoration on first mount

  const [sessionState, setSessionState] = useState<SessionState>(restoredSession ? 'studying' : 'setup');
  const [studyOrder, setStudyOrder] = useState<StudyOrder>(
    () => (localStorage.getItem('study_order') as StudyOrder) ?? 'review-first'
  );
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminers, setFilterExaminers] = useState<string[]>([]);
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterSet, setFilterSet] = useState('');
  const [onlyDue, setOnlyDue] = useState(true);
  const [filterKlassiker, setFilterKlassiker] = useState(false);
  const [sortByProbability, setSortByProbability] = useState(false);
  const [endlessMode, setEndlessMode] = useState(false);
  const [sessionCards, setSessionCards] = useState<Flashcard[]>(restoredSession?.sessionCards ?? []);
  const [currentIdx, setCurrentIdx] = useState(restoredSession?.currentIdx ?? 0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<RatingCount>(
    restoredSession?.ratings ?? { nochmal: 0, schwer: 0, gut: 0, einfach: 0 }
  );
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [splitInProgress, setSplitInProgress] = useState(false);
  const [mcHint, setMcHint] = useState<MCHintState | null>(null);
  const [aiCheck, setAiCheck] = useState<AICheckState | null>(null);
  const recognizerRef = useRef<RecognizerHandle | null>(null);
  const micFinalRef = useRef(''); // accumulated final transcript across interim chunks
  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);

  // Cards available for setup
  const availableCards = useMemo(() => {
    let result = preFilteredCards ?? cards;
    if (!preFilteredCards) {
      if (filterSubject) result = result.filter(c => c.subjects?.includes(filterSubject));
      if (filterExaminers.length > 0) {
        result = result.filter(c => c.examiners?.some(e => filterExaminers.includes(e)));
      }
      if (filterDifficulty) result = result.filter(c => c.difficulty === filterDifficulty);
      if (filterSet) result = result.filter(c => c.setId === filterSet);
      if (!endlessMode && onlyDue) result = result.filter(isDueToday);
      if (filterKlassiker) result = result.filter(c => (c.probabilityPercent ?? 0) > 60);

      // When "Nur fällige" is on (and Endlos is off), respect the daily new-card
      // quota — same cap that calculateDailyPlan applies. Without this, all
      // unseen cards (rep=0) read as "due today" because their nextReviewDate
      // defaults to creation-day, leading to absurd counts like "1008 Neu"
      // instead of the meaningful "remaining new cards for today".
      //
      // Read-only operation — does NOT touch firstStudiedAt, snapshot, or any
      // counter. When the user rates a card here, the normal handleRate
      // pipeline increments newCardsDone correctly and the cap shrinks by 1
      // on the next render. Identical behavior to the Tagesplan flow.
      if (!endlessMode && onlyDue) {
        const remainingNew = Math.max(0, settings.dailyNewCardGoal - getNewCardsDoneToday(cards, settings));
        // "Truly unseen" = same definition as calculateDailyPlan. Excludes
        // Nochmal'd cards (rep=0, interval=1) — those are reviews, not new.
        const isUnseen = (c: Flashcard) => c.repetitions === 0 && c.interval === 0;
        const unseen = result.filter(isUnseen).slice(0, remainingNew);
        const others = result.filter(c => !isUnseen(c));
        result = [...unseen, ...others];
      }

      if (sortByProbability) result = [...result].sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    }
    return result;
  }, [cards, preFilteredCards, filterSubject, filterExaminers, filterDifficulty, filterSet, onlyDue, endlessMode, filterKlassiker, sortByProbability, settings]);

  const applyStudyOrder = (newCards: Flashcard[], reviewCards: Flashcard[]): Flashcard[] => {
    if (studyOrder === 'new-first') return [...newCards, ...reviewCards];
    if (studyOrder === 'review-first') return [...reviewCards, ...newCards];
    // mixed: interleave randomly
    return [...newCards, ...reviewCards].sort(() => Math.random() - 0.5);
  };

  const handleOrderChange = (order: StudyOrder) => {
    setStudyOrder(order);
    localStorage.setItem('study_order', order);
  };

  const startSession = () => {
    let ordered: Flashcard[];

    if (dailyPlan) {
      const sNew = [...dailyPlan.newCards].sort(() => Math.random() - 0.5);
      const sReview = [...dailyPlan.reviewCards].sort(() => Math.random() - 0.5);
      ordered = applyStudyOrder(sNew, sReview);
    } else {
      if (availableCards.length === 0) return;
      // "Truly unseen" — rep=0 AND interval=0. Nochmal'd cards (rep=0, int=1)
      // belong in the review bucket, same as calculateDailyPlan treats them.
      const isUnseen = (c: Flashcard) => c.repetitions === 0 && c.interval === 0;
      const newCards = availableCards.filter(isUnseen).sort(() => Math.random() - 0.5);
      const reviewSource = availableCards.filter(c => !isUnseen(c));
      const reviewCards = sortByProbability
        ? reviewSource.sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0))
        : reviewSource.sort(() => Math.random() - 0.5);
      ordered = applyStudyOrder(newCards, reviewCards);
    }

    if (ordered.length === 0) return;
    setSessionCards(ordered);
    setCurrentIdx(0);
    setIsFlipped(false);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  const handleDeleteCurrent = () => {
    const card = sessionCards[currentIdx];
    // Remove from session queue
    const next = sessionCards.filter((_, i) => i !== currentIdx);
    onDeleteCard(card.id);
    setConfirmDeleteId(null);
    setIsFlipped(false);
    if (next.length === 0) {
      setSessionState('summary');
    } else {
      setSessionCards(next);
      // currentIdx stays — the next card slides into this slot; clamp if we deleted the last
      if (currentIdx >= next.length) setCurrentIdx(next.length - 1);
    }
  };

  const handleSplitCurrent = () => {
    if (!onSplitCard) return;
    const card = sessionCards[currentIdx];
    setSplitInProgress(true);
    onSplitCard(card.id, (newCardIds) => {
      setSplitInProgress(false);
      // Replace original in session with the first new card; second card goes into deck only.
      setSessionCards(prev => {
        const updated = [...prev];
        const firstNewCard = cards.find(c => c.id === newCardIds[0]);
        if (firstNewCard) {
          updated[currentIdx] = firstNewCard;
        } else {
          // Card not yet in prop (shouldn't happen) — just remove it
          updated.splice(currentIdx, 1);
          if (updated.length === 0) setSessionState('summary');
          else if (currentIdx >= updated.length) setCurrentIdx(updated.length - 1);
        }
        return updated;
      });
      setIsFlipped(false);
    });
  };

  const handleRequestMCHint = async () => {
    if (!currentCard) return;
    const cardId = currentCard.id;
    setMcHint({ cardId, status: 'loading' });
    try {
      const bundle = await generateMCHintBundle(
        { gemini: settings.geminiApiKey, anthropic: settings.anthropicApiKey, groq: settings.groqApiKey },
        currentCard.front,
        currentCard.back,
        3,
      );
      setMcHint({ cardId, status: 'ready', questions: bundle.questions, index: 0, answers: [], selected: [] });
    } catch (err) {
      setMcHint(null);
      onApiError?.(err instanceof Error ? err.message : 'MC-Tipp konnte nicht generiert werden');
    }
  };

  // ── AI Prüfung handlers ───────────────────────────────────────────────────
  const stopRecognizer = () => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
  };

  const handleStartAICheck = () => {
    if (!currentCard) return;
    // Prefer mic if browser supports it — user can toggle to text instantly.
    // Default probing style: nachbohrend (probe). User can flip per-session.
    setAiCheck({
      cardId: currentCard.id,
      status: 'input',
      mode: speechSupported ? 'mic' : 'text',
      text: '',
      listening: false,
      probeMode: 'probe',
    });
  };

  const handleSetAICheckMode = (mode: AICheckMode) => {
    if (!aiCheck || aiCheck.status !== 'input') return;
    if (aiCheck.listening) stopRecognizer();
    setAiCheck({ ...aiCheck, mode, listening: false });
  };

  const handleSetAICheckProbeMode = (probeMode: AIProbeMode) => {
    if (!aiCheck || aiCheck.status !== 'input') return;
    setAiCheck({ ...aiCheck, probeMode });
  };

  const handleSetAICheckText = (text: string) => {
    if (!aiCheck) return;
    if (aiCheck.status === 'input')   setAiCheck({ ...aiCheck, text });
    else if (aiCheck.status === 'probing') setAiCheck({ ...aiCheck, currentText: text });
  };

  const handleToggleMic = () => {
    if (!aiCheck) return;
    if (aiCheck.status !== 'input' && aiCheck.status !== 'probing') return;

    if (aiCheck.listening) {
      stopRecognizer();
      // Cast: both 'input' and 'probing' have a `listening` flag.
      setAiCheck(prev => {
        if (!prev) return prev;
        if (prev.status === 'input' || prev.status === 'probing') return { ...prev, listening: false };
        return prev;
      });
      return;
    }
    // Start a fresh recognizer; seed the "final" buffer with whatever text
    // the user already has so additional speech appends instead of replacing.
    const seedText = aiCheck.status === 'input' ? aiCheck.text : aiCheck.currentText;
    micFinalRef.current = seedText ? seedText.trimEnd() + ' ' : '';

    const writeText = (value: string) => {
      setAiCheck(prev => {
        if (!prev) return prev;
        if (prev.status === 'input')   return { ...prev, text: value };
        if (prev.status === 'probing') return { ...prev, currentText: value };
        return prev;
      });
    };
    const writeListening = (listening: boolean) => {
      setAiCheck(prev => {
        if (!prev) return prev;
        if (prev.status === 'input' || prev.status === 'probing') return { ...prev, listening };
        return prev;
      });
    };

    const handle = createRecognizer({
      lang: 'de-DE',
      keepAlive: true, // mobile browsers auto-end on silence; restart silently
      onResult: (chunk, isFinal) => {
        if (isFinal) {
          micFinalRef.current += chunk + ' ';
          writeText(micFinalRef.current.trim());
        } else {
          // interim — show as preview after the committed text
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

  const handleSubmitAICheck = async () => {
    if (!currentCard || !aiCheck || aiCheck.status !== 'input') return;
    if (aiCheck.listening) stopRecognizer();
    const explanation = aiCheck.text.trim();
    if (!explanation) {
      onApiError?.('Bitte erst etwas eintippen oder einsprechen.');
      return;
    }
    const cardId = currentCard.id;
    const mode = aiCheck.mode;
    const probeMode = aiCheck.probeMode;
    setAiCheck({ cardId, status: 'loading', mode, text: explanation, probeMode });

    const keys = { gemini: settings.geminiApiKey, anthropic: settings.anthropicApiKey, groq: settings.groqApiKey };

    try {
      if (probeMode === 'strict') {
        const result = await checkAnswerWithAI(keys, currentCard.front, currentCard.back, explanation);
        setAiCheck({ cardId, status: 'result', mode, text: explanation, result });
        return;
      }

      // Nachbohren: ask AI whether to probe or grade directly
      const probeResult = await probeAnswerForGaps(keys, currentCard.front, currentCard.back, explanation);
      if (probeResult.kind === 'graded') {
        setAiCheck({ cardId, status: 'result', mode, text: explanation, result: probeResult.result });
      } else {
        setAiCheck({
          cardId, status: 'probing', mode,
          originalText: explanation,
          followUps: probeResult.followUps,
          idx: 0,
          answers: [],
          currentText: '',
          listening: false,
        });
      }
    } catch (err) {
      setAiCheck(null);
      onApiError?.(err instanceof Error ? err.message : 'KI-Prüfung fehlgeschlagen');
    }
  };

  // Finalize the probing phase: collect all probe answers, ask AI for the
  // overall grade across original answer + probe Q&As.
  const finalizeProbes = async (state: Extract<AICheckState, { status: 'probing' }>, lastAnswer: string) => {
    if (!currentCard) return;
    if (state.listening) stopRecognizer();

    const allAnswers = [...state.answers, lastAnswer];
    const cardId = currentCard.id;
    setAiCheck({
      cardId, status: 'finalizing', mode: state.mode,
      originalText: state.originalText,
      followUps: state.followUps,
      answers: allAnswers,
    });

    const probes: ProbeAnswer[] = state.followUps.map((q, i) => ({
      question: q,
      answer: allAnswers[i] ?? '',
    }));

    try {
      const result = await finalGradeWithProbes(
        { gemini: settings.geminiApiKey, anthropic: settings.anthropicApiKey, groq: settings.groqApiKey },
        currentCard.front,
        currentCard.back,
        state.originalText,
        probes,
      );
      setAiCheck({
        cardId, status: 'result', mode: state.mode,
        text: state.originalText,
        result,
        probes,
      });
    } catch (err) {
      setAiCheck(null);
      onApiError?.(err instanceof Error ? err.message : 'KI-Prüfung fehlgeschlagen');
    }
  };

  // Submit the answer to the current follow-up. Either advance to the next
  // follow-up or kick off finalization.
  const handleSubmitProbe = (skip = false) => {
    if (!aiCheck || aiCheck.status !== 'probing') return;
    if (aiCheck.listening) stopRecognizer();

    const answer = skip ? '' : aiCheck.currentText.trim();
    if (!skip && !answer) {
      onApiError?.('Bitte erst antworten oder „Überspringen" wählen.');
      return;
    }

    const isLast = aiCheck.idx + 1 >= aiCheck.followUps.length;
    if (isLast) {
      finalizeProbes(aiCheck, answer);
    } else {
      setAiCheck({
        ...aiCheck,
        idx: aiCheck.idx + 1,
        answers: [...aiCheck.answers, answer],
        currentText: '',
        listening: false,
      });
    }
  };

  const handleCloseAICheck = () => {
    if (recognizerRef.current) stopRecognizer();
    setAiCheck(null);
  };

  // Cleanup recognizer if the card changes or component unmounts mid-recording.
  useEffect(() => {
    return () => { if (recognizerRef.current) stopRecognizer(); };
  }, []);

  // Persist the in-progress 'studying' state to sessionStorage so a reload
  // (refresh, foldable unfold, tab restore) can resume at the same card
  // instead of dumping the user back on the dashboard. We persist only
  // card IDs (full data is re-resolved from `cards` on restore — picks up
  // any sync updates) plus position and rating counts.
  useEffect(() => {
    try {
      if (sessionState === 'studying' && sessionCards.length > 0) {
        sessionStorage.setItem('studySession:state', JSON.stringify({
          sessionState,
          cardIds: sessionCards.map(c => c.id),
          currentIdx,
          ratings,
        }));
      } else {
        // setup or summary — clear; nothing useful to resume
        sessionStorage.removeItem('studySession:state');
      }
    } catch { /* sessionStorage unavailable / quota — fail silently */ }
  }, [sessionState, sessionCards, currentIdx, ratings]);

  const handleRate = (rating: RatingValue) => {
    const card = sessionCards[currentIdx];
    setConfirmDeleteId(null);
    onRate(card.id, rating);
    const key = ['nochmal', 'schwer', 'gut', 'einfach'][rating] as keyof RatingCount;
    setRatings(prev => ({ ...prev, [key]: prev[key] + 1 }));
    setIsFlipped(false);

    if (rating === 0) {
      // Re-queue at end — session continues until every card is rated ≥ 1
      setSessionCards(prev => {
        const rest = prev.filter((_, i) => i !== currentIdx);
        return [...rest, card];
      });
      // currentIdx stays the same — next card slides into this position
    } else if (currentIdx + 1 >= sessionCards.length) {
      setSessionState('summary');
    } else {
      setCurrentIdx(idx => idx + 1);
    }
  };

  const currentCard = sessionCards[currentIdx];
  // Auto-invalidate MC hint when the card changes
  const effectiveMcHint = mcHint?.cardId === currentCard?.id ? mcHint : null;
  // Same for AI Prüfung — also stop any active recognizer when card changes
  const effectiveAiCheck = aiCheck?.cardId === currentCard?.id ? aiCheck : null;
  useEffect(() => {
    if (aiCheck && aiCheck.cardId !== currentCard?.id) {
      if (recognizerRef.current) stopRecognizer();
      setAiCheck(null);
    }
  }, [currentCard?.id, aiCheck]);

  const imgSrc = (img: Flashcard['frontImage']) => img
    ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data)
    : null;

  if (sessionState === 'setup') {
    // Compute new/review split for the preview
    // "Truly unseen" — rep=0 AND interval=0, same as calculateDailyPlan.
    // Nochmal'd cards (rep=0, interval=1) count as reviews here.
    const previewNew = isDailyMode
      ? dailyPlan!.newCards.length
      : availableCards.filter(c => c.repetitions === 0 && c.interval === 0).length;
    const previewReview = isDailyMode
      ? dailyPlan!.reviewCards.length
      : availableCards.filter(c => !(c.repetitions === 0 && c.interval === 0)).length;
    const previewTotal = isDailyMode ? dailyPlan!.totalPlanned : availableCards.length;
    const canStart = previewTotal > 0;

    const ORDER_OPTIONS: { value: StudyOrder; icon: string; label: string; desc: string }[] = [
      { value: 'review-first', icon: '🔁', label: 'Wiederholen zuerst', desc: 'Bekanntes auffrischen — gut für anstrengende Tage' },
      { value: 'new-first',    icon: '🆕', label: 'Neue zuerst',        desc: 'Frisches Wissen während der Kopf noch fit ist' },
      { value: 'mixed',        icon: '🔀', label: 'Gemischt',           desc: 'Alles durchgemischt — wissenschaftlich am effektivsten' },
    ];

    return (
      <div className="p-4 md:p-6 lg:p-8 fade-in">
        <div className="max-w-lg mx-auto">
          <h2 className="text-2xl font-bold text-white mb-1">
            {isDailyMode ? '📅 Tagesplan' : '📚 Lern-Session'}
          </h2>
          <p className="text-[#9ca3af] text-sm mb-6">
            {isDailyMode ? 'Dein gesteuerter Tagesplan' : 'Wähle deine Filter und beginne zu lernen'}
          </p>

          {/* Card breakdown preview */}
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 mb-4">
            <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Heute wartet auf dich</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">{previewNew}</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">🆕 Neu</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-purple-400">{previewReview}</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">🔁 Wiederholen</p>
              </div>
              <div className={`rounded-xl p-3 text-center border ${canStart ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-[#252840] border-[#2d3148]'}`}>
                <p className={`text-2xl font-bold ${canStart ? 'text-indigo-400' : 'text-[#6b7280]'}`}>{previewTotal}</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">∑ Gesamt</p>
              </div>
            </div>

            {/* Order selector */}
            <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Reihenfolge</p>
            <div className="space-y-2">
              {ORDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleOrderChange(opt.value)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    studyOrder === opt.value
                      ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
                      : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white hover:border-[#3d4168]'
                  }`}
                >
                  <span className="text-lg shrink-0">{opt.icon}</span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${studyOrder === opt.value ? 'text-indigo-300' : ''}`}>{opt.label}</p>
                    <p className="text-xs text-[#6b7280] mt-0.5 leading-snug">{opt.desc}</p>
                  </div>
                  {studyOrder === opt.value && (
                    <span className="ml-auto shrink-0 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Filters — only in non-daily mode */}
          {!isDailyMode && (
            <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
              <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider">Filter</p>
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">Fach</label>
                <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
                  <option value="">Alle Fächer</option>
                  {settings.subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                    Prüfer {filterExaminers.length > 0 && `(${filterExaminers.length})`}
                  </label>
                  {filterExaminers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setFilterExaminers([])}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Alle abwählen
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {settings.examiners.map(e => {
                    const selected = filterExaminers.includes(e);
                    return (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setFilterExaminers(prev =>
                          selected ? prev.filter(x => x !== e) : [...prev, e]
                        )}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                          selected
                            ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                            : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                        }`}
                      >
                        {e}
                      </button>
                    );
                  })}
                </div>
                {filterExaminers.length === 0 && (
                  <p className="text-xs text-[#6b7280] mt-1.5">Nichts ausgewählt = alle Prüfer</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">Schwierigkeit</label>
                <select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
                  <option value="">Alle</option>
                  <option value="einfach">Einfach</option>
                  <option value="mittel">Mittel</option>
                  <option value="schwer">Schwer</option>
                </select>
              </div>
              {sets.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">Set</label>
                  <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                    className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
                    <option value="">Alle Sets</option>
                    {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <label className="flex items-start gap-3 cursor-pointer">
                <div onClick={() => setOnlyDue(!onlyDue)}
                  className={`w-10 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${onlyDue ? 'bg-indigo-500' : 'bg-[#2d3148]'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${onlyDue ? 'left-5' : 'left-1'}`} />
                </div>
                <div>
                  <span className="text-sm text-white">Nur fällige Karten (Tagesplan)</span>
                  <p className="text-xs text-[#6b7280] mt-0.5">
                    Neue Karten respektieren das Tageslimit ({settings.dailyNewCardGoal}/Tag), Wiederholungen wie geplant
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div onClick={() => setFilterKlassiker(!filterKlassiker)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${filterKlassiker ? 'bg-red-500' : 'bg-[#2d3148]'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${filterKlassiker ? 'left-5' : 'left-1'}`} />
                </div>
                <span className="text-sm text-white">🔥 Nur Klassiker (&gt;60% Wahrscheinlichkeit)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div onClick={() => setSortByProbability(!sortByProbability)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${sortByProbability ? 'bg-amber-500' : 'bg-[#2d3148]'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${sortByProbability ? 'left-5' : 'left-1'}`} />
                </div>
                <span className="text-sm text-white">📊 Nach Wahrscheinlichkeit sortieren</span>
              </label>
              <div className="border-t border-[#2d3148] pt-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div onClick={() => setEndlessMode(!endlessMode)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${endlessMode ? 'bg-violet-500' : 'bg-[#2d3148]'}`}>
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${endlessMode ? 'left-5' : 'left-1'}`} />
                  </div>
                  <div>
                    <span className="text-sm text-white">♾️ Endlos-Modus</span>
                    <p className="text-xs text-[#6b7280] mt-0.5">Alle Karten ohne Tageslimit — fällige UND nicht-fällige</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button onClick={() => onNavigate('dashboard')}
              className="flex-1 py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors font-medium">
              Zurück
            </button>
            <button
              onClick={startSession}
              disabled={!canStart}
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
            >
              ▶ Los geht's
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionState === 'summary') {
    const total = sessionCards.length;
    const good = ratings.gut + ratings.einfach;
    const pct = Math.round((good / total) * 100);

    // Daily goal completion check
    const sessionCompleted = ratings.nochmal + ratings.schwer + ratings.gut + ratings.einfach;
    const dailyGoalReached = isDailyMode && dailyPlan && sessionCompleted >= dailyPlan.totalPlanned;
    const dailyRemaining = isDailyMode && dailyPlan ? Math.max(0, dailyPlan.totalPlanned - sessionCompleted) : 0;

    return (
      <div className="p-4 md:p-6 lg:p-8 fade-in">
        <div className="max-w-md mx-auto text-center">
          <div className="text-6xl mb-4">{pct >= 80 ? '🎉' : pct >= 50 ? '📚' : '💪'}</div>
          <h2 className="text-2xl font-bold text-white mb-1">Session abgeschlossen!</h2>
          <p className="text-[#9ca3af] text-sm mb-3">{total} Karten durchgegangen</p>

          {/* Daily goal status */}
          {isDailyMode && (
            <div className={`mb-4 px-4 py-2.5 rounded-xl border text-sm font-semibold ${
              dailyGoalReached
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {dailyGoalReached
                ? '✅ Tagesziel erreicht!'
                : `Noch ${dailyRemaining} Karte${dailyRemaining !== 1 ? 'n' : ''} für heute übrig`}
            </div>
          )}

          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 mb-6">
            <div className="text-4xl font-bold text-white mb-1">{pct}%</div>
            <p className="text-[#9ca3af] text-sm mb-4">Gut + Einfach</p>
            <div className="w-full h-3 bg-[#252840] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <RatingSummaryCard label="Nochmal" count={ratings.nochmal} color="text-red-400" bg="bg-red-500/10 border-red-500/20" />
            <RatingSummaryCard label="Schwer"  count={ratings.schwer}  color="text-amber-400" bg="bg-amber-500/10 border-amber-500/20" />
            <RatingSummaryCard label="Gut"     count={ratings.gut}     color="text-green-400" bg="bg-green-500/10 border-green-500/20" />
            <RatingSummaryCard label="Einfach" count={ratings.einfach} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/20" />
          </div>

          {settings.examDate && (
            <p className="text-xs text-[#6b7280] mb-4 px-2 leading-relaxed">
              📅 Lernmodus: Prüfungsvorbereitung aktiv – Intervalle werden an dein Prüfungsdatum angepasst
            </p>
          )}

          <div className="flex gap-3">
            <button onClick={startSession}
              className="flex-1 py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors font-medium">
              Wiederholen
            </button>
            <button onClick={() => { onSessionComplete(); onNavigate('dashboard'); }}
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition-colors">
              Fertig
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Studying state
  if (!currentCard) return null;
  const frontImg = imgSrc(currentCard.frontImage);
  const backImg = imgSrc(currentCard.backImage);
  const progress = ((currentIdx) / sessionCards.length) * 100;

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#0f1117] fade-in">
      {/* Image lightbox */}
      {zoomedImg && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomedImg(null)}
        >
          <img src={zoomedImg} alt="" className="max-w-full max-h-full object-contain rounded-xl" />
          <button className="absolute top-4 right-4 text-white text-3xl leading-none">✕</button>
        </div>
      )}
      {/* Progress bar */}
      <div className="shrink-0">
        <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-[#2d3148]">
          <button onClick={() => setSessionState('setup')} className="text-[#9ca3af] hover:text-white text-sm transition-colors">
            ✕ Beenden
          </button>
          <span className="text-sm text-[#9ca3af] font-medium">{currentIdx + 1} / {sessionCards.length}</span>
          <DifficultyBadge difficulty={currentCard.difficulty} />
        </div>
        <div className="h-1 bg-[#2d3148]">
          <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center px-2 md:px-4 py-2 min-h-0">
        <div key={currentCard.id} className="w-full max-w-5xl flex-1 perspective min-h-0">
          <div
            className="card-inner cursor-pointer"
            style={{ transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
            onClick={() => setIsFlipped(f => !f)}
          >
            {/* Front */}
            <div className="card-face bg-[#1e2130] border border-[#2d3148] rounded-3xl flex flex-col select-none">
              <div className="shrink-0 pt-5 pb-2 text-center">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Frage</span>
              </div>
              <div className="flex-1 overflow-y-auto px-6 md:px-10 pb-4 flex flex-col items-start gap-3">
                {frontImg && <img src={frontImg} alt="" onClick={e => { e.stopPropagation(); setZoomedImg(frontImg); }} className="max-h-40 max-w-full object-contain rounded-xl cursor-zoom-in" />}
                <p className="text-lg md:text-xl font-medium text-white text-left leading-relaxed w-full">
                  <MarkdownText text={currentCard.front} />
                </p>

                {/* MC Hint section — only if Gemini key is configured */}
                {(settings.geminiApiKey || settings.anthropicApiKey || settings.groqApiKey) && (
                  <div className="w-full mt-1 border-t border-[#2d3148]/60 pt-3" onClick={e => e.stopPropagation()}>
                    {!effectiveMcHint && (
                      <button
                        onClick={handleRequestMCHint}
                        className="flex items-center gap-2 text-xs text-[#6b7280] hover:text-indigo-400 transition-colors py-1 group"
                      >
                        <span className="text-sm group-hover:scale-110 transition-transform">💡</span>
                        <span>Tipp als MC-Frage generieren</span>
                      </button>
                    )}
                    {effectiveMcHint?.status === 'loading' && (
                      <div className="flex items-center gap-2 text-xs text-indigo-400 animate-pulse">
                        <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span>Generiere Tipp…</span>
                      </div>
                    )}
                    {(effectiveMcHint?.status === 'ready' || effectiveMcHint?.status === 'submitted') && (
                      <MCHintWidget
                        hint={effectiveMcHint.questions[effectiveMcHint.index]}
                        progress={{ current: effectiveMcHint.index + 1, total: effectiveMcHint.questions.length }}
                        selected={effectiveMcHint.selected}
                        submitted={effectiveMcHint.status === 'submitted'}
                        isCorrect={effectiveMcHint.status === 'submitted' ? effectiveMcHint.isCorrect : false}
                        isLast={effectiveMcHint.index + 1 >= effectiveMcHint.questions.length}
                        onToggle={(id) => {
                          if (effectiveMcHint.status !== 'ready') return;
                          const q = effectiveMcHint.questions[effectiveMcHint.index];
                          const { selected } = effectiveMcHint;
                          const next = q.type === 'single'
                            ? [id]
                            : selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
                          setMcHint({ ...effectiveMcHint, selected: next });
                        }}
                        onSubmit={() => {
                          if (effectiveMcHint.status !== 'ready') return;
                          const q = effectiveMcHint.questions[effectiveMcHint.index];
                          const { selected } = effectiveMcHint;
                          const correctIds = q.options.filter(o => o.correct).map(o => o.id);
                          const isCorrect =
                            selected.length === correctIds.length &&
                            selected.every(id => correctIds.includes(id));
                          setMcHint({ ...effectiveMcHint, status: 'submitted', isCorrect });
                        }}
                        onNext={() => {
                          if (effectiveMcHint.status !== 'submitted') return;
                          const newAnswer: MCAnswer = { selected: effectiveMcHint.selected, isCorrect: effectiveMcHint.isCorrect };
                          const allAnswers = [...effectiveMcHint.answers, newAnswer];
                          const nextIdx = effectiveMcHint.index + 1;
                          if (nextIdx >= effectiveMcHint.questions.length) {
                            setMcHint({ cardId: currentCard.id, status: 'finished', questions: effectiveMcHint.questions, answers: allAnswers });
                          } else {
                            setMcHint({ cardId: currentCard.id, status: 'ready', questions: effectiveMcHint.questions, index: nextIdx, answers: allAnswers, selected: [] });
                          }
                        }}
                      />
                    )}
                    {effectiveMcHint?.status === 'finished' && (
                      <MCHintSummary
                        questions={effectiveMcHint.questions}
                        answers={effectiveMcHint.answers}
                        onReset={() => setMcHint(null)}
                      />
                    )}

                    {/* AI Prüfung — separate from MC hint, shown below */}
                    {!effectiveAiCheck && !effectiveMcHint && (
                      <button
                        onClick={handleStartAICheck}
                        className="flex items-center gap-2 text-xs text-[#6b7280] hover:text-purple-400 transition-colors py-1 mt-1.5 group"
                      >
                        <span className="text-sm group-hover:scale-110 transition-transform">🎓</span>
                        <span>KI Prüfung — Antwort selbst erklären</span>
                      </button>
                    )}
                    {effectiveAiCheck && (
                      <div className="mt-2">
                        <AICheckWidget
                          state={effectiveAiCheck}
                          speechSupported={speechSupported}
                          onSetMode={handleSetAICheckMode}
                          onSetProbeMode={handleSetAICheckProbeMode}
                          onSetText={handleSetAICheckText}
                          onToggleMic={handleToggleMic}
                          onSubmit={handleSubmitAICheck}
                          onSubmitProbe={() => handleSubmitProbe(false)}
                          onSkipProbe={() => handleSubmitProbe(true)}
                          onClose={handleCloseAICheck}
                          onPickRating={(r) => {
                            handleCloseAICheck();
                            handleRate(r);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!isFlipped && !effectiveMcHint && (
                <div className="shrink-0 pb-4 text-center">
                  <p className="text-xs text-[#6b7280] animate-pulse">Klicke zum Umdrehen</p>
                </div>
              )}
            </div>
            {/* Back */}
            <div className="card-face card-back-face bg-[#1e2130] border border-indigo-500/40 rounded-3xl flex flex-col select-none" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
              {/* Header row: label left, action icons right — no overlap */}
              <div className="shrink-0 flex items-center justify-between px-3 pt-3 pb-2 border-b border-[#2d3148]/60" onClick={e => e.stopPropagation()}>
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest pl-1">Antwort</span>
                <div className="flex items-center gap-1">
                  {(() => {
                    const liveCard = cards.find(c => c.id === currentCard.id) ?? currentCard;
                    const isDup = liveCard.customTags.includes('duplikat');
                    return (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateCard(currentCard.id, {
                            customTags: isDup
                              ? liveCard.customTags.filter(t => t !== 'duplikat')
                              : [...liveCard.customTags, 'duplikat'],
                          });
                        }}
                        title={isDup ? 'Duplikat-Tag entfernen' : 'Als Duplikat markieren'}
                        className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                          isDup
                            ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                            : 'text-[#6b7280] hover:text-orange-400 border-transparent hover:bg-[#252840]'
                        }`}
                      >
                        {isDup ? '🔁 Duplikat' : '🔁'}
                      </button>
                    );
                  })()}
                  {(() => {
                    const liveCard = cards.find(c => c.id === currentCard.id) ?? currentCard;
                    const isFlagged = !!liveCard.flagged;
                    return (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateCard(currentCard.id, { flagged: !isFlagged });
                        }}
                        title={isFlagged ? 'Flagge entfernen' : 'Als schwierig flaggen'}
                        className={`text-base px-2 py-1.5 rounded-lg border transition-colors ${
                          isFlagged
                            ? 'bg-red-500/20 border-red-500/40 text-red-400'
                            : 'text-[#6b7280] hover:text-red-400 border-transparent hover:bg-[#252840]'
                        }`}
                      >
                        🚩
                      </button>
                    );
                  })()}
                  {onSplitCard && (
                    <button
                      onClick={e => { e.stopPropagation(); handleSplitCurrent(); }}
                      disabled={splitInProgress}
                      className={`text-base px-2 py-1.5 rounded-lg border transition-colors ${
                        splitInProgress
                          ? 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10 animate-pulse cursor-wait'
                          : 'text-[#6b7280] hover:text-indigo-400 border-transparent hover:bg-[#252840]'
                      }`}
                      title="Karte mit KI trennen"
                    >
                      ✂️
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setEditingCard(currentCard); }}
                    className="text-[#6b7280] hover:text-indigo-400 text-base transition-colors px-2 py-1.5 rounded-lg hover:bg-[#252840]"
                    title="Karte bearbeiten"
                  >
                    ✏️
                  </button>
                  {confirmDeleteId === currentCard.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-400 font-medium whitespace-nowrap">Löschen?</span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteCurrent(); }}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors font-semibold"
                      >
                        Ja
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className="text-xs px-2 py-1 rounded-lg bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors"
                      >
                        Nein
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(currentCard.id); }}
                      className="text-[#6b7280] hover:text-red-400 text-base transition-colors px-2 py-1.5 rounded-lg hover:bg-[#252840]"
                      title="Karte löschen"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 md:px-10 pb-6 flex flex-col items-start gap-3">
                {backImg && <img src={backImg} alt="" onClick={e => { e.stopPropagation(); setZoomedImg(backImg); }} className="max-h-40 max-w-full object-contain rounded-xl cursor-zoom-in" />}
                <p className="text-base md:text-lg text-[#e8eaf0] text-left leading-relaxed w-full">
                  <MarkdownText text={currentCard.back} />
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Subject / tags info */}
        <div className="flex items-center gap-2 py-2 flex-wrap justify-center shrink-0">
          {currentCard.subjects?.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#1e2130] border border-[#2d3148] text-[#9ca3af]">{s}</span>)}
          {currentCard.examiners?.map(e => <span key={e} className="text-xs text-[#6b7280]">{e}</span>)}
          {currentCard.customTags.map(t => (
            <span key={t} className="text-xs text-[#6b7280]">#{t}</span>
          ))}
        </div>
      </div>

      {/* Rating buttons */}
      <div className="shrink-0 px-4 md:px-8 pb-6 md:pb-8 space-y-3">
        {isFlipped && (
          <LinkedCardsPanel
            cardId={currentCard.id}
            allCards={cards}
            links={links}
            title="🔗 Tiefer gehen?"
            onRate={onRate}
          />
        )}
        {!isFlipped ? (
          <button
            onClick={() => setIsFlipped(true)}
            className="w-full py-4 rounded-2xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] hover:border-indigo-500/40 text-white font-semibold transition-all text-lg"
          >
            Antwort zeigen
          </button>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STUDY_RATINGS.map(r => (
              <button
                key={r.value}
                onClick={() => handleRate(r.value)}
                className={`py-3 md:py-4 rounded-2xl ${r.bgColor} ${r.hoverColor} border transition-all font-semibold text-sm md:text-base`}
                style={{ color: r.color, borderColor: r.color + '40' }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {editingCard && (
        <QuickEditModal
          card={editingCard}
          onSave={(id, data) => {
            onUpdateCard(id, data);
            setSessionCards(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
          }}
          onClose={() => setEditingCard(null)}
          geminiApiKey={settings.geminiApiKey}
          anthropicApiKey={settings.anthropicApiKey}
          groqApiKey={settings.groqApiKey}
          onApiError={onApiError}
        />
      )}
    </div>
  );
}

function RatingSummaryCard({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={`${bg} border rounded-xl p-3 text-center`}>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-[#9ca3af] mt-0.5">{label}</p>
    </div>
  );
}

interface MCHintWidgetProps {
  hint: MCHintResult;
  progress: { current: number; total: number };
  selected: string[];
  submitted: boolean;
  isCorrect: boolean;
  isLast: boolean;
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onNext: () => void;
}

function MCHintWidget({ hint, progress, selected, submitted, isCorrect, isLast, onToggle, onSubmit, onNext }: MCHintWidgetProps) {
  return (
    <div className="w-full space-y-2.5">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest shrink-0">
          Frage {progress.current}/{progress.total}
        </span>
        <div className="flex-1 h-1 bg-[#2d3148] rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question + type badge + topic badge */}
      <div className="flex items-start gap-2">
        <span className="text-sm">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-snug">{hint.question}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${
              hint.type === 'single'
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
            }`}>
              {hint.type === 'single' ? 'Single Choice – 1 Antwort' : 'Multiple Choice – mehrere Antworten'}
            </span>
            {hint.topic && (
              <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide bg-sky-500/15 text-sky-400 border border-sky-500/30">
                {hint.topic}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {hint.options.map(opt => {
          const isSelected = selected.includes(opt.id);
          const showResult = submitted;
          let optStyle = '';
          if (showResult) {
            if (opt.correct && isSelected)  optStyle = 'bg-green-500/15 border-green-500/50 text-green-300';
            else if (opt.correct && !isSelected) optStyle = 'bg-green-500/10 border-green-500/30 text-green-400/70';
            else if (!opt.correct && isSelected) optStyle = 'bg-red-500/15 border-red-500/50 text-red-300';
            else optStyle = 'bg-[#1a1d27] border-[#2d3148] text-[#6b7280]';
          } else {
            optStyle = isSelected
              ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
              : 'bg-[#1a1d27] border-[#2d3148] text-[#9ca3af] hover:border-indigo-500/40 hover:text-white';
          }

          return (
            <button
              key={opt.id}
              disabled={submitted}
              onClick={() => onToggle(opt.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-all text-sm ${optStyle} ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {/* Indicator */}
              <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                showResult
                  ? opt.correct ? 'border-green-500 bg-green-500/20 text-green-400' : isSelected ? 'border-red-500 bg-red-500/20 text-red-400' : 'border-[#2d3148] text-transparent'
                  : isSelected ? 'border-indigo-400 bg-indigo-500/20 text-indigo-300' : 'border-[#2d3148] text-transparent'
              }`}>
                {showResult
                  ? (opt.correct ? '✓' : isSelected ? '✗' : '')
                  : (isSelected ? (hint.type === 'single' ? '●' : '✓') : '')}
              </span>
              <span className="font-semibold text-xs uppercase mr-1 shrink-0 opacity-60">{opt.id})</span>
              <span className="leading-snug">{opt.text}</span>
            </button>
          );
        })}
      </div>

      {/* Submit button or result */}
      {!submitted ? (
        <button
          disabled={selected.length === 0}
          onClick={onSubmit}
          className="w-full py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Auswahl prüfen
        </button>
      ) : (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold ${
            isCorrect
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>
            <span>{isCorrect ? '✓ Richtig!' : '✗ Nicht ganz —'}</span>
            {!isCorrect && <span className="font-normal text-xs">schau dir die grünen Optionen an</span>}
          </div>
          {hint.explanation && (
            <p className="text-xs text-[#9ca3af] leading-relaxed px-1">{hint.explanation}</p>
          )}
          <button
            onClick={onNext}
            className="w-full py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 text-sm font-semibold transition-all flex items-center justify-center gap-2"
          >
            {isLast ? (
              <>
                <span>Auswertung ansehen</span>
                <span>📊</span>
              </>
            ) : (
              <>
                <span>Nächste Frage</span>
                <span>→</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Summary widget shown after the last question ──────────────────────────
interface MCHintSummaryProps {
  questions: MCHintResult[];
  answers: MCAnswer[];
  onReset: () => void;
}

function MCHintSummary({ questions, answers, onReset }: MCHintSummaryProps) {
  const correctCount = answers.filter(a => a.isCorrect).length;
  const total = questions.length;
  const gaps = questions
    .map((q, i) => ({ q, a: answers[i] }))
    .filter(x => x.a && !x.a.isCorrect);

  const scoreColor =
    correctCount === total ? 'text-green-400 border-green-500/40 bg-green-500/10' :
    correctCount >= Math.ceil(total / 2) ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' :
    'text-red-400 border-red-500/40 bg-red-500/10';

  return (
    <div className="w-full space-y-3">
      {/* Score header */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${scoreColor}`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">
            {correctCount === total ? '🎉' : correctCount >= Math.ceil(total / 2) ? '👍' : '📚'}
          </span>
          <div>
            <p className="text-sm font-bold">
              {correctCount} / {total} richtig
            </p>
            <p className="text-[10px] uppercase tracking-widest opacity-70">
              {correctCount === total ? 'Alles sitzt!' : correctCount >= Math.ceil(total / 2) ? 'Solide — ein paar Lücken' : 'Jetzt ist Lernen angesagt'}
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-all"
        >
          Schließen
        </button>
      </div>

      {/* Knowledge gaps */}
      {gaps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest px-1">
            Wissenslücken ({gaps.length})
          </p>
          {gaps.map(({ q, a }, i) => {
            const correctTexts = q.options.filter(o => o.correct).map(o => `${o.id}) ${o.text}`);
            const pickedTexts = q.options.filter(o => a.selected.includes(o.id)).map(o => `${o.id}) ${o.text}`);
            return (
              <div key={i} className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide bg-sky-500/15 text-sky-400 border border-sky-500/30">
                    {q.topic || 'Allgemein'}
                  </span>
                  <span className="text-[10px] text-red-400/80 uppercase tracking-wider">✗ falsch</span>
                </div>
                <p className="text-xs text-white/90 leading-snug">{q.question}</p>
                <div className="text-[11px] space-y-0.5">
                  <p className="text-red-300/90"><span className="opacity-60">Du: </span>{pickedTexts.join(', ') || '—'}</p>
                  <p className="text-green-300/90"><span className="opacity-60">Richtig: </span>{correctTexts.join(', ')}</p>
                </div>
                {q.explanation && (
                  <p className="text-[11px] text-[#9ca3af] leading-relaxed pt-0.5 border-t border-white/5 mt-1">
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-[#6b7280] px-1 italic">
        Kein Einfluss auf SRS — jetzt normal aufdecken & bewerten
      </p>
    </div>
  );
}

// ─── AI Prüfung widget ─────────────────────────────────────────────────────
interface AICheckWidgetProps {
  state: AICheckState;
  speechSupported: boolean;
  onSetMode: (mode: AICheckMode) => void;
  onSetProbeMode: (probeMode: AIProbeMode) => void;
  onSetText: (text: string) => void;
  onToggleMic: () => void;
  onSubmit: () => void;
  onSubmitProbe: () => void;
  onSkipProbe: () => void;
  onClose: () => void;
  onPickRating: (r: RatingValue) => void;
}

function AICheckWidget({
  state, speechSupported,
  onSetMode, onSetProbeMode, onSetText, onToggleMic, onSubmit, onSubmitProbe, onSkipProbe, onClose, onPickRating,
}: AICheckWidgetProps) {
  const isInput = state.status === 'input';
  const isLoading = state.status === 'loading';
  const isProbing = state.status === 'probing';
  const isFinalizing = state.status === 'finalizing';
  const isResult = state.status === 'result';

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

      {isInput && (
        <>
          {/* Probe-mode toggle: strict (one-shot) vs probe (Nachbohren) */}
          <div className="flex gap-1 text-[11px] p-0.5 rounded-lg bg-[#1e2130] border border-[#2d3148]">
            <button
              type="button"
              onClick={() => onSetProbeMode('probe')}
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
              onClick={() => onSetProbeMode('strict')}
              title="Eine Antwort, sofortige Bewertung — keine Folgefragen"
              className={`flex-1 px-2 py-1 rounded-md transition-colors ${
                state.probeMode === 'strict'
                  ? 'bg-purple-500/20 text-purple-200 font-semibold'
                  : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              🎯 Streng
            </button>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => onSetMode('mic')}
              disabled={!speechSupported}
              title={!speechSupported ? 'Dein Browser unterstützt keine Spracherkennung' : 'Antwort einsprechen'}
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
              onClick={() => onSetMode('text')}
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
            Erkläre die Antwort in eigenen Worten. Die KI prüft, ob du den Kern erfasst hast,
            zeigt dir Lücken und schlägt eine Bewertung vor.
          </p>

          {/* Mic mode UI */}
          {state.mode === 'mic' && speechSupported && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={onToggleMic}
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
                ) : (
                  <>🎤 Aufnahme starten</>
                )}
              </button>
              <textarea
                value={state.text}
                onChange={e => onSetText(e.target.value)}
                placeholder={state.listening ? 'Sprich jetzt — Transkript erscheint hier live…' : 'Klicke auf "Aufnahme starten" oder tippe direkt hier…'}
                rows={4}
                className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>
          )}

          {/* Text-only mode UI */}
          {(state.mode === 'text' || !speechSupported) && (
            <textarea
              value={state.text}
              onChange={e => onSetText(e.target.value)}
              placeholder="Tippe deine Erklärung hier… (z.B. in der U-Bahn 🚇)"
              rows={5}
              autoFocus
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
            />
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={!state.text.trim() || state.listening}
            className="w-full py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            ✨ Bewerten lassen
          </button>
        </>
      )}

      {isLoading && (
        <div className="py-4 flex flex-col items-center gap-2">
          <span className="inline-block w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-purple-300">
            {state.probeMode === 'probe' ? 'KI denkt nach…' : 'KI prüft deine Erklärung…'}
          </p>
          <p className="text-[10px] text-[#6b7280]">Das kann ein paar Sekunden dauern</p>
        </div>
      )}

      {isProbing && (
        <div className="space-y-2.5">
          {/* Step indicator */}
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

          {/* The follow-up question */}
          <div className="px-3 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <p className="text-[11px] font-semibold text-purple-300/80 uppercase tracking-wider mb-1">
              Frage
            </p>
            <p className="text-sm text-white leading-snug">{state.followUps[state.idx]}</p>
          </div>

          {/* Mic mode UI for the follow-up */}
          {state.mode === 'mic' && speechSupported && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={onToggleMic}
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
                ) : (
                  <>🎤 Antwort einsprechen</>
                )}
              </button>
              <textarea
                value={state.currentText}
                onChange={e => onSetText(e.target.value)}
                placeholder={state.listening ? 'Sprich jetzt — Transkript erscheint hier live…' : 'Klicke auf "Antwort einsprechen" oder tippe direkt hier…'}
                rows={3}
                className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>
          )}

          {/* Text-only mode UI */}
          {(state.mode === 'text' || !speechSupported) && (
            <textarea
              value={state.currentText}
              onChange={e => onSetText(e.target.value)}
              placeholder="Tippe deine Antwort hier…"
              rows={3}
              autoFocus
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
            />
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onSkipProbe}
              className="px-3 py-2 rounded-xl text-xs text-[#9ca3af] hover:text-white border border-[#2d3148] hover:border-[#3d4168] transition-colors"
              title="Diese Frage überspringen — fließt als ungelöst in die Bewertung ein"
            >
              Überspringen
            </button>
            <button
              type="button"
              onClick={onSubmitProbe}
              disabled={!state.currentText.trim() || state.listening}
              className="flex-1 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
            >
              {state.idx + 1 >= state.followUps.length ? '✨ Fertig — bewerten' : 'Weiter →'}
            </button>
          </div>

          <p className="text-[10px] text-[#6b7280] leading-relaxed">
            💡 Tipp: Wie in einer mündlichen Prüfung — Wissen, das hier kommt, zählt voll mit. Was du auch hier nicht weißt, fließt als Lücke in die Bewertung ein.
          </p>
        </div>
      )}

      {isFinalizing && (
        <div className="py-4 flex flex-col items-center gap-2">
          <span className="inline-block w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-purple-300">Prüfer fasst zusammen…</p>
          <p className="text-[10px] text-[#6b7280]">Bewertung über alle Antworten kommt gleich</p>
        </div>
      )}

      {isResult && (
        <AICheckResultView
          result={state.result}
          userText={state.text}
          probes={state.probes}
          onPickRating={onPickRating}
          onRetry={() => {
            // Re-open input mode preserving the current text — user can adjust & resubmit
            onSetMode(state.mode);
            onSetText(state.text);
          }}
        />
      )}
    </div>
  );
}

// ─── Result view (score, captured, missing, rating recommendation) ──────────
interface AICheckResultViewProps {
  result: AnswerCheckResult;
  userText: string;
  probes?: ProbeAnswer[];
  onPickRating: (r: RatingValue) => void;
  onRetry: () => void;
}

function AICheckResultView({ result, userText, probes, onPickRating }: AICheckResultViewProps) {
  const scoreColor =
    result.score >= 80 ? 'text-green-400 border-green-500/40 bg-green-500/10' :
    result.score >= 50 ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' :
    'text-red-400 border-red-500/40 bg-red-500/10';

  const scoreEmoji =
    result.score >= 80 ? '🎉' :
    result.score >= 50 ? '👍' :
    '📚';

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

      {/* What you said (collapsed preview) */}
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

      {/* Nachbohren — Q&A history (only shown if probing happened) */}
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

      {/* Captured */}
      {result.captured.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-green-400/80 uppercase tracking-widest px-1">
            ✓ Du hattest
          </p>
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

      {/* Missing */}
      {result.missing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-red-400/80 uppercase tracking-widest px-1">
            ✗ Was gefehlt hat
          </p>
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

      {/* Rating recommendation + buttons */}
      <div className="space-y-1.5 pt-1 border-t border-white/5">
        <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-widest px-1">
          Empfehlung & Bewertung
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {STUDY_RATINGS.map(r => {
            const isSuggested = r.value === result.suggestedRating;
            return (
              <button
                key={r.value}
                onClick={() => onPickRating(r.value)}
                className={`relative py-2 rounded-xl border text-xs font-semibold transition-all ${r.bgColor} ${r.hoverColor}`}
                style={{
                  color: r.color,
                  borderColor: isSuggested ? r.color : r.color + '40',
                  boxShadow: isSuggested ? `0 0 0 1px ${r.color}` : undefined,
                }}
              >
                {isSuggested && (
                  <span
                    className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{ backgroundColor: r.color, color: '#0f1117' }}
                  >
                    ✨ Empfehlung
                  </span>
                )}
                {r.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-[#6b7280] italic px-1">
          Du entscheidest — die Empfehlung ist nur ein Hinweis.
        </p>
      </div>
    </div>
  );
}

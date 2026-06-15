import { useState, useMemo, useRef, useEffect } from 'react';
import type { Flashcard, AppSettings, RatingValue, CardSet, CardLink } from '../types/card';
import { isDueToday, STUDY_RATINGS } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import MarkdownText from '../components/MarkdownText';
import PriorityPicker from '../components/PriorityPicker';
import MicPulseVisualizer from '../components/MicPulseVisualizer';
import { LinkedCardsPanel } from '../components/LinkedCards';
import QuickEditModal from '../components/QuickEditModal';
import CardChatDrawer from '../components/CardChatDrawer';
import { exportJSON } from '../utils/export';
import { getNewCardsDoneToday, calculateDailyPlan } from '../utils/dailyGoal';
import { applyFocus } from '../utils/priority';
import { generateMCHintBundle } from '../utils/geminiMCHint';
import type { MCHintResult } from '../utils/geminiMCHint';
import { checkAnswerWithAI, probeAnswerForGaps, finalGradeWithProbes } from '../utils/aiAnswerCheck';
import type { AnswerCheckResult, ProbeAnswer } from '../utils/aiAnswerCheck';
import { isSpeechRecognitionSupported, createRecognizer, dedupeTranscript } from '../utils/speechRecognition';
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
  userId: string | null;
  preFilteredCards?: Flashcard[] | null;
  dailyPlan?: DailyPlanSession | null;
  onRate: (id: string, rating: RatingValue) => void;
  onUpdateCard: (id: string, data: Partial<Flashcard>) => void;
  onDeleteCard: (id: string) => void;
  onSplitCard?: (cardId: string, afterSplit: (newCardIds: string[]) => void) => void;
  /** Bulk-generate persistent MC questions for the given cards.
   *  Used for the Pre-Flight step in MC-Lernmodus. */
  onGenerateMC?: (cardIds: string[]) => Promise<{ okIds: string[]; failedIds: string[] }>;
  /** Update user_settings — used to push paused-session state cross-device. */
  onUpdateSettings?: (patch: Partial<AppSettings>) => void;
  onSessionComplete: () => void;
  onNavigate: (page: string) => void;
  /** Page to return to when session ends or is aborted. Defaults to 'dashboard'. */
  returnPage?: string;
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

export default function StudySession({ cards, settings, sets, links, userId, preFilteredCards, dailyPlan, onRate, onUpdateCard, onDeleteCard, onSplitCard, onGenerateMC, onUpdateSettings, onSessionComplete, onNavigate, returnPage = 'dashboard', onApiError }: Props) {
  const isDailyMode = !!dailyPlan;

  // Restore in-progress study session from sessionStorage on mount.
  // Reasons we want this: (a) refresh / accidental F5; (b) foldable Android
  // phones reload the page on unfold (config change); (c) Safari tab eviction.
  // We only restore the 'studying' phase — 'setup' isn't worth restoring,
  // 'summary' is terminal. Card data is re-resolved from the live `cards`
  // prop so post-restore card edits / sync updates are reflected. If any
  // persisted card was deleted in the meantime, it's silently dropped.
  // Restore-shape covers BOTH classic and MC sessions. MC restore is keyed by
  // sessionMode === 'mc' in the stored object and carries indices + answers.
  type MCSessionAnswerLocal = { selected: string[]; isCorrect: boolean };
  const restoredSession = useMemo<{
    mode: 'classic' | 'mc';
    /** 'studying' = land directly in the session view, 'setup' = land on setup with paused state visible via banner */
    initialState: 'studying' | 'setup';
    sessionCards: Flashcard[];
    pausedAt: number;            // when this local state was last saved — for cross-device conflict resolution
    // Classic fields
    currentIdx: number;
    ratings: RatingCount;
    // MC fields
    mcCardIdx: number;
    mcQuestionIdx: number;
    mcAnswers: Map<string, MCSessionAnswerLocal[]>;
  } | null>(() => {
    try {
      // Use localStorage so paused MC sessions survive tab-close. Cleared
      // explicitly via Verwerfen-button or session completion.
      const raw = localStorage.getItem('studySession:state');
      if (!raw) return null;
      const obj = JSON.parse(raw) as {
        sessionState?: SessionState;
        sessionMode?: 'classic' | 'mc';
        cardIds?: string[];
        pausedAt?: number;
        currentIdx?: number;
        ratings?: RatingCount;
        mcCardIdx?: number;
        mcQuestionIdx?: number;
        mcAnswersEntries?: Array<[string, MCSessionAnswerLocal[]]>;
      };
      // Accept BOTH 'studying' (active mid-session) and 'setup' (paused after
      // Beenden) — both need state restored. Setup-stored state implies the
      // user paused MC; the banner picks it up.
      if (!Array.isArray(obj.cardIds)) return null;
      if (obj.sessionState !== 'studying' && obj.sessionState !== 'setup') return null;
      const resolved = obj.cardIds
        .map(id => cards.find(c => c.id === id))
        .filter((c): c is Flashcard => !!c);
      if (resolved.length === 0) return null;
      const mode: 'classic' | 'mc' = obj.sessionMode === 'mc' ? 'mc' : 'classic';
      // Classic sessions: always land on setup so the user sees the mode picker
      // (MC vs Karteikarten). Classic ratings are saved card-by-card so there's
      // no cumulative progress to lose. MC sessions keep auto-resume because
      // their score/progress IS cumulative within the session.
      const initialState = mode === 'mc' && obj.sessionState === 'studying' ? 'studying' : 'setup';
      return {
        mode,
        initialState,
        sessionCards: resolved,
        pausedAt: typeof obj.pausedAt === 'number' ? obj.pausedAt : 0,
        currentIdx: Math.min(Math.max(obj.currentIdx ?? 0, 0), resolved.length - 1),
        ratings: obj.ratings ?? { nochmal: 0, schwer: 0, gut: 0, einfach: 0 },
        mcCardIdx: Math.min(Math.max(obj.mcCardIdx ?? 0, 0), resolved.length - 1),
        mcQuestionIdx: Math.max(obj.mcQuestionIdx ?? 0, 0),
        mcAnswers: new Map(obj.mcAnswersEntries ?? []),
      };
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally one-shot — only attempt restoration on first mount

  const [sessionState, setSessionState] = useState<SessionState>(
    restoredSession?.initialState ?? 'setup'
  );
  const [studyOrder, setStudyOrder] = useState<StudyOrder>(
    () => (localStorage.getItem('study_order') as StudyOrder) ?? 'review-first'
  );

  // ── MC-Lernmodus state ──────────────────────────────────────────────────
  // sessionMode: 'classic' = SRS flashcards (default), 'mc' = MC-Lernmodus.
  // If we're restoring an in-progress MC session, prefer its mode.
  const [sessionMode, setSessionMode] = useState<'classic' | 'mc'>(
    () => restoredSession?.mode === 'mc'
      ? 'mc'
      : (localStorage.getItem('session_mode') === 'mc' ? 'mc' : 'classic')
  );
  // MC session progress: which card and which question within it.
  // Restored from sessionStorage when resuming after reload / abort.
  const [mcCardIdx, setMcCardIdx] = useState(
    restoredSession?.mode === 'mc' ? restoredSession.mcCardIdx : 0
  );
  const [mcQuestionIdx, setMcQuestionIdx] = useState(
    restoredSession?.mode === 'mc' ? restoredSession.mcQuestionIdx : 0
  );
  const [mcSelected, setMcSelected] = useState<string[]>([]);
  const [mcSubmitted, setMcSubmitted] = useState(false);
  // MC-View card-context controls
  const [mcShowBack, setMcShowBack] = useState(false);       // toggle "Antwort einblenden"
  const [mcConfirmRegen, setMcConfirmRegen] = useState(false); // inline confirm before regen
  const [mcRegenerating, setMcRegenerating] = useState(false); // spinner while regen runs
  type MCSessionAnswer = { selected: string[]; isCorrect: boolean };
  const [mcAnswers, setMcAnswers] = useState<Map<string, MCSessionAnswer[]>>(
    () => restoredSession?.mode === 'mc' ? restoredSession.mcAnswers : new Map()
  );
  // Pre-flight: cards lacking MC questions; null when no check pending
  const [mcPreFlight, setMcPreFlight] = useState<{ missing: Flashcard[]; allCards: Flashcard[] } | null>(null);
  const [mcGenerating, setMcGenerating] = useState(false);
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminers, setFilterExaminers] = useState<string[]>([]);
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterPriority, setFilterPriority] = useState<'' | 'A' | 'B' | 'C' | 'AB'>('');
  const [filterSet, setFilterSet] = useState('');
  const [onlyDue, setOnlyDue] = useState(true);
  const [filterKlassiker, setFilterKlassiker] = useState(false);
  const [sortByProbability, setSortByProbability] = useState(false);
  const [endlessMode, setEndlessMode] = useState(false);
  const [sessionCards, setSessionCards] = useState<Flashcard[]>(restoredSession?.sessionCards ?? []);
  const [currentIdx, setCurrentIdx] = useState(restoredSession?.currentIdx ?? 0);
  // viewIdx: which card is currently DISPLAYED (may lag behind currentIdx when
  // the user browses history via the back arrow). currentIdx is the SRS progress
  // pointer — the card that will be rated. When viewIdx < currentIdx the session
  // is in "Rückblick"-mode: card is readable / flippable but not rateable.
  const [viewIdx, setViewIdx] = useState(restoredSession?.currentIdx ?? 0);
  const [isFlipped, setIsFlipped] = useState(false);
  // Track mousedown position so we can suppress flip when user drags to select text
  const cardMouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const [ratings, setRatings] = useState<RatingCount>(
    restoredSession?.ratings ?? { nochmal: 0, schwer: 0, gut: 0, einfach: 0 }
  );
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  // Card chat drawer — only open when explicitly toggled by user
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [splitInProgress, setSplitInProgress] = useState(false);
  // Gaps / Lücken-Markierung
  // After Gut/Einfach on a card that has gaps, we ask the user if the gaps
  // are now closed before advancing to the next card.
  const [pendingGapsClear, setPendingGapsClear] = useState<{
    cardId: string; rating: RatingValue; nextAction: () => void;
  } | null>(null);
  // Mobile gap input: shown when 📌 is tapped without a text selection
  const [gapInputOpen, setGapInputOpen] = useState(false);
  const [gapInputText, setGapInputText] = useState('');
  const [mcHint, setMcHint] = useState<MCHintState | null>(null);
  const [aiCheck, setAiCheck] = useState<AICheckState | null>(null);
  const recognizerRef = useRef<RecognizerHandle | null>(null);
  const micFinalRef = useRef(''); // accumulated final transcript across interim chunks
  // Always-fresh reference to the cards prop. Used after `await onGenerateMC`
  // to read the freshly-bulkUpdated mcQuestions without hitting the stale
  // closure value of `cards`.
  const cardsRef = useRef<Flashcard[]>(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);

  // Cards available for setup
  const availableCards = useMemo(() => {
    // Parkiert (blacklisted) cards are excluded from all study pools — they
    // stay in Library but won't appear here.
    let result = (preFilteredCards ?? cards).filter(c => !c.blacklisted);
    if (!preFilteredCards) {
      if (filterSubject) result = result.filter(c => c.subjects?.includes(filterSubject));
      if (filterExaminers.length > 0) {
        result = result.filter(c => c.examiners?.some(e => filterExaminers.includes(e)));
      }
      if (filterDifficulty) result = result.filter(c => c.difficulty === filterDifficulty);
      if (filterPriority === 'A') result = result.filter(c => c.priority === 'A');
      else if (filterPriority === 'B') result = result.filter(c => c.priority === 'B');
      else if (filterPriority === 'C') result = result.filter(c => c.priority === 'C');
      else if (filterPriority === 'AB') result = result.filter(c => c.priority === 'A' || c.priority === 'B');
      if (filterSet) result = result.filter(c => c.setIds?.includes(filterSet));
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
  }, [cards, preFilteredCards, filterSubject, filterExaminers, filterDifficulty, filterPriority, filterSet, onlyDue, endlessMode, filterKlassiker, sortByProbability, settings]);

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

  // True if we have an MC session in progress that was paused (user clicked
  // "✕ Beenden" or aborted, or just reloaded the page mid-session).
  // The Beenden button keeps state in memory; the persistence effect keeps
  // it on sessionStorage. So even after reload + abort, we can resume.
  const hasPausedMCSession = sessionMode === 'mc' && mcAnswers.size > 0 && sessionCards.length > 0;

  // Compute the CURRENT daily plan (used for size-based adapt + ID-set membership
  // to decide which answers to preserve). Only relevant when a paused MC session
  // exists. Honours focusMode + daily limit + blacklist filters.
  const currentDailyPlanIds = useMemo<Set<string> | null>(() => {
    if (!hasPausedMCSession) return null;
    const focused = applyFocus(cards, settings.focusMode ?? 'all').filter(c => !c.blacklisted);
    const plan = calculateDailyPlan(focused, settings, getNewCardsDoneToday(focused, settings));
    return new Set([...plan.reviewCards, ...plan.newCards].map(c => c.id));
  }, [cards, settings, hasPausedMCSession]);

  // Divergence = the paused session size differs from the current daily plan size.
  // Card-IDs müssen NICHT identisch sein — wir wollen nur den User benachrichtigen
  // wenn die SIZE auseinanderläuft (er hat das Limit hoch/runter gestellt) damit
  // er die Möglichkeit hat anzupassen.
  const pausedMcDiverged = useMemo(() => {
    if (!currentDailyPlanIds || !hasPausedMCSession) return null;
    if (sessionCards.length === currentDailyPlanIds.size) return null;
    return { paused: sessionCards.length, plan: currentDailyPlanIds.size };
  }, [sessionCards, currentDailyPlanIds, hasPausedMCSession]);

  const resumePausedMCSession = () => {
    setSessionState('studying');
  };

  /**
   * Find the next (card, question) position that still needs answering.
   * Walks forward from (startCardIdx, startQuestionIdx). Returns null when
   * every remaining slot is already answered.
   */
  const findNextUnanswered = (
    startCardIdx: number,
    startQuestionIdx: number,
    list: Flashcard[],
    answers: Map<string, { selected: string[]; isCorrect: boolean }[]>,
  ): { cardIdx: number; questionIdx: number } | null => {
    for (let ci = startCardIdx; ci < list.length; ci++) {
      const card = list[ci];
      const total = card.mcQuestions?.length ?? 0;
      const cardAnswers = answers.get(card.id) ?? [];
      const startQ = ci === startCardIdx ? startQuestionIdx : 0;
      for (let qi = startQ; qi < total; qi++) {
        if (!cardAnswers[qi]) return { cardIdx: ci, questionIdx: qi };
      }
    }
    return null;
  };

  /**
   * Adapt a paused MC session to the current daily plan SIZE.
   *
   * Mental model: don't swap the card-set out — just grow or shrink the
   * **unanswered tail** so the session's total length matches the new plan.
   *
   * Algorithmus:
   *  1. Behalte ALLE schon-beantworteten Karten in der Original-Reihenfolge.
   *     Diese sind unantastbar — der User hat sie schon erledigt.
   *  2. Compute Ziel-Größe = aktuelle Daily-Plan-Größe (z.B. 19).
   *  3. Fülle bis zur Ziel-Größe auf mit unbeantworteten Karten:
   *     a) erst aus dem alten Session-Pool (= Karten die der User schon
   *        gesehen hat aber noch nicht beantwortet hat — Reihenfolge bleibt)
   *     b) wenn das nicht reicht → frische Karten aus dem aktuellen Daily Plan
   *  4. Wenn Ziel-Größe < Anzahl schon-beantworteter Karten → Überlauf akzeptieren
   *     (User-Progress wird nicht weggeworfen — wir gehen lieber über das Ziel
   *     hinaus als Geleistetes zu verlieren).
   *
   *  `card.mcQuestions` wird NIE angefasst — bleibt persistent auf der Karte.
   *  Pointer landet auf der ersten unbeantworteten Karte/Frage.
   */
  const adaptPausedMCToCurrentPlan = () => {
    if (!currentDailyPlanIds) return;
    // 1. Ziel-Größe = aktuelle Daily Plan-Größe
    const focused = applyFocus(cards, settings.focusMode ?? 'all').filter(c => !c.blacklisted);
    const plan = calculateDailyPlan(focused, settings, getNewCardsDoneToday(focused, settings));
    const planOrdered = [...plan.reviewCards, ...plan.newCards]
      .map(c => cards.find(cc => cc.id === c.id))
      .filter((c): c is Flashcard => !!c);
    const targetSize = planOrdered.length;
    if (targetSize === 0) {
      onApiError?.('Daily Plan ist leer — Session bleibt unverändert.');
      return;
    }

    // 2. Split der alten Session in "schon angefasst" und "noch nicht"
    const hasAnyAnswer = (cardId: string) => {
      const arr = mcAnswers.get(cardId);
      return !!arr && arr.some(Boolean);
    };
    const oldAnswered = sessionCards.filter(c => hasAnyAnswer(c.id));
    const oldUnanswered = sessionCards.filter(c => !hasAnyAnswer(c.id));

    // 3. Neue Liste zusammenbauen
    const newOrdered: Flashcard[] = [...oldAnswered];        // 3a — alle beantworteten bleiben
    const remainingSlots = Math.max(0, targetSize - newOrdered.length);

    if (remainingSlots > 0) {
      // 3b — erst unbeantwortete aus alter Session weiterführen
      const keptFromOld = oldUnanswered.slice(0, remainingSlots);
      newOrdered.push(...keptFromOld);
      // 3c — wenn dann noch immer Platz ist (User hat Limit erhöht) →
      // frische Karten aus dem aktuellen Daily Plan dazu
      const stillNeeded = remainingSlots - keptFromOld.length;
      if (stillNeeded > 0) {
        const alreadyIn = new Set(newOrdered.map(c => c.id));
        const fresh = planOrdered.filter(c => !alreadyIn.has(c.id)).slice(0, stillNeeded);
        newOrdered.push(...fresh);
      }
    }
    // Note: wenn `targetSize < oldAnswered.length` (User hat Limit unter
    // die Anzahl bereits beantworteter Karten gesenkt) lassen wir die
    // Session über das neue Ziel hinausgehen. Keine schon-beantwortete Karte
    // wird verworfen.

    // 4. Antworten für die finale Liste übernehmen
    const newAnswers = new Map<string, { selected: string[]; isCorrect: boolean }[]>();
    for (const card of newOrdered) {
      const answers = mcAnswers.get(card.id);
      if (answers) newAnswers.set(card.id, answers);
    }

    // 5. Pointer: erste unbeantwortete Position (Karte 14 / 19 = mcCardIdx=13)
    let resume = findNextUnanswered(0, 0, newOrdered, newAnswers);
    if (!resume) {
      // Alles erledigt → letzter Slot, nächster Klick öffnet Summary
      const lastIdx = newOrdered.length - 1;
      const lastTotal = newOrdered[lastIdx]?.mcQuestions?.length ?? 1;
      resume = { cardIdx: lastIdx, questionIdx: Math.max(0, lastTotal - 1) };
    }

    setSessionCards(newOrdered);
    setMcAnswers(newAnswers);
    setMcCardIdx(resume.cardIdx);
    setMcQuestionIdx(resume.questionIdx);
    setMcSelected([]);
    setMcSubmitted(false);

    const answeredCount = oldAnswered.length;
    const totalQuestions = newOrdered.reduce((s, c) => s + (c.mcQuestions?.length ?? 0), 0);
    const answeredQuestions = Array.from(newAnswers.values()).reduce((s, arr) => s + arr.filter(Boolean).length, 0);
    onApiError?.(
      `📋 Session angepasst: ${newOrdered.length} Karten · ${answeredCount} schon beantwortet (${answeredQuestions}/${totalQuestions} Fragen) · weiter bei Karte ${resume.cardIdx + 1}`,
    );
  };

  // Cross-device resume with timestamp-based conflict resolution.
  //
  // Scenario A: no local state, remote exists → restore from remote.
  // Scenario B: local exists, remote is newer (e.g. paused on phone, made
  //   progress on PC, came back to phone) → override local with remote.
  // Scenario C: local exists, remote is same/older → keep local (current
  //   device is the source of truth).
  // Scenario D: nothing anywhere → do nothing.
  //
  // We only consider switching while sessionState is 'setup' to avoid
  // disrupting an actively studying session.
  const remoteRestoreDoneRef = useRef(false);
  const localPausedAt = restoredSession?.pausedAt ?? 0;
  useEffect(() => {
    if (remoteRestoreDoneRef.current) return;
    if (sessionState !== 'setup') return;
    const remote = settings.pausedSession;
    if (!remote || !Array.isArray(remote.cardIds) || remote.cardIds.length === 0) return;
    // Only override local state if remote is strictly newer. Small slack
    // (1s) to avoid flickering when this device's own debounced upload
    // bounces back through Realtime.
    if (remote.pausedAt <= localPausedAt + 1000) return;
    // Resolve to live card objects — picks up edits/MC-regenerations.
    const resolved = remote.cardIds
      .map(id => cards.find(c => c.id === id))
      .filter((c): c is Flashcard => !!c);
    if (resolved.length === 0) return;
    remoteRestoreDoneRef.current = true;
    console.log(`[StudySession] swapping to newer remote state (local=${localPausedAt}, remote=${remote.pausedAt})`);
    setSessionMode(remote.mode);
    setSessionCards(resolved);
    if (remote.mode === 'mc') {
      setMcCardIdx(Math.min(Math.max(remote.mcCardIdx ?? 0, 0), resolved.length - 1));
      setMcQuestionIdx(Math.max(remote.mcQuestionIdx ?? 0, 0));
      setMcAnswers(new Map(remote.mcAnswersEntries ?? []));
    } else {
      setCurrentIdx(Math.min(Math.max(remote.currentIdx ?? 0, 0), resolved.length - 1));
      setRatings(remote.ratings ?? { nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    }
    // For active MC 'studying' sessions, land directly in the session view.
    // Classic sessions always land on setup so the user sees the mode picker.
    // For paused-after-Beenden, stay on setup so the resume banner is visible.
    if (remote.sessionState === 'studying' && remote.mode === 'mc') {
      setSessionState('studying');
    }
  }, [settings.pausedSession, cards, sessionState, localPausedAt]);

  const discardPausedMCSession = () => {
    setMcAnswers(new Map());
    setMcCardIdx(0);
    setMcQuestionIdx(0);
    setMcSelected([]);
    setMcSubmitted(false);
    setSessionCards([]);
  };

  // Auto-start: when cards were pre-selected (SetDetail / Library-Filter), skip
  // the setup screen entirely. The user already made their choice — showing the
  // setup screen again is friction. Only fires on mount and only when there is
  // no paused/restored session that should take priority.
  useEffect(() => {
    if (preFilteredCards && preFilteredCards.length > 0 && !restoredSession) {
      startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally one-shot

  const startSession = () => {
    // Auto-resume: if user has a paused MC session, "Los geht's" continues
    // it instead of starting fresh. To start fresh, user has to click
    // "Verwerfen" in the resume banner first.
    if (hasPausedMCSession) {
      resumePausedMCSession();
      return;
    }

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

    // MC-Modus Pre-Flight: prüfen welche Karten MC-Fragen haben
    if (sessionMode === 'mc') {
      const missing = ordered.filter(c => !c.mcQuestions || c.mcQuestions.length === 0);
      if (missing.length > 0) {
        // Small batches (≤3 cards) — usually just today's new cards or a single
        // failed card from a previous run. Skip the modal and auto-generate
        // inline; reduces friction since the user has to confirm "yes" anyway
        // and the wait is only ~5–8 seconds.
        if (missing.length <= 3 && onGenerateMC) {
          (async () => {
            setMcGenerating(true);
            try {
              // Use the RETURNED okIds/failedIds — reading from the `cards`
              // prop here is racy: the bulkUpdate completes but React hasn't
              // re-rendered yet, so `cards` is stale and every generated card
              // would falsely show up as "stillMissing".
              const { failedIds } = await onGenerateMC(missing.map(c => c.id));
              if (failedIds.length > 0) {
                const failedCards = missing.filter(c => failedIds.includes(c.id));
                onApiError?.(`MC-Generierung für ${failedIds.length} Karte(n) fehlgeschlagen — siehe Konsole. Karte(n): ${failedCards.map(c => c.front.slice(0, 60)).join(' · ')}`);
              }
              // After await, read from cardsRef (always points to latest prop)
              // — the closure's `cards` is stale by one render.
              const refreshed = ordered.map(c => cardsRef.current.find(cc => cc.id === c.id) ?? c);
              const ready = refreshed.filter(c => c.mcQuestions && c.mcQuestions.length > 0);
              if (ready.length > 0) startMCSession(ready);
            } finally {
              setMcGenerating(false);
            }
          })();
          return;
        }
        // Larger batches → keep the modal so user is aware of the wait
        setMcPreFlight({ missing, allCards: ordered });
        return;
      }
      // All cards have MC → start MC session directly
      startMCSession(ordered);
      return;
    }

    // Classic mode
    setSessionCards(ordered);
    setCurrentIdx(0);
    setViewIdx(0);
    setIsFlipped(false);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  // Start MC session with given (possibly newly-generated) cards
  const startMCSession = (ordered: Flashcard[]) => {
    setSessionCards(ordered);
    setMcCardIdx(0);
    setMcQuestionIdx(0);
    setMcSelected([]);
    setMcSubmitted(false);
    setMcAnswers(new Map());
    setCurrentIdx(0);
    setViewIdx(0);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  // Handle the Pre-Flight modal "Generate now" action
  const handleConfirmGenerateMissingMC = async () => {
    if (!mcPreFlight || !onGenerateMC) return;
    setMcGenerating(true);
    try {
      const { failedIds } = await onGenerateMC(mcPreFlight.missing.map(c => c.id));
      if (failedIds.length > 0) {
        const failedCards = mcPreFlight.missing.filter(c => failedIds.includes(c.id));
        onApiError?.(`MC-Generierung für ${failedIds.length} Karte(n) fehlgeschlagen — siehe Konsole. Karte(n): ${failedCards.map(c => c.front.slice(0, 60)).join(' · ')}`);
      }
      // Use cardsRef (latest prop) — the `cards` closure value is stale by
      // one render after the await.
      const refreshedCards = mcPreFlight.allCards.map(c => cardsRef.current.find(cc => cc.id === c.id) ?? c);
      const ready = refreshedCards.filter(c => c.mcQuestions && c.mcQuestions.length > 0);
      setMcPreFlight(null);
      if (ready.length > 0) startMCSession(ready);
    } finally {
      setMcGenerating(false);
    }
  };

  // Pre-Flight: user wants to fall back to classic without generating
  const handleFallbackToClassic = () => {
    if (!mcPreFlight) return;
    const ordered = mcPreFlight.allCards;
    setMcPreFlight(null);
    setSessionMode('classic');
    localStorage.setItem('session_mode', 'classic');
    setSessionCards(ordered);
    setCurrentIdx(0);
    setIsFlipped(false);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  // After MC session: restart the same cards in classic mode for SRS rating
  const handleFestigenInClassicMode = () => {
    const ordered = sessionCards; // same cards
    setSessionMode('classic');
    localStorage.setItem('session_mode', 'classic');
    setMcAnswers(new Map());
    setMcCardIdx(0);
    setMcQuestionIdx(0);
    setMcSelected([]);
    setMcSubmitted(false);
    setSessionCards(ordered);
    setCurrentIdx(0);
    setIsFlipped(false);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  // ── Gaps / Lücken ───────────────────────────────────────────────────────────
  const handleAddGap = () => {
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) {
      // Desktop: use text selection directly
      if (!currentCard) return;
      const existing = currentCard.gaps ?? [];
      if (existing.includes(selectedText)) { window.getSelection()?.removeAllRanges(); return; }
      const updated = [...existing, selectedText];
      onUpdateCard(currentCard.id, { gaps: updated });
      setSessionCards(prev => prev.map(c => c.id === currentCard.id ? { ...c, gaps: updated } : c));
      window.getSelection()?.removeAllRanges();
    } else {
      // Mobile / no selection: open freetext input
      setGapInputText('');
      setGapInputOpen(true);
    }
  };

  const handleAddGapFromInput = () => {
    const text = gapInputText.trim();
    if (!text || !currentCard) { setGapInputOpen(false); return; }
    const existing = currentCard.gaps ?? [];
    if (!existing.includes(text)) {
      const updated = [...existing, text];
      onUpdateCard(currentCard.id, { gaps: updated });
      setSessionCards(prev => prev.map(c => c.id === currentCard.id ? { ...c, gaps: updated } : c));
    }
    setGapInputOpen(false);
    setGapInputText('');
  };

  const handleRemoveGap = (gap: string) => {
    if (!currentCard) return;
    const updated = (currentCard.gaps ?? []).filter(g => g !== gap);
    onUpdateCard(currentCard.id, { gaps: updated });
    setSessionCards(prev => prev.map(c => c.id === currentCard.id ? { ...c, gaps: updated } : c));
  };

  const handleParkCurrent = () => {
    const card = sessionCards[currentIdx];
    // Persist the parked flag — useCards will subsequently filter it from study pools.
    onUpdateCard(card.id, { blacklisted: true });
    setIsFlipped(false);
    // Remove from session queue so we don't show it again this session.
    const next = sessionCards.filter((_, i) => i !== currentIdx);
    if (next.length === 0) {
      setSessionState('summary');
    } else {
      setSessionCards(next);
      const clamped = currentIdx >= next.length ? next.length - 1 : currentIdx;
      if (currentIdx >= next.length) setCurrentIdx(clamped);
      setViewIdx(clamped);
    }
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
      const clamped = currentIdx >= next.length ? next.length - 1 : currentIdx;
      if (currentIdx >= next.length) setCurrentIdx(clamped);
      setViewIdx(clamped);
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
          // Dedupe the committed buffer — defends against mobile browsers
          // that occasionally repeat earlier final chunks despite our
          // index-guard. Idempotent so no harm calling each time.
          micFinalRef.current = dedupeTranscript(micFinalRef.current + chunk + ' ') + ' ';
          writeText(micFinalRef.current.trim());
        } else {
          writeText(dedupeTranscript(micFinalRef.current + chunk));
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
        const result = await checkAnswerWithAI(keys, currentCard.front, currentCard.back, explanation, currentCard.gaps);
        setAiCheck({ cardId, status: 'result', mode, text: explanation, result });
        return;
      }

      // Nachbohren: ask AI whether to probe or grade directly
      const probeResult = await probeAnswerForGaps(keys, currentCard.front, currentCard.back, explanation, currentCard.gaps);
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
        currentCard.gaps,
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

  // Persist the in-progress 'studying' state to localStorage (immediate, for
  // tab-close survival on the same device) AND to user_settings.paused_session
  // (debounced, for cross-device resume — pick up on the laptop where you
  // left off on the phone).
  //
  // We persist only card IDs (full data re-resolved on restore from current
  // `cards` so we pick up any sync updates) plus position and rating counts.
  useEffect(() => {
    try {
      // Persist when:
      //  - actively studying (any mode) with cards → so reload mid-session resumes
      //  - on setup AND MC has paused progress → so resume banner survives tab close
      // Clear when:
      //  - on summary (session completed)
      //  - on setup AND no paused progress (= classic flow naturally cleared)
      const isPausedMC = sessionState === 'setup' &&
        sessionMode === 'mc' &&
        mcAnswers.size > 0 &&
        sessionCards.length > 0;
      const isActive = sessionState === 'studying' && sessionCards.length > 0;
      if (!isActive && !isPausedMC) {
        localStorage.removeItem('studySession:state');
        // Also clear the remote paused-session — but only if there IS one
        // (avoid an unnecessary write on every state change). Use settingsRef
        // ... actually, we don't have one — just check via current prop. Calls
        // are debounced below anyway.
        if (onUpdateSettings && settings.pausedSession) {
          onUpdateSettings({ pausedSession: undefined });
        }
        return;
      }
      const pausedAt = Date.now();
      // Local payload mirrors the remote shape — keeps cross-device conflict
      // resolution simple: both sides have the same pausedAt timestamp on
      // the same content.
      const localPayload =
        sessionMode === 'mc'
          ? {
              sessionState, sessionMode, pausedAt,
              cardIds: sessionCards.map(c => c.id),
              mcCardIdx, mcQuestionIdx,
              mcAnswersEntries: Array.from(mcAnswers.entries()),
            }
          : {
              sessionState, sessionMode, pausedAt,
              cardIds: sessionCards.map(c => c.id),
              currentIdx, ratings,
            };
      localStorage.setItem('studySession:state', JSON.stringify(localPayload));

      // Cross-device mirror: shape matches PausedSession type (uses `mode`
      // instead of localStorage's `sessionMode`). Debounced ~1.5s so we don't
      // spam the DB on every MC click.
      if (onUpdateSettings) {
        const remotePayload = sessionMode === 'mc'
          ? {
              mode: 'mc' as const,
              sessionState,
              cardIds: sessionCards.map(c => c.id),
              pausedAt,
              mcCardIdx, mcQuestionIdx,
              mcAnswersEntries: Array.from(mcAnswers.entries()),
            }
          : {
              mode: 'classic' as const,
              sessionState,
              cardIds: sessionCards.map(c => c.id),
              pausedAt,
              currentIdx, ratings,
            };
        const timer = setTimeout(() => {
          onUpdateSettings({ pausedSession: remotePayload });
        }, 1500);
        return () => clearTimeout(timer);
      }
    } catch { /* localStorage unavailable / quota — fail silently */ }
  }, [sessionState, sessionCards, currentIdx, ratings, sessionMode, mcCardIdx, mcQuestionIdx, mcAnswers, onUpdateSettings, settings.pausedSession]);

  const handleRate = (rating: RatingValue) => {
    const card = sessionCards[currentIdx];

    // If the card has gaps and was rated Gut (2) or Einfach (3), ask the user
    // whether the gaps are now closed BEFORE advancing. The actual SRS update
    // + navigation is bundled into `nextAction` and runs after the user decides.
    if (rating >= 2 && card.gaps && card.gaps.length > 0) {
      const proceed = () => {
        doRate(card, rating);
      };
      setPendingGapsClear({ cardId: card.id, rating, nextAction: proceed });
      return;
    }

    doRate(card, rating);
  };

  const doRate = (card: Flashcard, rating: RatingValue) => {
    setConfirmDeleteId(null);
    onRate(card.id, rating);
    const key = ['nochmal', 'schwer', 'gut', 'einfach'][rating] as keyof RatingCount;
    setRatings(prev => ({ ...prev, [key]: prev[key] + 1 }));
    setIsFlipped(false);
    setPendingGapsClear(null);

    if (rating === 0) {
      // Re-queue at end — session continues until every card is rated ≥ 1
      setSessionCards(prev => {
        const rest = prev.filter((_, i) => i !== currentIdx);
        return [...rest, card];
      });
      // currentIdx stays the same — next card slides into this position.
      // Snap view to the current card (in case user was browsing history).
      setViewIdx(currentIdx);
    } else if (currentIdx + 1 >= sessionCards.length) {
      setSessionState('summary');
    } else {
      setCurrentIdx(idx => idx + 1);
      setViewIdx(idx => idx + 1); // keep view in sync with progress
    }
  };

  // currentCard = displayed card (follows viewIdx).
  // In Rückblick-mode viewIdx < currentIdx — the card is read-only (no rating).
  const currentCard = sessionCards[viewIdx];
  const isHistoryView = viewIdx < currentIdx;
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

            {/* Mode selector — Karteikarten vs MC-Lernmodus */}
            <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">Lernmodus</p>
            <div className="flex gap-1 p-1 rounded-xl bg-[#15172a] border border-[#2d3148] mb-4">
              {([
                { value: 'classic', icon: '📝', label: 'Karteikarten' },
                { value: 'mc',      icon: '🎯', label: 'MC-Modus' },
              ] as const).map(opt => {
                const active = sessionMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSessionMode(opt.value);
                      localStorage.setItem('session_mode', opt.value);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                      active
                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                        : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            {sessionMode === 'mc' && (
              <p className="text-xs text-[#9ca3af] mb-4 leading-relaxed">
                Multiple-Choice-Fragen pro Karte. Karten ohne MC werden vor dem Start automatisch generiert.
                Bewertet das SRS nicht — fürs Festigen anschließend in den Karteikarten-Modus wechseln.
              </p>
            )}

            {/* Paused MC session banner — appears when user aborted a session
                via "✕ Beenden" or after a reload. Clicking "Los geht's" also
                resumes (auto-resume in startSession). */}
            {hasPausedMCSession && (() => {
              const totalQuestions = sessionCards.reduce((s, c) => s + (c.mcQuestions?.length ?? 0), 0);
              const answered = Array.from(mcAnswers.values()).reduce((s, arr) => s + arr.filter(Boolean).length, 0);
              return (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-base">⏸</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-amber-300">MC-Session pausiert</p>
                      <p className="text-xs text-[#d1d5db] mt-0.5">
                        Du warst bei <strong>Karte {mcCardIdx + 1} / {sessionCards.length}</strong>
                        {' '}({answered} von {totalQuestions} Fragen beantwortet).
                      </p>
                    </div>
                  </div>

                  {/* Soft divergence hint: just states the fact, no
                      "hat sich geändert"-Wording — könnte ja auch sein dass
                      der User einfach im Karteikarten-Modus Karten abgearbeitet
                      hat und die deshalb aus dem Tagesplan rausgewandert sind.
                      User entscheidet selbst ob er anpassen will. */}
                  {pausedMcDiverged && pausedMcDiverged.plan > 0 && (
                    <div className="bg-[#15172a] border border-[#2d3148] rounded-lg px-3 py-2">
                      <p className="text-[11px] text-[#9ca3af] leading-relaxed">
                        Aktueller Tagesplan: <span className="text-white font-semibold">{pausedMcDiverged.plan} Karten</span>
                        {' '}· deine Session: <span className="text-white font-semibold">{pausedMcDiverged.paused}</span>.
                        {pausedMcDiverged.plan < pausedMcDiverged.paused
                          ? ' Falls du dort schon Karten im Klassik-Modus gemacht hast oder das Limit gesenkt hast, kannst du die MC-Session zuschneiden.'
                          : ' Mehr Karten im Tagesplan als in der Session — du kannst die Session erweitern.'}
                      </p>
                      <button
                        onClick={adaptPausedMCToCurrentPlan}
                        className="mt-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 transition-colors"
                      >
                        Session-Größe auf {pausedMcDiverged.plan} setzen
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={discardPausedMCSession}
                      className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-[#2d3148] hover:border-[#3d4168] text-[#9ca3af] hover:text-white transition-colors"
                    >
                      🗑 Verwerfen
                    </button>
                    <button
                      onClick={resumePausedMCSession}
                      className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-semibold transition-colors"
                    >
                      ▶ Fortsetzen
                    </button>
                  </div>
                </div>
              );
            })()}

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
              <div>
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">
                  🎯 Priorität (Fokus)
                </label>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as '' | 'A' | 'B' | 'C' | 'AB')}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
                  <option value="">Alle</option>
                  <option value="A">🅰️ Nur A (Muss können)</option>
                  <option value="AB">🅰️🅱️ A + B (Muss + Sollte)</option>
                  <option value="B">🅱️ Nur B</option>
                  <option value="C">🅲 Nur C (Nice to know)</option>
                </select>
                <p className="text-xs text-[#6b7280] mt-1.5">Empfehlung: <strong>Nur A</strong> kurz vor Prüfung.</p>
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
            <button onClick={() => onNavigate(returnPage)}
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

        {/* MC Pre-Flight modal: appears when user starts MC mode and some
            cards lack mcQuestions. Fixed overlay above the setup screen. */}
        {mcPreFlight && (
          <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl p-6 max-w-md w-full space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">🎯 MC-Fragen werden noch benötigt</h3>
              <p className="text-sm text-[#d1d5db] leading-relaxed">
                <strong className="text-white">{mcPreFlight.missing.length}</strong> von{' '}
                <strong className="text-white">{mcPreFlight.allCards.length}</strong> Karten haben noch keine MC-Fragen.
                Die KI generiert sie jetzt automatisch — das dauert ca.{' '}
                <strong className="text-white">{Math.ceil(mcPreFlight.missing.length * 2.5)}</strong> Sekunden.
              </p>
              <div className="bg-[#252840] rounded-xl p-3 text-xs text-[#9ca3af] leading-relaxed">
                💡 Du kannst die Karten auch vorab in der Library bulk-generieren ("🎯 MC generieren"-Button bei Auswahl).
                Dann startest du MC-Sessions in Zukunft sofort ohne Wartezeit.
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => { setMcPreFlight(null); }}
                  disabled={mcGenerating}
                  className="flex-1 px-4 py-2 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors disabled:opacity-40"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handleFallbackToClassic}
                  disabled={mcGenerating}
                  className="flex-1 px-4 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors disabled:opacity-40"
                >
                  📝 Stattdessen Karteikarten
                </button>
                <button
                  onClick={handleConfirmGenerateMissingMC}
                  disabled={mcGenerating || !onGenerateMC}
                  className="flex-1 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  {mcGenerating ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Generiere…
                    </>
                  ) : (
                    <>🤖 Jetzt generieren</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (sessionState === 'summary') {
    // ── MC summary branch ────────────────────────────────────────────
    if (sessionMode === 'mc') {
      const totalAnswered = Array.from(mcAnswers.values())
        .reduce((s, arr) => s + arr.filter(Boolean).length, 0);
      const correct = Array.from(mcAnswers.values())
        .reduce((s, arr) => s + arr.filter(a => a?.isCorrect).length, 0);
      const mcPct = totalAnswered > 0 ? Math.round((correct / totalAnswered) * 100) : 0;
      const cardsTouched = sessionCards.length;

      return (
        <div className="p-4 md:p-6 lg:p-8 fade-in">
          <div className="max-w-md mx-auto text-center">
            <div className="text-6xl mb-4">{mcPct >= 80 ? '🎯' : mcPct >= 50 ? '📚' : '💪'}</div>
            <h2 className="text-2xl font-bold text-white mb-1">MC-Session abgeschlossen!</h2>
            <p className="text-[#9ca3af] text-sm mb-5">{cardsTouched} Karten · {totalAnswered} Fragen beantwortet</p>

            <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 mb-5">
              <div className="text-4xl font-bold text-white mb-1">{mcPct}%</div>
              <p className="text-[#9ca3af] text-sm mb-4">{correct} von {totalAnswered} richtig</p>
              <div className="w-full h-3 bg-[#252840] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${
                  mcPct >= 80 ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
                  mcPct >= 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                  'bg-gradient-to-r from-red-500 to-red-400'
                }`} style={{ width: `${mcPct}%` }} />
              </div>
            </div>

            <div className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-4 mb-5 text-left">
              <p className="text-sm text-purple-200 font-semibold flex items-center gap-2 mb-1">
                💡 Jetzt im Karteikarten-Modus festigen?
              </p>
              <p className="text-xs text-[#d1d5db] leading-relaxed">
                Du hast die Inhalte als MC erkannt — jetzt im klassischen Karteikarten-Modus laut/aktiv reproduzieren
                und fürs SRS bewerten. Erkennung → Wiedergabe ist der bewährte Lern-Loop.
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleFestigenInClassicMode}
                className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition-colors"
              >
                📝 Jetzt im Karteikarten-Modus festigen
              </button>
              <div className="flex gap-3">
                <button onClick={startSession}
                  className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors text-sm font-medium">
                  🎯 MC-Session wiederholen
                </button>
                <button onClick={() => { onSessionComplete(); onNavigate(returnPage); }}
                  className="flex-1 py-2.5 rounded-xl bg-[#252840] hover:bg-[#2d3148] text-[#9ca3af] hover:text-white transition-colors text-sm font-medium">
                  Fertig
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

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
            <button onClick={() => { onSessionComplete(); onNavigate(returnPage); }}
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition-colors">
              Fertig
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── MC-Modus Studying View ────────────────────────────────────────────
  // Branches off here so the classic flashcard render below is unchanged.
  if (sessionState === 'studying' && sessionMode === 'mc') {
    // Always read the current card from the FRESH sessionCards array — after
    // an edit or MC-regen the local sessionCards may have been mutated and we
    // need the new content for the Karten-Frage preview.
    const mcCurrent = sessionCards[mcCardIdx];
    if (!mcCurrent || !mcCurrent.mcQuestions || mcCurrent.mcQuestions.length === 0) {
      // Defensive: should never happen because pre-flight ensures all cards have MC
      return (
        <div className="p-8 text-center text-[#9ca3af]">
          Keine MC-Fragen vorhanden für aktuelle Karte. Zurück zum Setup.
          <button onClick={() => setSessionState('setup')} className="mt-4 text-indigo-400 underline block mx-auto">
            Zurück
          </button>
        </div>
      );
    }
    const mcQuestion = mcCurrent.mcQuestions[mcQuestionIdx];
    const correctIds = mcQuestion.options.filter(o => o.correct).map(o => o.id);
    const isMulti = mcQuestion.type === 'multiple';

    const toggleOption = (id: string) => {
      if (mcSubmitted) return;
      if (isMulti) {
        setMcSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
      } else {
        setMcSelected([id]);
      }
    };

    const submit = () => {
      if (mcSelected.length === 0) return;
      const isCorrect =
        mcSelected.length === correctIds.length &&
        mcSelected.every(id => correctIds.includes(id));
      setMcAnswers(prev => {
        const next = new Map(prev);
        const cardAnswers = next.get(mcCurrent.id) ?? [];
        cardAnswers[mcQuestionIdx] = { selected: [...mcSelected], isCorrect };
        next.set(mcCurrent.id, cardAnswers);
        return next;
      });
      setMcSubmitted(true);
    };

    const next = () => {
      // Skip ahead to the next genuinely-unanswered slot. Important after an
      // adapt-merge where some cards in the new list already have answers
      // from the previous session — without skipping the user would see
      // questions they've already answered.
      const result = findNextUnanswered(mcCardIdx, mcQuestionIdx + 1, sessionCards, mcAnswers);
      if (!result) {
        setSessionState('summary');
        return;
      }
      setMcCardIdx(result.cardIdx);
      setMcQuestionIdx(result.questionIdx);
      setMcSelected([]);
      setMcSubmitted(false);
    };

    const totalCards = sessionCards.length;
    const totalQuestionsThisCard = mcCurrent.mcQuestions.length;
    const overallProgress = Math.round(
      (Array.from(mcAnswers.values()).reduce((s, arr) => s + arr.filter(Boolean).length, 0) /
        sessionCards.reduce((s, c) => s + (c.mcQuestions?.length ?? 0), 0)) * 100
    );

    return (
      <div className="flex flex-col h-screen max-h-screen bg-[#0f1117] fade-in">
        {/* Header */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-[#2d3148]">
            <button onClick={() => setSessionState('setup')} className="text-[#9ca3af] hover:text-white text-sm transition-colors">
              ✕ Beenden
            </button>
            <span className="text-sm text-[#9ca3af] font-medium">
              Karte {mcCardIdx + 1} / {totalCards} · Frage {mcQuestionIdx + 1} / {totalQuestionsThisCard}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-semibold">
              🎯 MC-Modus
            </span>
          </div>
          <div className="h-1 bg-[#2d3148]">
            <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>

        {/* MC content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6 max-w-3xl w-full mx-auto">
          {/* Card-Context: the original question text + action row */}
          <div className="mb-5 bg-[#1e2130] border border-[#2d3148] rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Karten-Frage</p>
              {/* Action icons: Chat · Vorschau · Bearbeiten · Blacklist · MC neu generieren */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setChatOpen(true)}
                  title="KI fragen"
                  className="text-xs px-2 py-1 rounded-lg border border-transparent text-[#6b7280] hover:text-indigo-400 hover:bg-[#252840] transition-colors"
                >
                  💬
                </button>
                <button
                  onClick={() => setMcShowBack(v => !v)}
                  title={mcShowBack ? 'Antwort verstecken' : 'Antwort einblenden'}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                    mcShowBack
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                      : 'border-transparent text-[#6b7280] hover:text-purple-400 hover:bg-[#252840]'
                  }`}
                >
                  👁
                </button>
                <button
                  onClick={() => setEditingCard(mcCurrent)}
                  title="Karte bearbeiten"
                  className="text-xs px-2 py-1 rounded-lg border border-transparent text-[#6b7280] hover:text-indigo-400 hover:bg-[#252840] transition-colors"
                >
                  ✏️
                </button>
                {(() => {
                  const liveCard = cardsRef.current.find(c => c.id === mcCurrent.id) ?? mcCurrent;
                  const isBlack = !!liveCard.blacklisted;
                  return (
                    <button
                      onClick={() => {
                        onUpdateCard(mcCurrent.id, { blacklisted: !isBlack });
                        onApiError?.(isBlack
                          ? '✓ Karte von Blacklist entfernt'
                          : '🚫 Karte auf Blacklist — wird in zukünftigen Sessions ausgeschlossen');
                      }}
                      title={isBlack ? 'Von Blacklist entfernen' : 'Auf Blacklist setzen'}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                        isBlack
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'border-transparent text-[#6b7280] hover:text-amber-300 hover:bg-[#252840]'
                      }`}
                    >
                      {isBlack ? '✓' : '🚫'}
                    </button>
                  );
                })()}
                {mcConfirmRegen ? (
                  <>
                    <button
                      onClick={async () => {
                        if (!onGenerateMC || mcRegenerating) return;
                        setMcConfirmRegen(false);
                        setMcRegenerating(true);
                        try {
                          // Clear existing MC questions first so the API will
                          // not be tempted to merge. Persist via onUpdateCard.
                          onUpdateCard(mcCurrent.id, { mcQuestions: undefined, mcQuestionsGeneratedAt: undefined });
                          const { okIds, failedIds } = await onGenerateMC([mcCurrent.id]);
                          if (failedIds.length > 0) {
                            onApiError?.('Neue MC-Fragen konnten nicht generiert werden — Karte bleibt wie sie war.');
                          } else if (okIds.length > 0) {
                            // Pick up fresh mcQuestions from the latest cards prop
                            // and refresh sessionCards / answers / indexes so we
                            // restart this card's MC from question 1.
                            const refreshed = cardsRef.current.find(c => c.id === mcCurrent.id);
                            if (refreshed && refreshed.mcQuestions) {
                              setSessionCards(prev => prev.map(c => c.id === mcCurrent.id ? refreshed : c));
                              setMcAnswers(prev => {
                                const next = new Map(prev);
                                next.delete(mcCurrent.id);
                                return next;
                              });
                              setMcQuestionIdx(0);
                              setMcSelected([]);
                              setMcSubmitted(false);
                              setMcShowBack(false);
                            }
                          }
                        } finally {
                          setMcRegenerating(false);
                        }
                      }}
                      disabled={mcRegenerating}
                      className="text-xs px-2 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 font-semibold transition-colors disabled:opacity-50"
                    >
                      Neu? Ja
                    </button>
                    <button
                      onClick={() => setMcConfirmRegen(false)}
                      className="text-xs px-2 py-1 rounded-lg bg-[#252840] border border-[#2d3148] text-[#9ca3af] transition-colors"
                    >
                      Nein
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setMcConfirmRegen(true)}
                    disabled={!onGenerateMC || mcRegenerating}
                    title="MC-Fragen für diese Karte neu generieren (falls Karte inhaltlich geändert wurde)"
                    className="text-xs px-2 py-1 rounded-lg border border-transparent text-[#6b7280] hover:text-indigo-400 hover:bg-[#252840] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {mcRegenerating ? (
                      <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    ) : '🔄'}
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-[#d1d5db] leading-relaxed">
              <MarkdownText text={mcCurrent.front} />
            </p>
            {mcShowBack && (
              <div className="mt-3 pt-3 border-t border-[#2d3148]">
                <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1.5">Antwort</p>
                <p className="text-sm text-[#e8eaf0] leading-relaxed">
                  <MarkdownText text={mcCurrent.back} />
                </p>
              </div>
            )}
            <p className="text-[10px] text-[#6b7280] mt-2">
              Aspekt: <span className="text-indigo-300">{mcQuestion.topic}</span>
            </p>
          </div>

          {/* MC question */}
          <div className="bg-[#1e2130] border border-indigo-500/30 rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">
                MC-Frage {mcQuestionIdx + 1}
                {isMulti && <span className="ml-2 text-[10px] text-amber-300">(mehrere Antworten möglich)</span>}
              </p>
              <p className="text-base text-white font-medium leading-snug">{mcQuestion.question}</p>
            </div>

            <div className="space-y-2">
              {mcQuestion.options.map(opt => {
                const selected = mcSelected.includes(opt.id);
                const showResult = mcSubmitted;
                const isCorrectOpt = opt.correct;
                let cls = '';
                if (showResult) {
                  if (isCorrectOpt) cls = 'bg-green-500/15 border-green-500/50 text-green-200';
                  else if (selected) cls = 'bg-red-500/15 border-red-500/50 text-red-200';
                  else cls = 'bg-[#252840] border-[#2d3148] text-[#9ca3af]';
                } else {
                  cls = selected
                    ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
                    : 'bg-[#252840] border-[#2d3148] text-[#d1d5db] hover:border-[#3d4168]';
                }
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleOption(opt.id)}
                    disabled={mcSubmitted}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-start gap-3 ${cls} ${mcSubmitted ? 'cursor-default' : 'cursor-pointer hover:scale-[1.01]'}`}
                  >
                    <span className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                      mcSubmitted && isCorrectOpt ? 'border-green-400 bg-green-400/20' :
                      mcSubmitted && selected   ? 'border-red-400 bg-red-400/20' :
                      selected ? 'border-indigo-400 bg-indigo-400/20' :
                      'border-[#3d4168]'
                    }`}>
                      {opt.id.toUpperCase()}
                    </span>
                    <span className="flex-1 text-sm leading-snug">{opt.text}</span>
                    {mcSubmitted && isCorrectOpt && <span className="text-green-400 text-base">✓</span>}
                    {mcSubmitted && selected && !isCorrectOpt && <span className="text-red-400 text-base">✗</span>}
                  </button>
                );
              })}
            </div>

            {mcSubmitted && mcQuestion.explanation && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider mb-1">💡 Erklärung</p>
                <p className="text-sm text-purple-100 leading-relaxed">{mcQuestion.explanation}</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom action */}
        <div className="shrink-0 px-4 md:px-8 pb-6 pt-3 border-t border-[#2d3148]">
          {!mcSubmitted ? (
            <button
              onClick={submit}
              disabled={mcSelected.length === 0}
              className="w-full py-3.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors text-base"
            >
              ✓ Auflösen
            </button>
          ) : (
            <button
              onClick={next}
              className="w-full py-3.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition-colors text-base flex items-center justify-center gap-2"
            >
              {mcQuestionIdx + 1 >= totalQuestionsThisCard
                ? mcCardIdx + 1 >= totalCards ? '🎉 Session abschließen' : 'Nächste Karte →'
                : 'Weiter →'}
            </button>
          )}
        </div>

        {/* Edit-Modal (geteilt mit Klassisch-Modus, lebt dort als Original — hier
            erneut gerendert, weil der MC-Branch früher mit return abzweigt) */}
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

        {/* AI Chat drawer — opens on 💬 click */}
        <CardChatDrawer
          card={mcCurrent}
          userId={userId}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onApiError={onApiError}
          onUpdateCard={(id, patch) => {
            onUpdateCard(id, patch);
            setSessionCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
          }}
          onRegenerateMC={onGenerateMC ? async (id) => { await onGenerateMC([id]); } : undefined}
          apiKeys={{
            gemini: settings.geminiApiKey,
            anthropic: settings.anthropicApiKey,
            groq: settings.groqApiKey,
          }}
        />
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

      {/* Gap freetext input — shown on mobile when 📌 tapped without selection */}
      {gapInputOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={() => setGapInputOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#1e2130] border border-amber-500/30 rounded-2xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-amber-300">📌 Was hast du nicht gewusst?</p>
            <p className="text-xs text-[#9ca3af] leading-snug">
              Tippe kurz den Begriff oder Punkt ein, den du vergessen hattest — er wird beim nächsten Review hervorgehoben.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={gapInputText}
              onChange={e => setGapInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddGapFromInput(); } }}
              placeholder={'z.B. „Pflichtteilsergänzungsanspruch“ oder „Frist beträgt 10 Jahre“'}
              className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#4b5563] resize-none focus:outline-none focus:border-amber-500/50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setGapInputOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-[#9ca3af] hover:bg-[#252840] transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAddGapFromInput}
                disabled={!gapInputText.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Lücke speichern
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Progress bar */}
      <div className="shrink-0">
        <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-[#2d3148]">
          <button onClick={() => setSessionState('setup')} className="text-[#9ca3af] hover:text-white text-sm transition-colors">
            ✕ Beenden
          </button>
          {/* Back / forward navigation */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setViewIdx(v => v - 1); setIsFlipped(false); }}
              disabled={viewIdx === 0}
              title="Vorherige Karte ansehen"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[#1e2130] border border-[#2d3148] hover:border-indigo-500/50 hover:text-white text-[#9ca3af]"
            >
              ‹ Zurück
            </button>
            <span className="text-sm text-[#9ca3af] font-medium min-w-[3.5rem] text-center">
              {viewIdx + 1} / {sessionCards.length}
            </span>
            <button
              onClick={() => { setViewIdx(v => v + 1); setIsFlipped(false); }}
              disabled={viewIdx >= currentIdx}
              title="Zur nächsten Karte"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[#1e2130] border border-[#2d3148] hover:border-indigo-500/50 hover:text-white text-[#9ca3af]"
            >
              Weiter ›
            </button>
          </div>
          <DifficultyBadge difficulty={currentCard.difficulty} />
        </div>
        {/* History banner */}
        {isHistoryView && (
          <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
            <span className="text-xs text-amber-400 font-medium">🔍 Rückblick — Bewertung nur bei der aktuellen Karte</span>
            <button
              onClick={() => { setViewIdx(currentIdx); setIsFlipped(false); }}
              className="text-xs text-amber-300 hover:text-white font-semibold underline underline-offset-2 transition-colors"
            >
              Zur aktuellen Karte →
            </button>
          </div>
        )}
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
            onMouseDown={(e) => { cardMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
            onClick={(e) => {
              // Suppress flip when the user dragged to select text
              const down = cardMouseDownPos.current;
              cardMouseDownPos.current = null;
              if (down) {
                const dx = Math.abs(e.clientX - down.x);
                const dy = Math.abs(e.clientY - down.y);
                if (dx > 4 || dy > 4) return; // was a drag, not a tap
              }
              // Also suppress if there's still an active text selection
              const sel = window.getSelection();
              if (sel && sel.toString().length > 0) return;
              setIsFlipped(f => !f);
            }}
          >
            {/* Front */}
            <div className="card-face bg-[#1e2130] border border-[#2d3148] rounded-3xl flex flex-col select-none relative">
              {/* Priority picker in the corner — small, unobtrusive */}
              <div className="absolute top-3 right-3 z-10" onClick={e => e.stopPropagation()}>
                <PriorityPicker
                  value={currentCard.priority}
                  // Manual change → priorityLocked: true. Globale Auto-Classify-
                  // Re-Runs respektieren das und lassen die Karte in Ruhe.
                  onChange={(p) => onUpdateCard(currentCard.id, { priority: p, priorityLocked: true })}
                  size="md"
                />
              </div>
              <div className="shrink-0 pt-5 pb-2 text-center">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Frage</span>
              </div>
              {/* Scrollable question content — only the question scrolls. */}
              <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-10 pb-2 flex flex-col items-start gap-3">
                {frontImg && <img src={frontImg} alt="" onClick={e => { e.stopPropagation(); setZoomedImg(frontImg); }} className="max-h-40 max-w-full object-contain rounded-xl cursor-zoom-in" />}
                <p className="text-lg md:text-xl font-medium text-white text-left leading-relaxed w-full">
                  <MarkdownText text={currentCard.front} />
                </p>
              </div>

              {/* MC Hint + KI Prüfung action area — pinned to bottom of card-face
                  so action buttons stay visible regardless of question length.
                  Panel can grow up to 60% of card height when expanded; above
                  that it scrolls internally.
                  Buttons are ALWAYS rendered (even without API keys configured)
                  so users see what's available. Clicking without a key surfaces
                  a clear "Kein AI-Schlüssel konfiguriert"-message via onApiError,
                  which is friendlier than hiding the feature silently. */}
                  <div
                    className="shrink-0 border-t border-[#2d3148]/60 px-6 md:px-10 py-2 max-h-[60%] overflow-y-auto"
                    onClick={e => e.stopPropagation()}
                  >
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
                          hasGaps={!!(currentCard?.gaps && currentCard.gaps.length > 0)}
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
              {!isFlipped && !effectiveMcHint && (
                <div className="shrink-0 pb-3 text-center">
                  <p className="text-xs text-[#6b7280] animate-pulse">Klicke zum Umdrehen</p>
                </div>
              )}
            </div>
            {/* Back */}
            <div className="card-face card-back-face bg-[#1e2130] border border-indigo-500/40 rounded-3xl flex flex-col" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
              {/* Header row: label left, action icons right.
                  On mobile we cut horizontal padding and allow the icon row
                  to scroll horizontally — 7 actions + label don't fit on a
                  narrow phone otherwise. */}
              <div className="shrink-0 flex items-center justify-between gap-2 px-2 sm:px-3 pt-3 pb-2 border-b border-[#2d3148]/60" onClick={e => e.stopPropagation()}>
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest pl-1 shrink-0">Antwort</span>
                <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto no-scrollbar">
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
                        className={`text-xs px-1.5 sm:px-2 py-1.5 rounded-lg border transition-colors shrink-0 ${
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
                        className={`text-base px-1.5 sm:px-2 py-1.5 rounded-lg border transition-colors shrink-0 ${
                          isFlagged
                            ? 'bg-red-500/20 border-red-500/40 text-red-400'
                            : 'text-[#6b7280] hover:text-red-400 border-transparent hover:bg-[#252840]'
                        }`}
                      >
                        🚩
                      </button>
                    );
                  })()}
                  <button
                    onClick={e => { e.stopPropagation(); handleAddGap(); }}
                    title="Lücke markieren — Text auswählen dann tippen, oder einfach antippen um frei einzugeben"
                    className="text-base px-1.5 sm:px-2 py-1.5 rounded-lg border border-transparent text-[#6b7280] hover:text-amber-400 hover:bg-[#252840] transition-colors shrink-0"
                  >
                    📌
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setChatOpen(true); }}
                    title="KI fragen"
                    className="text-base px-1.5 sm:px-2 py-1.5 rounded-lg border border-transparent text-[#6b7280] hover:text-indigo-400 hover:bg-[#252840] transition-colors shrink-0"
                  >
                    💬
                  </button>
                  {!isHistoryView && (
                  <button
                    onClick={e => { e.stopPropagation(); handleParkCurrent(); }}
                    title="Auf Blacklist setzen — Karte aus allen Lern-Pools ausschließen (bleibt in Bibliothek)"
                    className="text-base px-1.5 sm:px-2 py-1.5 rounded-lg border border-transparent text-[#6b7280] hover:text-amber-300 hover:bg-[#252840] transition-colors shrink-0"
                  >
                    🚫
                  </button>
                  )}
                  {!isHistoryView && onSplitCard && (
                    <button
                      onClick={e => { e.stopPropagation(); handleSplitCurrent(); }}
                      disabled={splitInProgress}
                      className={`text-base px-1.5 sm:px-2 py-1.5 rounded-lg border transition-colors shrink-0 ${
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
                    className="text-[#6b7280] hover:text-indigo-400 text-base transition-colors px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-[#252840] shrink-0"
                    title="Karte bearbeiten"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      exportJSON([currentCard], `karte_${currentCard.id.slice(0, 8)}.json`);
                    }}
                    className="text-[#6b7280] hover:text-indigo-400 text-base transition-colors px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-[#252840] shrink-0"
                    title="Karte als JSON exportieren"
                  >
                    📦
                  </button>
                  {!isHistoryView && (confirmDeleteId === currentCard.id ? (
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
                      className="text-[#6b7280] hover:text-red-400 text-base transition-colors px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-[#252840] shrink-0"
                      title="Karte löschen"
                    >
                      🗑️
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 md:px-10 pb-6 flex flex-col items-start gap-3">
                {/* Gaps from last review — shown prominently so user can verify they closed them */}
                {currentCard.gaps && currentCard.gaps.length > 0 && (
                  <div className="w-full bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">📌 Letzte Lücken</p>
                    <div className="flex flex-col gap-1.5">
                      {currentCard.gaps.map((gap, i) => (
                        <div key={i} className="flex items-start gap-2 group">
                          <span className="flex-1 text-sm text-amber-200 bg-amber-500/10 rounded-lg px-2.5 py-1.5 leading-snug">{gap}</span>
                          <button
                            onClick={() => handleRemoveGap(gap)}
                            title="Lücke entfernen"
                            className="shrink-0 mt-1 text-[#6b7280] hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {backImg && <img src={backImg} alt="" onClick={e => { e.stopPropagation(); setZoomedImg(backImg); }} className="max-h-40 max-w-full object-contain rounded-xl cursor-zoom-in" />}
                <p className="text-base md:text-lg text-[#e8eaf0] text-left leading-relaxed w-full select-text">
                  <MarkdownText text={currentCard.back} />
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Subject / tags info — compact by default so MC/KI-Buttons unten
            sichtbar bleiben. Wird per Toggle aufgeklappt wenn der User die
            vollständige Zuordnung sehen will. */}
        <CardMetadataBar
          subjects={currentCard.subjects ?? []}
          examiners={currentCard.examiners ?? []}
          customTags={currentCard.customTags ?? []}
        />
      </div>

      {/* "Lücken geschlossen?" prompt — replaces rating buttons temporarily */}
      {pendingGapsClear && pendingGapsClear.cardId === currentCard?.id && (
        <div className="shrink-0 px-4 md:px-8 pb-2">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-300 text-center">
              📌 Lücken jetzt geschlossen?
            </p>
            <p className="text-xs text-[#9ca3af] text-center leading-snug">
              Du hattest {pendingGapsClear.cardId === currentCard.id ? (currentCard.gaps?.length ?? 0) : 0} markierte Lücke(n) auf dieser Karte.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Clear gaps, then advance
                  onUpdateCard(pendingGapsClear.cardId, { gaps: [] });
                  setSessionCards(prev => prev.map(c => c.id === pendingGapsClear.cardId ? { ...c, gaps: [] } : c));
                  pendingGapsClear.nextAction();
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors"
              >
                ✓ Ja, löschen
              </button>
              <button
                onClick={() => pendingGapsClear.nextAction()}
                className="flex-1 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white font-semibold text-sm transition-colors"
              >
                ✗ Noch nicht
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rating buttons (hidden in history/Rückblick mode or while gaps prompt is showing) */}
      <div className="shrink-0 px-4 md:px-8 pb-6 md:pb-8 space-y-3">
        {isHistoryView ? (
          <button
            onClick={() => { setViewIdx(currentIdx); setIsFlipped(false); }}
            className="w-full py-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold transition-all text-base"
          >
            ▶ Zur aktuellen Karte ({currentIdx + 1})
          </button>
        ) : pendingGapsClear ? null : (
          <>
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
          </>
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

      <CardChatDrawer
        card={currentCard}
        userId={userId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onApiError={onApiError}
        onUpdateCard={(id, patch) => {
          onUpdateCard(id, patch);
          setSessionCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
        }}
        onRegenerateMC={onGenerateMC ? async (id) => { await onGenerateMC([id]); } : undefined}
        apiKeys={{
          gemini: settings.geminiApiKey,
          anthropic: settings.anthropicApiKey,
          groq: settings.groqApiKey,
        }}
      />
    </div>
  );
}

// Compact metadata bar: shows subjects + first N examiners by default,
// hides all custom-tags behind a count-button. User can tap to expand
// the full list. Prevents 30+ Fragenkatalog-tags from pushing MC/KI
// buttons off the screen on mobile.
function CardMetadataBar({
  subjects,
  examiners,
  customTags,
}: {
  subjects: string[];
  examiners: string[];
  customTags: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const EXAMINER_PREVIEW = 3;
  const showAllExaminers = expanded || examiners.length <= EXAMINER_PREVIEW;
  const examinersVisible = showAllExaminers ? examiners : examiners.slice(0, EXAMINER_PREVIEW);
  const examinersHidden = examiners.length - examinersVisible.length;
  const hasTags = customTags.length > 0;

  return (
    <div className="flex items-center gap-1.5 py-1.5 flex-wrap justify-center shrink-0 px-3">
      {subjects.map(s => (
        <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e2130] border border-[#2d3148] text-[#9ca3af]">
          {s}
        </span>
      ))}
      {examinersVisible.map(e => (
        <span key={e} className="text-[11px] text-[#6b7280]">👤 {e}</span>
      ))}
      {!expanded && examinersHidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline"
        >
          +{examinersHidden} Prüfer
        </button>
      )}
      {!expanded && hasTags && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline"
        >
          +{customTags.length} Tags
        </button>
      )}
      {expanded && customTags.map(t => (
        <span key={t} className="text-[10px] text-[#6b7280]">#{t}</span>
      ))}
      {expanded && (examinersHidden > 0 || hasTags) && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-[#6b7280] hover:text-[#9ca3af] underline-offset-2 hover:underline"
        >
          weniger
        </button>
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
  hasGaps?: boolean; // card has stored gaps → probe questions shown in red
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
  state, speechSupported, hasGaps,
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
              {state.listening ? (
                <MicPulseVisualizer />
              ) : (
                <textarea
                  value={state.text}
                  onChange={e => onSetText(e.target.value)}
                  placeholder='Klicke auf "Aufnahme starten" oder tippe direkt hier…'
                  rows={3}
                  className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-none overflow-y-auto max-h-[120px]"
                />
              )}
            </div>
          )}

          {/* Text-only mode UI */}
          {(state.mode === 'text' || !speechSupported) && (
            <textarea
              value={state.text}
              onChange={e => onSetText(e.target.value)}
              placeholder="Tippe deine Erklärung hier… (z.B. in der U-Bahn 🚇)"
              rows={3}
              autoFocus
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-none overflow-y-auto max-h-[120px]"
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
                    i === state.idx ? (hasGaps && i === state.followUps.length - 1 ? 'bg-red-400' : 'bg-purple-400') :
                    'bg-[#2d3148]'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* The follow-up question — only the last question is red when it's gap-specific */}
          {(() => {
            const isGapQuestion = hasGaps && state.idx === state.followUps.length - 1;
            return (
              <div className={`px-3 py-2.5 rounded-xl border ${isGapQuestion ? 'bg-red-500/10 border-red-500/30' : 'bg-purple-500/10 border-purple-500/30'}`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${isGapQuestion ? 'text-red-300/80' : 'text-purple-300/80'}`}>
                  {isGapQuestion ? '📌 Wissenslücke · Frage' : 'Frage'}
                </p>
                <p className="text-sm text-white leading-snug">{state.followUps[state.idx]}</p>
              </div>
            );
          })()}

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
              {state.listening ? (
                <MicPulseVisualizer barCount={5} />
              ) : (
                <textarea
                  value={state.currentText}
                  onChange={e => onSetText(e.target.value)}
                  placeholder='Klicke auf "Antwort einsprechen" oder tippe direkt hier…'
                  rows={3}
                  className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-none overflow-y-auto max-h-[120px]"
                />
              )}
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
              className="w-full text-sm bg-[#1e2130] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-none overflow-y-auto max-h-[120px]"
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

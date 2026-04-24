import { useState, useMemo } from 'react';
import type { Flashcard, AppSettings, RatingValue, CardSet, CardLink } from '../types/card';
import { isDueToday, STUDY_RATINGS } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import MarkdownText from '../components/MarkdownText';
import { LinkedCardsPanel } from '../components/LinkedCards';
import QuickEditModal from '../components/QuickEditModal';
import { generateMCHint } from '../utils/geminiMCHint';
import type { MCHintResult } from '../utils/geminiMCHint';

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

/** MC hint state — null means idle; cardId auto-invalidates when card changes */
type MCHintState =
  | { cardId: string; status: 'loading' }
  | { cardId: string; status: 'ready';     result: MCHintResult; selected: string[] }
  | { cardId: string; status: 'submitted'; result: MCHintResult; selected: string[]; isCorrect: boolean };

interface RatingCount {
  nochmal: number; schwer: number; gut: number; einfach: number;
}

export default function StudySession({ cards, settings, sets, links, preFilteredCards, dailyPlan, onRate, onUpdateCard, onDeleteCard, onSplitCard, onSessionComplete, onNavigate, onApiError }: Props) {
  const isDailyMode = !!dailyPlan;
  const [sessionState, setSessionState] = useState<SessionState>('setup');
  const [studyOrder, setStudyOrder] = useState<StudyOrder>(
    () => (localStorage.getItem('study_order') as StudyOrder) ?? 'review-first'
  );
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminer, setFilterExaminer] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterSet, setFilterSet] = useState('');
  const [onlyDue, setOnlyDue] = useState(true);
  const [filterKlassiker, setFilterKlassiker] = useState(false);
  const [sortByProbability, setSortByProbability] = useState(false);
  const [endlessMode, setEndlessMode] = useState(false);
  const [sessionCards, setSessionCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<RatingCount>({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [splitInProgress, setSplitInProgress] = useState(false);
  const [mcHint, setMcHint] = useState<MCHintState | null>(null);

  // Cards available for setup
  const availableCards = useMemo(() => {
    let result = preFilteredCards ?? cards;
    if (!preFilteredCards) {
      if (filterSubject) result = result.filter(c => c.subjects?.includes(filterSubject));
      if (filterExaminer) result = result.filter(c => c.examiners?.includes(filterExaminer));
      if (filterDifficulty) result = result.filter(c => c.difficulty === filterDifficulty);
      if (filterSet) result = result.filter(c => c.setId === filterSet);
      if (!endlessMode && onlyDue) result = result.filter(isDueToday);
      if (filterKlassiker) result = result.filter(c => (c.probabilityPercent ?? 0) > 60);
      if (sortByProbability) result = [...result].sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    }
    return result;
  }, [cards, preFilteredCards, filterSubject, filterExaminer, filterDifficulty, filterSet, onlyDue, endlessMode, filterKlassiker, sortByProbability]);

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
      const newCards = availableCards.filter(c => c.repetitions === 0).sort(() => Math.random() - 0.5);
      const reviewCards = sortByProbability
        ? availableCards.filter(c => c.repetitions > 0).sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0))
        : availableCards.filter(c => c.repetitions > 0).sort(() => Math.random() - 0.5);
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
      const result = await generateMCHint(
        { gemini: settings.geminiApiKey, anthropic: settings.anthropicApiKey, groq: settings.groqApiKey },
        currentCard.front,
        currentCard.back,
      );
      setMcHint({ cardId, status: 'ready', result, selected: [] });
    } catch (err) {
      setMcHint(null);
      onApiError?.(err instanceof Error ? err.message : 'MC-Tipp konnte nicht generiert werden');
    }
  };

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

  const imgSrc = (img: Flashcard['frontImage']) => img
    ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data)
    : null;

  if (sessionState === 'setup') {
    // Compute new/review split for the preview
    const previewNew = isDailyMode
      ? dailyPlan!.newCards.length
      : availableCards.filter(c => c.repetitions === 0).length;
    const previewReview = isDailyMode
      ? dailyPlan!.reviewCards.length
      : availableCards.filter(c => c.repetitions > 0).length;
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
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">Prüfer</label>
                <select value={filterExaminer} onChange={e => setFilterExaminer(e.target.value)}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
                  <option value="">Alle Prüfer</option>
                  {settings.examiners.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
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
              <label className="flex items-center gap-3 cursor-pointer">
                <div onClick={() => setOnlyDue(!onlyDue)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${onlyDue ? 'bg-indigo-500' : 'bg-[#2d3148]'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${onlyDue ? 'left-5' : 'left-1'}`} />
                </div>
                <span className="text-sm text-white">Nur fällige Karten</span>
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
                        hint={effectiveMcHint.result}
                        selected={effectiveMcHint.selected}
                        submitted={effectiveMcHint.status === 'submitted'}
                        isCorrect={effectiveMcHint.status === 'submitted' ? effectiveMcHint.isCorrect : false}
                        onToggle={(id) => {
                          if (effectiveMcHint.status !== 'ready') return;
                          const { result, selected } = effectiveMcHint;
                          const next = result.type === 'single'
                            ? [id]
                            : selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
                          setMcHint({ cardId: currentCard.id, status: 'ready', result, selected: next });
                        }}
                        onSubmit={() => {
                          if (effectiveMcHint.status !== 'ready') return;
                          const { result, selected } = effectiveMcHint;
                          const correctIds = result.options.filter(o => o.correct).map(o => o.id);
                          const isCorrect =
                            selected.length === correctIds.length &&
                            selected.every(id => correctIds.includes(id));
                          setMcHint({ cardId: currentCard.id, status: 'submitted', result, selected, isCorrect });
                        }}
                      />
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
  selected: string[];
  submitted: boolean;
  isCorrect: boolean;
  onToggle: (id: string) => void;
  onSubmit: () => void;
}

function MCHintWidget({ hint, selected, submitted, isCorrect, onToggle, onSubmit }: MCHintWidgetProps) {
  return (
    <div className="w-full space-y-2.5">
      {/* Question + type badge */}
      <div className="flex items-start gap-2">
        <span className="text-sm">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-snug">{hint.question}</p>
          <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${
            hint.type === 'single'
              ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
              : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
          }`}>
            {hint.type === 'single' ? 'Single Choice – 1 Antwort' : 'Multiple Choice – mehrere Antworten'}
          </span>
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
          <p className="text-[10px] text-[#6b7280] px-1 italic">Kein Einfluss auf SRS — jetzt normal aufdecken & bewerten</p>
        </div>
      )}
    </div>
  );
}

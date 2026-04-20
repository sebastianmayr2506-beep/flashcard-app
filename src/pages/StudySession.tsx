import { useState, useEffect, useMemo } from 'react';
import type { Flashcard, AppSettings, RatingValue, CardSet, CardLink } from '../types/card';
import { isDueToday, STUDY_RATINGS } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import MarkdownText from '../components/MarkdownText';
import { LinkedCardsPanel } from '../components/LinkedCards';

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
  onSessionComplete: () => void;
  onNavigate: (page: string) => void;
}

type SessionState = 'setup' | 'studying' | 'summary';

interface RatingCount {
  nochmal: number; schwer: number; gut: number; einfach: number;
}

export default function StudySession({ cards, settings, sets, links, preFilteredCards, dailyPlan, onRate, onSessionComplete, onNavigate }: Props) {
  const isDailyMode = !!dailyPlan;
  const [sessionState, setSessionState] = useState<SessionState>(
    (preFilteredCards || dailyPlan) ? 'studying' : 'setup'
  );
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminer, setFilterExaminer] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterSet, setFilterSet] = useState('');
  const [onlyDue, setOnlyDue] = useState(true);
  const [filterKlassiker, setFilterKlassiker] = useState(false);
  const [sortByProbability, setSortByProbability] = useState(false);
  const [sessionCards, setSessionCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<RatingCount>({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);

  // Cards available for setup
  const availableCards = useMemo(() => {
    let result = preFilteredCards ?? cards;
    if (!preFilteredCards) {
      if (filterSubject) result = result.filter(c => c.subjects?.includes(filterSubject));
      if (filterExaminer) result = result.filter(c => c.examiners?.includes(filterExaminer));
      if (filterDifficulty) result = result.filter(c => c.difficulty === filterDifficulty);
      if (filterSet) result = result.filter(c => c.setId === filterSet);
      if (onlyDue) result = result.filter(isDueToday);
      if (filterKlassiker) result = result.filter(c => (c.probabilityPercent ?? 0) > 60);
      if (sortByProbability) result = [...result].sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    }
    return result;
  }, [cards, preFilteredCards, filterSubject, filterExaminer, filterDifficulty, filterSet, onlyDue, filterKlassiker, sortByProbability]);

  useEffect(() => {
    if (dailyPlan) {
      // Reviews first (shuffled), then new cards (shuffled) — intentional order
      const shuffledReviews = [...dailyPlan.reviewCards].sort(() => Math.random() - 0.5);
      const shuffledNew = [...dailyPlan.newCards].sort(() => Math.random() - 0.5);
      setSessionCards([...shuffledReviews, ...shuffledNew]);
      setSessionState('studying');
    } else if (preFilteredCards) {
      setSessionCards([...preFilteredCards].sort(() => Math.random() - 0.5));
      setSessionState('studying');
    }
  }, [preFilteredCards, dailyPlan]);

  const startSession = () => {
    if (availableCards.length === 0) return;
    const ordered = sortByProbability
      ? [...availableCards].sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0))
      : [...availableCards].sort(() => Math.random() - 0.5);
    setSessionCards(ordered);
    setCurrentIdx(0);
    setIsFlipped(false);
    setRatings({ nochmal: 0, schwer: 0, gut: 0, einfach: 0 });
    setSessionState('studying');
  };

  const handleRate = (rating: RatingValue) => {
    const card = sessionCards[currentIdx];
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

  const imgSrc = (img: Flashcard['frontImage']) => img
    ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data)
    : null;

  if (sessionState === 'setup') {
    return (
      <div className="p-4 md:p-6 lg:p-8 fade-in">
        <div className="max-w-lg mx-auto">
          <h2 className="text-2xl font-bold text-white mb-1">Lern-Session starten</h2>
          <p className="text-[#9ca3af] text-sm mb-6">Wähle deine Filter und beginne zu lernen</p>

          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
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
              <div
                onClick={() => setOnlyDue(!onlyDue)}
                className={`w-10 h-6 rounded-full transition-colors relative ${onlyDue ? 'bg-indigo-500' : 'bg-[#2d3148]'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${onlyDue ? 'left-5' : 'left-1'}`} />
              </div>
              <span className="text-sm text-white">Nur fällige Karten</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setFilterKlassiker(!filterKlassiker)}
                className={`w-10 h-6 rounded-full transition-colors relative ${filterKlassiker ? 'bg-red-500' : 'bg-[#2d3148]'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${filterKlassiker ? 'left-5' : 'left-1'}`} />
              </div>
              <span className="text-sm text-white">🔥 Nur Klassiker (&gt;60% Wahrscheinlichkeit)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setSortByProbability(!sortByProbability)}
                className={`w-10 h-6 rounded-full transition-colors relative ${sortByProbability ? 'bg-amber-500' : 'bg-[#2d3148]'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${sortByProbability ? 'left-5' : 'left-1'}`} />
              </div>
              <span className="text-sm text-white">📊 Nach Wahrscheinlichkeit sortieren</span>
            </label>

            <div className={`p-3 rounded-xl text-center ${availableCards.length > 0 ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-[#252840]'}`}>
              <p className={`text-2xl font-bold ${availableCards.length > 0 ? 'text-indigo-400' : 'text-[#6b7280]'}`}>
                {availableCards.length}
              </p>
              <p className="text-xs text-[#9ca3af] mt-0.5">Karten verfügbar</p>
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={() => onNavigate('dashboard')}
              className="flex-1 py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors font-medium">
              Zurück
            </button>
            <button
              onClick={startSession}
              disabled={availableCards.length === 0}
              className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
            >
              ▶ Starten
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
      <div className="flex-1 flex flex-col items-center px-4 md:px-8 py-4 min-h-0">
        <div className="w-full max-w-2xl flex-1 perspective min-h-0">
          <div
            className="card-inner cursor-pointer"
            style={{ transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
            onClick={() => !isFlipped && setIsFlipped(true)}
          >
            {/* Front */}
            <div className="card-face bg-[#1e2130] border border-[#2d3148] rounded-3xl flex flex-col select-none">
              <div className="shrink-0 pt-5 pb-2 text-center">
                <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Frage</span>
              </div>
              <div className="flex-1 overflow-y-auto px-8 pb-4 flex flex-col items-start gap-3">
                {frontImg && <img src={frontImg} alt="" onClick={e => { e.stopPropagation(); setZoomedImg(frontImg); }} className="max-h-40 max-w-full object-contain rounded-xl cursor-zoom-in" />}
                <p className="text-lg md:text-xl font-medium text-white text-left leading-relaxed w-full">
                  <MarkdownText text={currentCard.front} />
                </p>
              </div>
              {!isFlipped && (
                <div className="shrink-0 pb-4 text-center">
                  <p className="text-xs text-[#6b7280] animate-pulse">Klicke zum Umdrehen</p>
                </div>
              )}
            </div>
            {/* Back */}
            <div className="card-face card-back-face bg-[#1e2130] border border-indigo-500/40 rounded-3xl flex flex-col select-none" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
              <div className="shrink-0 pt-5 pb-2 text-center">
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest">Antwort</span>
              </div>
              <div className="flex-1 overflow-y-auto px-8 pb-6 flex flex-col items-start gap-3">
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

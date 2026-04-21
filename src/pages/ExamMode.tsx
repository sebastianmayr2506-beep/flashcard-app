import { useState, useMemo, useRef } from 'react';
import type { Flashcard, AppSettings, CardSet, CardLink } from '../types/card';
import MarkdownText from '../components/MarkdownText';
import DifficultyBadge from '../components/DifficultyBadge';
import { LinkedCardsPanel } from '../components/LinkedCards';
import QuickEditModal from '../components/QuickEditModal';

// ─── Types ────────────────────────────────────────────────────

type Phase = 'setup' | 'session' | 'result';
type Source = 'all' | 'set' | 'flagged' | 'filter' | 'klassiker';
type Order = 'random' | 'difficulty' | 'probability';

interface ExamConfig {
  source: Source;
  setId: string;
  filterSubject: string;
  filterExaminer: string;
  filterDifficulty: string;
  filterTag: string;
  countMode: 'all' | 'random';
  randomCount: number;
  order: Order;
}

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  sets: CardSet[];
  links: CardLink[];
  onFlagCards: (ids: string[]) => void;
  onUpdateCard: (id: string, data: Partial<Flashcard>) => void;
  onRecordAttempts: (correct: Flashcard[], wrong: Flashcard[]) => Flashcard[];
  onNavigate: (page: string) => void;
}

// ─── Grade helper ─────────────────────────────────────────────

function getGrade(pct: number): { label: string; color: string; bg: string; border: string } {
  if (pct >= 90) return { label: 'Sehr Gut',      color: 'text-yellow-300', bg: 'bg-yellow-400/10', border: 'border-yellow-400/40' };
  if (pct >= 75) return { label: 'Gut',            color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/40' };
  if (pct >= 60) return { label: 'Befriedigend',   color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/40' };
  if (pct >= 45) return { label: 'Ausreichend',    color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/40' };
  return           { label: 'Nicht Bestanden',    color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/40' };
}

// ─── Confetti ─────────────────────────────────────────────────

const CONFETTI_COLORS = ['#6366f1','#22c55e','#f59e0b','#ec4899','#14b8a6','#f97316','#a855f7'];

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    duration: `${2 + Math.random() * 2.5}s`,
    delay: `${Math.random() * 1.5}s`,
    size: `${6 + Math.random() * 6}px`,
    borderRadius: Math.random() > 0.5 ? '50%' : '2px',
  })), []);

  return (
    <>
      {pieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            backgroundColor: p.color,
            animationDuration: p.duration,
            animationDelay: p.delay,
            width: p.size,
            height: p.size,
            borderRadius: p.borderRadius,
          }}
        />
      ))}
    </>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────

function DonutChart({ correct, total }: { correct: number; total: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : correct / total;
  const wrongPct = 1 - pct;
  const correctLen = pct * circ;
  const wrongLen = wrongPct * circ;
  const displayPct = Math.round(pct * 100);

  return (
    <svg viewBox="0 0 100 100" className="w-40 h-40">
      {/* track */}
      <circle cx="50" cy="50" r={r} fill="none" stroke="#252840" strokeWidth="11" />
      {/* correct (green) */}
      {correctLen > 0 && (
        <circle cx="50" cy="50" r={r} fill="none"
          stroke="#22c55e" strokeWidth="11"
          strokeDasharray={`${correctLen} ${circ}`}
          strokeDashoffset={0}
          transform="rotate(-90 50 50)"
          strokeLinecap="butt"
        />
      )}
      {/* wrong (red) offset by correct arc */}
      {wrongLen > 0 && (
        <circle cx="50" cy="50" r={r} fill="none"
          stroke="#ef4444" strokeWidth="11"
          strokeDasharray={`${wrongLen} ${circ}`}
          strokeDashoffset={-correctLen}
          transform="rotate(-90 50 50)"
          strokeLinecap="butt"
        />
      )}
      <text x="50" y="46" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="Inter, sans-serif">
        {displayPct}%
      </text>
      <text x="50" y="60" textAnchor="middle" fill="#9ca3af" fontSize="8" fontFamily="Inter, sans-serif">
        {correct}/{total}
      </text>
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function ExamMode({ cards, settings, sets, links, onFlagCards, onUpdateCard, onRecordAttempts, onNavigate }: Props) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [config, setConfig] = useState<ExamConfig>({
    source: 'all',
    setId: '',
    filterSubject: '',
    filterExaminer: '',
    filterDifficulty: '',
    filterTag: '',
    countMode: 'all',
    randomCount: 20,
    order: 'random',
  });

  // Session state
  const [sessionCards, setSessionCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [correct, setCorrect] = useState<Flashcard[]>([]);
  const [wrong, setWrong] = useState<Flashcard[]>([]);

  // Result state
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const [autoUnflagged, setAutoUnflagged] = useState<Flashcard[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    cards.forEach(c => c.customTags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [cards]);

  // Cards matching current config
  const candidateCards = useMemo(() => {
    let pool = cards;
    if (config.source === 'set' && config.setId)    pool = pool.filter(c => c.setId === config.setId);
    if (config.source === 'flagged')                pool = pool.filter(c => c.flagged);
    if (config.source === 'klassiker')              pool = pool.filter(c => (c.probabilityPercent ?? 0) > 60);
    if (config.source === 'filter') {
      if (config.filterSubject)   pool = pool.filter(c => c.subjects?.includes(config.filterSubject));
      if (config.filterExaminer)  pool = pool.filter(c => c.examiners?.includes(config.filterExaminer));
      if (config.filterDifficulty) pool = pool.filter(c => c.difficulty === config.filterDifficulty);
      if (config.filterTag)       pool = pool.filter(c => c.customTags.includes(config.filterTag));
    }
    return pool;
  }, [cards, config]);

  const startExam = () => {
    let pool = [...candidateCards];
    // Order
    if (config.order === 'random') {
      pool = pool.sort(() => Math.random() - 0.5);
    } else if (config.order === 'probability') {
      pool = pool.sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    } else {
      const rank = { schwer: 0, mittel: 1, einfach: 2 };
      pool = pool.sort((a, b) => rank[a.difficulty] - rank[b.difficulty]);
    }
    // Count
    if (config.countMode === 'random' && config.randomCount < pool.length) {
      pool = pool.slice(0, config.randomCount);
    }
    setSessionCards(pool);
    setCurrentIdx(0);
    setIsFlipped(false);
    setCorrect([]);
    setWrong([]);
    setFlagged(false);
    setAutoUnflagged([]);
    setPhase('session');
  };

  const restartWithSame = () => {
    setCurrentIdx(0);
    setIsFlipped(false);
    setCorrect([]);
    setWrong([]);
    setFlagged(false);
    setAutoUnflagged([]);
    setSessionCards(prev => [...prev].sort(() => Math.random() - 0.5));
    setPhase('session');
  };

  const restartWithWrong = () => {
    const wrongCards = [...wrong].sort(() => Math.random() - 0.5);
    setSessionCards(wrongCards);
    setCurrentIdx(0);
    setIsFlipped(false);
    setCorrect([]);
    setWrong([]);
    setFlagged(false);
    setAutoUnflagged([]);
    setPhase('session');
  };

  const handleAnswer = (isCorrect: boolean) => {
    const card = sessionCards[currentIdx];
    const newCorrect = isCorrect ? [...correct, card] : correct;
    const newWrong   = !isCorrect ? [...wrong, card] : wrong;
    if (isCorrect) setCorrect(newCorrect); else setWrong(newWrong);
    setIsFlipped(false);

    if (currentIdx + 1 >= sessionCards.length) {
      const unflagged = onRecordAttempts(newCorrect, newWrong);
      setAutoUnflagged(unflagged);
      setPhase('result');
    } else {
      setCurrentIdx(i => i + 1);
    }
  };

  const handleFlagWrong = () => {
    if (flagged) return;
    onFlagCards(wrong.map(c => c.id));
    setFlagged(true);
  };

  const imgSrc = (img: Flashcard['frontImage']) =>
    img ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data) : null;

  // ── Setup Phase ─────────────────────────────────────────────

  if (phase === 'setup') {
    const available = candidateCards.length;
    const finalCount = config.countMode === 'all' ? available : Math.min(config.randomCount, available);

    return (
      <div className="p-4 md:p-6 lg:p-8 fade-in">
        <div className="max-w-lg mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              📝 Prüfungsmodus
            </h2>
            <p className="text-[#9ca3af] text-sm mt-0.5">Teste dein Wissen — ohne SRS-Einfluss</p>
          </div>

          <div className="space-y-5">
            {/* Source */}
            <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Quelle</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['all',       '📚', 'Alle Karten'],
                  ['set',       '📂', 'Ein Set'],
                  ['flagged',   '🚩', 'Geflaggte Karten'],
                  ['filter',    '🔍', 'Nach Filter'],
                  ['klassiker', '🔥', 'Nur Klassiker (>60%)'],
                ] as [Source, string, string][]).map(([val, icon, label]) => (
                  <button
                    key={val}
                    onClick={() => setConfig(c => ({ ...c, source: val }))}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      config.source === val
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                        : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                    }`}
                  >
                    <span>{icon}</span>{label}
                  </button>
                ))}
              </div>

              {config.source === 'set' && (
                <select
                  value={config.setId}
                  onChange={e => setConfig(c => ({ ...c, setId: e.target.value }))}
                  className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Set wählen…</option>
                  {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}

              {config.source === 'filter' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <FilterSelect value={config.filterSubject} onChange={v => setConfig(c => ({ ...c, filterSubject: v }))} placeholder="Fach" options={settings.subjects} />
                  <FilterSelect value={config.filterExaminer} onChange={v => setConfig(c => ({ ...c, filterExaminer: v }))} placeholder="Prüfer" options={settings.examiners} />
                  <FilterSelect value={config.filterDifficulty} onChange={v => setConfig(c => ({ ...c, filterDifficulty: v }))} placeholder="Schwierigkeit" options={['einfach','mittel','schwer']} />
                  {allTags.length > 0 && <FilterSelect value={config.filterTag} onChange={v => setConfig(c => ({ ...c, filterTag: v }))} placeholder="Tag" options={allTags} />}
                </div>
              )}

              <div className={`p-3 rounded-xl text-center ${available > 0 ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-[#252840]'}`}>
                <p className={`text-xl font-bold ${available > 0 ? 'text-indigo-400' : 'text-[#6b7280]'}`}>{available}</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">verfügbare Karten</p>
              </div>
            </div>

            {/* Count */}
            <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Anzahl</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfig(c => ({ ...c, countMode: 'all' }))}
                  className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${config.countMode === 'all' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
                >
                  Alle ({available})
                </button>
                <button
                  onClick={() => setConfig(c => ({ ...c, countMode: 'random' }))}
                  className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${config.countMode === 'random' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
                >
                  Zufällige Anzahl
                </button>
              </div>
              {config.countMode === 'random' && (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={available}
                    value={config.randomCount}
                    onChange={e => setConfig(c => ({ ...c, randomCount: Math.max(1, Math.min(available, +e.target.value || 1)) }))}
                    className="w-24 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none text-center"
                  />
                  <span className="text-sm text-[#9ca3af]">zufällige Karten</span>
                </div>
              )}
            </div>

            {/* Order */}
            <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Reihenfolge</h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setConfig(c => ({ ...c, order: 'random' }))}
                  className={`py-2 rounded-xl border text-sm font-medium transition-all ${config.order === 'random' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
                >
                  🎲 Zufällig
                </button>
                <button
                  onClick={() => setConfig(c => ({ ...c, order: 'difficulty' }))}
                  className={`py-2 rounded-xl border text-sm font-medium transition-all ${config.order === 'difficulty' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
                >
                  💪 Schwer zuerst
                </button>
                <button
                  onClick={() => setConfig(c => ({ ...c, order: 'probability' }))}
                  className={`py-2 rounded-xl border text-sm font-medium transition-all ${config.order === 'probability' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
                >
                  📊 Nach Wahrscheinlichkeit
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => onNavigate('dashboard')}
                className="flex-1 py-3 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors font-medium">
                Abbrechen
              </button>
              <button
                onClick={startExam}
                disabled={available === 0 || (config.source === 'set' && !config.setId)}
                className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
              >
                Prüfung beginnen ({finalCount})
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Session Phase ────────────────────────────────────────────

  if (phase === 'session') {
    const card = sessionCards[currentIdx];
    if (!card) return null;
    const progress = (currentIdx / sessionCards.length) * 100;
    const frontImg = imgSrc(card.frontImage);
    const backImg = imgSrc(card.backImage);

    return (
      <div className="flex flex-col h-screen max-h-screen bg-[#0f1117]">
        {/* Header */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-[#2d3148]">
            <button onClick={() => setPhase('setup')} className="text-[#9ca3af] hover:text-white text-sm transition-colors">
              ✕ Beenden
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#9ca3af] font-medium">{currentIdx + 1} / {sessionCards.length}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-medium">
                📝 Prüfungsmodus
              </span>
            </div>
            <DifficultyBadge difficulty={card.difficulty} />
          </div>
          <div className="h-1 bg-[#2d3148]">
            <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Card */}
        <div className="flex-1 flex flex-col items-center px-4 md:px-8 py-4 min-h-0">
          <div key={card.id} className="w-full max-w-2xl flex-1 perspective min-h-0">
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
                <div className="flex-1 overflow-y-auto px-8 pb-4 flex flex-col items-start gap-3">
                  {frontImg && <img src={frontImg} alt="" className="max-h-40 max-w-full object-contain rounded-xl" />}
                  <p className="text-lg md:text-xl font-medium text-white text-left leading-relaxed w-full">
                    <MarkdownText text={card.front} />
                  </p>
                </div>
                {!isFlipped && (
                  <div className="shrink-0 pb-4 text-center">
                    <p className="text-xs text-[#6b7280] animate-pulse">Klicke zum Umdrehen</p>
                  </div>
                )}
              </div>
              {/* Back */}
              <div className="card-face card-back-face bg-[#1e2130] border border-indigo-500/40 rounded-3xl flex flex-col select-none relative" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                <div className="absolute right-3 top-3 flex items-center gap-1 z-10">
                  {(() => {
                    const liveCard = cards.find(c => c.id === card.id) ?? card;
                    const isDup = liveCard.customTags.includes('duplikat');
                    return (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onUpdateCard(card.id, {
                            customTags: isDup
                              ? liveCard.customTags.filter(t => t !== 'duplikat')
                              : [...liveCard.customTags, 'duplikat'],
                          });
                        }}
                        title={isDup ? 'Duplikat-Tag entfernen' : 'Als Duplikat markieren'}
                        className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                          isDup
                            ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                            : 'text-[#6b7280] hover:text-orange-400 border-transparent hover:bg-[#252840]'
                        }`}
                      >
                        {isDup ? '🔁 Duplikat' : '🔁'}
                      </button>
                    );
                  })()}
                  <button
                    onClick={e => { e.stopPropagation(); setEditingCard(card); }}
                    className="text-[#6b7280] hover:text-indigo-400 text-base transition-colors px-2 py-1 rounded-lg hover:bg-[#252840]"
                    title="Karte bearbeiten"
                  >
                    ✏️
                  </button>
                </div>
                <div className="shrink-0 pt-5 pb-2 text-center">
                  <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest">Antwort</span>
                </div>
                <div className="flex-1 overflow-y-auto px-8 pb-6 flex flex-col items-start gap-3">
                  {backImg && <img src={backImg} alt="" className="max-h-40 max-w-full object-contain rounded-xl" />}
                  <p className="text-base md:text-lg text-[#e8eaf0] text-left leading-relaxed w-full">
                    <MarkdownText text={card.back} />
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* Subjects/tags */}
          <div className="flex items-center gap-2 py-2 flex-wrap justify-center shrink-0">
            {card.subjects?.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#1e2130] border border-[#2d3148] text-[#9ca3af]">{s}</span>)}
            {card.customTags.map(t => <span key={t} className="text-xs text-[#6b7280]">#{t}</span>)}
          </div>
        </div>

        {/* Answer buttons */}
        <div className="shrink-0 px-4 md:px-8 pb-6 md:pb-8 space-y-3">
          {isFlipped && (
            <LinkedCardsPanel
              cardId={card.id}
              allCards={cards}
              links={links}
              title="🔗 Verwandte Fragen"
              onRate={(linkedCardId, rating) => {
                const linkedCard = cards.find(c => c.id === linkedCardId);
                if (!linkedCard) return;
                if (rating > 0) setCorrect(prev => [...prev, linkedCard]);
                else setWrong(prev => [...prev, linkedCard]);
              }}
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
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleAnswer(false)}
                className="py-4 rounded-2xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold text-lg transition-all"
              >
                ❌ Nicht gewusst
              </button>
              <button
                onClick={() => handleAnswer(true)}
                className="py-4 rounded-2xl bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 font-bold text-lg transition-all"
              >
                ✅ Gewusst
              </button>
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
          />
        )}
      </div>
    );
  }

  // ── Result Phase ─────────────────────────────────────────────

  const total = correct.length + wrong.length;
  const pct = total === 0 ? 0 : Math.round((correct.length / total) * 100);
  const grade = getGrade(pct);
  const showConfetti = pct >= 75;

  return (
    <div ref={resultRef} className="min-h-screen bg-[#0f1117] overflow-y-auto pb-12">
      {showConfetti && <Confetti />}

      <div className="max-w-2xl mx-auto px-4 pt-8 space-y-6 fade-in">
        {/* Score header */}
        <div className="bg-[#1e2130] border border-[#2d3148] rounded-3xl p-6 text-center space-y-4">
          <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-widest">Prüfungsergebnis</p>
          <div className="text-6xl font-black text-white">
            {correct.length} <span className="text-3xl text-[#6b7280] font-normal">/ {total}</span>
          </div>
          <div className={`inline-flex items-center gap-2 px-5 py-2 rounded-2xl border text-lg font-bold ${grade.bg} ${grade.border} ${grade.color}`}>
            {grade.label}
          </div>

          {/* Donut + legend */}
          <div className="flex items-center justify-center gap-8 pt-2">
            <DonutChart correct={correct.length} total={total} />
            <div className="space-y-3 text-left">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm text-white font-semibold">{correct.length} Gewusst</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-sm text-white font-semibold">{wrong.length} Nicht gewusst</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {wrong.length > 0 && (
            <button
              onClick={handleFlagWrong}
              disabled={flagged}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-semibold text-sm transition-all ${
                flagged
                  ? 'bg-amber-500/5 border-amber-500/20 text-amber-600 cursor-default'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400'
              }`}
            >
              🚩 {flagged ? 'Karten geflaggt ✓' : 'Falsche Karten flaggen'}
            </button>
          )}
          <button
            onClick={restartWithSame}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#2d3148] bg-[#1e2130] hover:bg-[#252840] text-white font-semibold text-sm transition-all"
          >
            🔄 Nochmal prüfen
          </button>
          {wrong.length > 0 && (
            <button
              onClick={restartWithWrong}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold text-sm transition-all"
            >
              ❌ Nur falsche Karten nochmal
            </button>
          )}
          <button
            onClick={() => onNavigate('dashboard')}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-all"
          >
            ← Zurück zum Dashboard
          </button>
        </div>

        {/* Auto-unflagged banner */}
        {autoUnflagged.length > 0 && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 space-y-2">
            <p className="text-green-400 font-semibold text-sm">
              ✅ {autoUnflagged.length} Flagge{autoUnflagged.length !== 1 ? 'n' : ''} automatisch entfernt – diese Frage{autoUnflagged.length !== 1 ? 'n hast du' : ' hast du'} jetzt im Griff!
            </p>
            <ul className="space-y-1">
              {autoUnflagged.map(c => (
                <li key={c.id} className="text-xs text-green-300/80 line-clamp-1">· {c.front}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Detail list */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">Alle Karten</h3>
          {sessionCards.map(card => {
            const isCorrect = correct.some(c => c.id === card.id);
            const isExpanded = expandedCard === card.id;
            return (
              <div
                key={card.id}
                className={`rounded-xl border overflow-hidden transition-all ${
                  isCorrect ? 'border-green-500/25 bg-green-500/5' : 'border-red-500/25 bg-red-500/5'
                }`}
              >
                <button
                  onClick={() => setExpandedCard(isExpanded ? null : card.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="text-base shrink-0">{isCorrect ? '✅' : '❌'}</span>
                  <span className="flex-1 text-sm text-white truncate">
                    <MarkdownText text={card.front || '(leer)'} />
                  </span>
                  {card.flagged && <span className="text-sm shrink-0">🚩</span>}
                  <span className={`text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2 border-t border-[#2d3148]">
                    <div className="pt-3">
                      <p className="text-xs text-[#9ca3af] uppercase tracking-wider mb-1">Frage</p>
                      <p className="text-sm text-white"><MarkdownText text={card.front} /></p>
                    </div>
                    <div>
                      <p className="text-xs text-[#9ca3af] uppercase tracking-wider mb-1">Antwort</p>
                      <p className="text-sm text-[#e8eaf0]"><MarkdownText text={card.back} /></p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

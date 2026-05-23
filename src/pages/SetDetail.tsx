import { useState, useMemo } from 'react';
import type { CardSet, Flashcard, CardLink, SRSStatus, Difficulty } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { exportSetJSON, exportSetCSV } from '../utils/export';
import { createShareCode } from '../utils/shareCode';
import DifficultyBadge from '../components/DifficultyBadge';
import SRSBadge from '../components/SRSBadge';
import MarkdownText from '../components/MarkdownText';
import SrsLevelGrid, { computeSrsGroups, type SrsKey } from '../components/SrsLevelGrid';

interface Props {
  set: CardSet;
  cards: Flashcard[];
  links: CardLink[];
  userId: string;
  onBack: () => void;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onStudy: (cards: Flashcard[]) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

// ── Filter state ─────────────────────────────────────────────────────────────
type SrsFilter = 'alle' | SRSStatus;
type DiffFilter = 'alle' | Difficulty;

// Small chip button used for filter row
function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string; // tailwind bg class when active
  onClick: () => void;
}) {
  const activeClass = color ?? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
        active
          ? activeClass
          : 'bg-[#1e2130] border-[#2d3148] text-[#6b7280] hover:text-[#9ca3af] hover:border-[#3d4168]'
      }`}
    >
      {label}
    </button>
  );
}

// Expandable card row
function CardRow({
  card,
  onEdit,
  onDelete,
}: {
  card: Flashcard;
  onEdit: (c: Flashcard) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = getSRSStatus(card);
  const due = isDueToday(card);

  return (
    <div
      className={`bg-[#1e2130] border rounded-xl transition-all ${
        due ? 'border-indigo-500/30' : open ? 'border-[#3d4168]' : 'border-[#2d3148]'
      }`}
    >
      {/* ── Row header — always visible ── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#252840]/40 transition-colors rounded-xl"
      >
        {/* Expand indicator */}
        <span className={`text-[#6b7280] text-xs shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>

        {/* Front text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate">
            <MarkdownText text={card.front || '(leer)'} />
          </p>
        </div>

        {/* Badges — always visible (not hidden on mobile anymore) */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {card.flagged && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-medium">
              🚩 Flagge
            </span>
          )}
          <DifficultyBadge difficulty={card.difficulty} />
          <SRSBadge status={status} />
          {due && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              Fällig
            </span>
          )}
        </div>
      </button>

      {/* ── Expanded body ── */}
      {open && (
        <div className="px-4 pb-4 border-t border-[#2d3148]">
          {/* Front */}
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Vorderseite</p>
            <div className="text-sm text-white leading-relaxed">
              <MarkdownText text={card.front || '(leer)'} />
            </div>
          </div>

          {/* Back */}
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Rückseite</p>
            <div className="text-sm text-[#d1d5db] leading-relaxed whitespace-pre-wrap">
              <MarkdownText text={card.back || '(leer)'} />
            </div>
          </div>

          {/* Extra meta */}
          {(card.examiners?.length > 0 || card.subjects?.length > 0 || card.customTags?.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.examiners?.map(e => (
                <span key={e} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">
                  👤 {e}
                </span>
              ))}
              {card.subjects?.map(s => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">
                  {s}
                </span>
              ))}
              {card.customTags?.map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#6b7280]">
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => onEdit(card)}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] transition-colors"
            >
              Bearbeiten
            </button>
            <button
              onClick={() => onDelete(card.id)}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] transition-colors"
            >
              Löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SetDetail({ set, cards, links, userId, onBack, onEdit, onDelete, onStudy, showToast }: Props) {
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Kopieren');

  // Filter state
  const [srsFilter, setSrsFilter] = useState<SrsFilter>('alle');
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('alle');
  const [examinerFilter, setExaminerFilter] = useState<string>('alle');
  const [onlyDue, setOnlyDue] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const setCards = cards.filter(c => c.setId === set.id);
  const dueCount = setCards.filter(isDueToday).length;
  const flaggedCount = setCards.filter(c => c.flagged).length;
  const srsGroups = computeSrsGroups(setCards);

  // Unique examiners across all cards in this set (only show if >1 examiner exists)
  const availableExaminers = useMemo(() => {
    const s = new Set<string>();
    setCards.forEach(c => c.examiners?.forEach(e => s.add(e)));
    return Array.from(s).sort();
  }, [setCards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply filters
  const filteredCards = useMemo(() => {
    return setCards.filter(card => {
      if (srsFilter !== 'alle' && getSRSStatus(card) !== srsFilter) return false;
      if (diffFilter !== 'alle' && card.difficulty !== diffFilter) return false;
      if (examinerFilter !== 'alle' && !card.examiners?.includes(examinerFilter)) return false;
      if (onlyDue && !isDueToday(card)) return false;
      if (onlyFlagged && !card.flagged) return false;
      return true;
    });
  }, [setCards, srsFilter, diffFilter, examinerFilter, onlyDue, onlyFlagged]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive = srsFilter !== 'alle' || diffFilter !== 'alle' || examinerFilter !== 'alle' || onlyDue || onlyFlagged;

  const handleSrsLevelClick = (srs: SrsKey) => {
    const filtered = setCards.filter(c => getSRSStatus(c) === srs);
    if (filtered.length === 0) {
      showToast('Keine Karten auf diesem Level', 'info');
      return;
    }
    onStudy(filtered);
  };

  const handleExportJSON = () => {
    exportSetJSON(set, setCards);
    showToast(`${setCards.length} Karten als JSON exportiert`);
  };

  const handleExportCSV = () => {
    exportSetCSV(set, setCards);
    showToast(`${setCards.length} Karten als CSV exportiert`);
  };

  const handleShare = async () => {
    if (setCards.length === 0) {
      showToast('Set enthält keine Karten zum Teilen', 'error');
      return;
    }
    setSharing(true);
    try {
      const code = await createShareCode(set, cards, links, userId);
      setShareCode(code);
    } catch (err) {
      showToast(`Teilen fehlgeschlagen: ${(err as Error).message}`, 'error');
    } finally {
      setSharing(false);
    }
  };

  const handleCopyCode = () => {
    if (!shareCode) return;
    navigator.clipboard.writeText(shareCode);
    setCopyLabel('Kopiert!');
    setTimeout(() => setCopyLabel('Kopieren'), 2000);
  };

  const resetFilters = () => {
    setSrsFilter('alle');
    setDiffFilter('alle');
    setExaminerFilter('alle');
    setOnlyDue(false);
    setOnlyFlagged(false);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[#9ca3af] hover:text-white text-sm transition-colors mb-4"
        >
          ← Zurück zu Meine Sets
        </button>
        <div className="flex items-start gap-4 flex-wrap">
          <div
            className="w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center text-2xl"
            style={{ backgroundColor: set.color + '22', border: `2px solid ${set.color}44` }}
          >
            📂
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-white">{set.name}</h2>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: set.color }} />
            </div>
            {set.description && <p className="text-[#9ca3af] text-sm mt-0.5">{set.description}</p>}
            <div className="flex gap-2 flex-wrap mt-2">
              {set.subject && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{set.subject}</span>}
              {set.examiner && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {set.examiner}</span>}
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{setCards.length} Karte{setCards.length !== 1 ? 'n' : ''}</span>
              {dueCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">{dueCount} fällig</span>}
              {flaggedCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400">🚩 {flaggedCount} flagged</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {setCards.length > 0 && (
          <button
            onClick={() => onStudy(filtersActive ? filteredCards : setCards)}
            disabled={filteredCards.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors disabled:opacity-40"
          >
            ▶ {filtersActive
              ? `${filteredCards.length} Gefilterte lernen`
              : `Lernen (${setCards.length})`}
          </button>
        )}
        <button
          onClick={handleExportJSON}
          disabled={setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          📦 JSON
        </button>
        <button
          onClick={handleExportCSV}
          disabled={setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          📊 CSV
        </button>
        <button
          onClick={handleShare}
          disabled={sharing || setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40"
        >
          {sharing ? '⟳ Teilen…' : '🔗 Teilen'}
        </button>
      </div>

      {/* SRS Level Breakdown */}
      {setCards.length > 0 && (
        <SrsLevelGrid
          srsGroups={srsGroups}
          total={setCards.length}
          onLevelClick={handleSrsLevelClick}
          title="Lernfortschritt in diesem Set"
          hint="Klicken zum Lernen"
          percentLabel={(pct) => `${pct}% im Set`}
        />
      )}

      {/* Share code display */}
      {shareCode && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-5">
          <p className="text-sm font-semibold text-white mb-1">Geteilter Code</p>
          <p className="text-xs text-[#9ca3af] mb-3">Gib diesen Code auf der Import/Export-Seite ein um das Set zu importieren.</p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold text-indigo-300 tracking-[0.3em] select-all">{shareCode}</span>
            <button
              onClick={handleCopyCode}
              className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 text-xs font-medium transition-colors"
            >
              {copyLabel}
            </button>
          </div>
        </div>
      )}

      {/* Cards list */}
      {setCards.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🃏</p>
          <p className="text-lg font-semibold text-white">Keine Karten in diesem Set</p>
          <p className="text-[#9ca3af] text-sm mt-1">Weise Karten diesem Set zu beim Erstellen oder Bearbeiten</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Section header + filter bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
              Karten
              {filtersActive && (
                <span className="ml-2 text-indigo-400 normal-case font-normal tracking-normal">
                  — {filteredCards.length} von {setCards.length}
                </span>
              )}
            </h3>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-[#6b7280] hover:text-[#9ca3af] transition-colors"
              >
                ✕ Filter zurücksetzen
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 pb-1">
            {/* SRS status */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterChip label="Alle" active={srsFilter === 'alle'} onClick={() => setSrsFilter('alle')} />
              <FilterChip
                label="Neu"
                active={srsFilter === 'neu'}
                color="bg-purple-500/20 border-purple-500/40 text-purple-300"
                onClick={() => setSrsFilter(srsFilter === 'neu' ? 'alle' : 'neu')}
              />
              <FilterChip
                label="Lernend"
                active={srsFilter === 'lernend'}
                color="bg-blue-500/20 border-blue-500/40 text-blue-300"
                onClick={() => setSrsFilter(srsFilter === 'lernend' ? 'alle' : 'lernend')}
              />
              <FilterChip
                label="Wiederholen"
                active={srsFilter === 'wiederholen'}
                color="bg-amber-500/20 border-amber-500/40 text-amber-300"
                onClick={() => setSrsFilter(srsFilter === 'wiederholen' ? 'alle' : 'wiederholen')}
              />
              <FilterChip
                label="Beherrscht"
                active={srsFilter === 'beherrscht'}
                color="bg-green-500/20 border-green-500/40 text-green-300"
                onClick={() => setSrsFilter(srsFilter === 'beherrscht' ? 'alle' : 'beherrscht')}
              />
            </div>

            {/* Divider */}
            <div className="w-px bg-[#2d3148] self-stretch mx-0.5" />

            {/* Difficulty */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterChip
                label="Einfach"
                active={diffFilter === 'einfach'}
                color="bg-green-500/20 border-green-500/40 text-green-300"
                onClick={() => setDiffFilter(diffFilter === 'einfach' ? 'alle' : 'einfach')}
              />
              <FilterChip
                label="Mittel"
                active={diffFilter === 'mittel'}
                color="bg-amber-500/20 border-amber-500/40 text-amber-300"
                onClick={() => setDiffFilter(diffFilter === 'mittel' ? 'alle' : 'mittel')}
              />
              <FilterChip
                label="Schwer"
                active={diffFilter === 'schwer'}
                color="bg-red-500/20 border-red-500/40 text-red-300"
                onClick={() => setDiffFilter(diffFilter === 'schwer' ? 'alle' : 'schwer')}
              />
            </div>

            {/* Prüfer-Filter — nur sichtbar wenn Karten mehrere Prüfer haben */}
            {availableExaminers.length > 1 && (
              <>
                <div className="w-px bg-[#2d3148] self-stretch mx-0.5" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-[#6b7280] font-medium">👤</span>
                  {availableExaminers.map(examiner => {
                    // Kürze lange Namen: "Gerald Hollaus" → "Hollaus"
                    const short = examiner.split(' ').pop() ?? examiner;
                    return (
                      <FilterChip
                        key={examiner}
                        label={short}
                        active={examinerFilter === examiner}
                        color="bg-violet-500/20 border-violet-500/40 text-violet-300"
                        onClick={() => setExaminerFilter(examinerFilter === examiner ? 'alle' : examiner)}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {/* Divider */}
            <div className="w-px bg-[#2d3148] self-stretch mx-0.5" />

            {/* Special filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {dueCount > 0 && (
                <FilterChip
                  label={`⏰ Fällig (${dueCount})`}
                  active={onlyDue}
                  color="bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                  onClick={() => setOnlyDue(d => !d)}
                />
              )}
              {flaggedCount > 0 && (
                <FilterChip
                  label={`🚩 Flagged (${flaggedCount})`}
                  active={onlyFlagged}
                  color="bg-orange-500/20 border-orange-500/40 text-orange-300"
                  onClick={() => setOnlyFlagged(f => !f)}
                />
              )}
            </div>
          </div>

          {/* Card list */}
          {filteredCards.length === 0 ? (
            <div className="text-center py-10 bg-[#1e2130] border border-[#2d3148] rounded-xl">
              <p className="text-2xl mb-2">🔍</p>
              <p className="text-sm text-[#9ca3af]">Keine Karten entsprechen den Filtern</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredCards.map(card => (
                <CardRow
                  key={card.id}
                  card={card}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

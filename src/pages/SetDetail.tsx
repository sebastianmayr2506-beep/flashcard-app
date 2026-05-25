import { useState, useMemo, useEffect, useRef } from 'react';
import type { CardSet, Flashcard, CardLink, SRSStatus, Difficulty } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { exportSetJSON, exportSetCSV, exportShareJSON, exportJSON } from '../utils/export';
import { createShareCode } from '../utils/shareCode';
import InfoTooltip from '../components/InfoTooltip';
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

// ── Shared select style ───────────────────────────────────────────────────────
const selectCls = 'text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer';
const selectActiveCls = 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400';

// ── Expandable card row ───────────────────────────────────────────────────────
function CardRow({
  card,
  onEdit,
  onDelete,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: {
  card: Flashcard;
  onEdit: (c: Flashcard) => void;
  onDelete: (id: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = getSRSStatus(card);
  const due = isDueToday(card);

  const handleRowClick = () => {
    if (selectionMode) { onToggleSelect?.(); return; }
    setOpen(o => !o);
  };

  return (
    <div
      className={`bg-[#1e2130] border rounded-xl transition-all ${
        selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' :
        due ? 'border-indigo-500/30' : open ? 'border-[#3d4168]' : 'border-[#2d3148]'
      }`}
    >
      {/* Row header */}
      <button
        type="button"
        onClick={handleRowClick}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-[#252840]/40 transition-colors rounded-xl"
      >
        {selectionMode && (
          <div className={`shrink-0 w-5 h-5 mt-0.5 rounded-md border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-indigo-500 border-indigo-500' : 'bg-[#252840] border-[#3d4168]'
          }`}>
            {selected && <span className="text-white text-xs font-bold">✓</span>}
          </div>
        )}
        <span className={`text-[#6b7280] text-xs shrink-0 mt-0.5 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        {card.cardNumber != null && (
          <span className="font-mono text-[10px] text-[#6b7280] shrink-0 mt-1">#{card.cardNumber}</span>
        )}
        {/* Text + badges stack vertically — prevents badges from squeezing the title on mobile */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-sm text-white font-medium leading-snug">
            <MarkdownText text={card.front || '(leer)'} />
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {card.flagged && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-medium">
                🚩
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
        </div>
      </button>

      {/* Expanded body — only when not in selection mode */}
      {open && !selectionMode && (
        <div className="px-4 pb-4 border-t border-[#2d3148]">
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Vorderseite</p>
            <div className="text-sm text-white leading-relaxed">
              <MarkdownText text={card.front || '(leer)'} />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">Rückseite</p>
            <div className="text-sm text-[#d1d5db] leading-relaxed whitespace-pre-wrap">
              <MarkdownText text={card.back || '(leer)'} />
            </div>
          </div>
          {(card.examiners?.length > 0 || card.subjects?.length > 0 || card.customTags?.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.examiners?.map(e => (
                <span key={e} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {e}</span>
              ))}
              {card.subjects?.map(s => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{s}</span>
              ))}
              {card.customTags?.map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#6b7280]">#{t}</span>
              ))}
            </div>
          )}
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

// ── Main component ────────────────────────────────────────────────────────────
export default function SetDetail({ set, cards, links, userId, onBack, onEdit, onDelete, onStudy, showToast }: Props) {
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Kopieren');

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  // Filter state
  const [search, setSearch] = useState('');
  const [filterSRS, setFilterSRS] = useState<SRSStatus | ''>('');
  const [filterDiff, setFilterDiff] = useState<Difficulty | ''>('');
  const [filterExaminers, setFilterExaminers] = useState<Set<string>>(new Set());
  const [onlyDue, setOnlyDue] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [examinerOpen, setExaminerOpen] = useState(false);
  const examinerRef = useRef<HTMLDivElement>(null);

  // Close examiner dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (examinerRef.current && !examinerRef.current.contains(e.target as Node)) {
        setExaminerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const setCards = cards.filter(c => c.setIds?.includes(set.id));
  const srsGroups = computeSrsGroups(setCards);

  // Derive available filter options from actual cards in set
  const availableSRS = useMemo(() => {
    const s = new Set<SRSStatus>();
    setCards.forEach(c => s.add(getSRSStatus(c)));
    const order: SRSStatus[] = ['neu', 'lernend', 'wiederholen', 'beherrscht'];
    return order.filter(v => s.has(v));
  }, [setCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableDiff = useMemo(() => {
    const s = new Set<Difficulty>();
    setCards.forEach(c => s.add(c.difficulty));
    const order: Difficulty[] = ['einfach', 'mittel', 'schwer'];
    return order.filter(v => s.has(v));
  }, [setCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableExaminers = useMemo(() => {
    const s = new Set<string>();
    setCards.forEach(c => c.examiners?.forEach(e => s.add(e)));
    return Array.from(s).sort();
  }, [setCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueCount = setCards.filter(isDueToday).length;
  const flaggedCount = setCards.filter(c => c.flagged).length;

  // Apply filters
  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    // "#42 #87 #103" → Set von Nummern, zeigt genau diese Karten
    const numTokens = [...q.matchAll(/#(\d+)/g)].map(m => parseInt(m[1], 10));
    const cardNumMatch = numTokens.length > 0 && q.replace(/#\d+/g, '').trim() === '';
    return setCards.filter(card => {
      if (cardNumMatch) return card.cardNumber != null && numTokens.includes(card.cardNumber);
      if (q && !card.front.toLowerCase().includes(q) && !card.back.toLowerCase().includes(q)) return false;
      if (filterSRS && getSRSStatus(card) !== filterSRS) return false;
      if (filterDiff && card.difficulty !== filterDiff) return false;
      if (filterExaminers.size > 0 && !card.examiners?.some(e => filterExaminers.has(e))) return false;
      if (onlyDue && !isDueToday(card)) return false;
      if (onlyFlagged && !card.flagged) return false;
      return true;
    });
  }, [setCards, search, filterSRS, filterDiff, filterExaminers, onlyDue, onlyFlagged]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtersActive = !!search || !!filterSRS || !!filterDiff || filterExaminers.size > 0 || onlyDue || onlyFlagged;

  const resetFilters = () => {
    setSearch('');
    setFilterSRS('');
    setFilterDiff('');
    setFilterExaminers(new Set());
    setOnlyDue(false);
    setOnlyFlagged(false);
  };

  const selectedCount = selectedIds.size;
  const allFilteredSelected = filteredCards.length > 0 && filteredCards.every(c => selectedIds.has(c.id));
  const selectAll = () => setSelectedIds(new Set(filteredCards.map(c => c.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkExport = () => {
    if (selectedIds.size === 0) return;
    const toExport = setCards.filter(c => selectedIds.has(c.id));
    const filename = toExport.length === 1 && toExport[0].cardNumber != null
      ? `#${toExport[0].cardNumber}_karte.json`
      : `karten_auswahl_${selectedIds.size}.json`;
    exportJSON(toExport, filename);
    showToast(`${selectedIds.size} Karte${selectedIds.size !== 1 ? 'n' : ''} exportiert`);
  };

  const handleSrsLevelClick = (srs: SrsKey) => {
    const filtered = setCards.filter(c => getSRSStatus(c) === srs);
    if (filtered.length === 0) { showToast('Keine Karten auf diesem Level', 'info'); return; }
    onStudy(filtered);
  };

  const handleBackupJSON = () => { exportSetJSON(set, setCards); showToast(`${setCards.length} Karten als Backup exportiert`); };
  const handleShareJSON  = () => { exportShareJSON(setCards);    showToast(`${setCards.length} Karten als Share-JSON exportiert`); };
  const handleExportCSV  = () => { exportSetCSV(set, setCards);  showToast(`${setCards.length} Karten als CSV exportiert`); };

  const handleShare = async () => {
    if (setCards.length === 0) { showToast('Set enthält keine Karten zum Teilen', 'error'); return; }
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

  const srsLabels: Record<SRSStatus, string> = {
    neu: 'Neu', lernend: 'Lernend', wiederholen: 'Wiederholen', beherrscht: 'Beherrscht',
  };
  const diffLabels: Record<string, string> = {
    einfach: 'Einfach', mittel: 'Mittel', schwer: 'Schwer',
  };

  return (
    <div className="fade-in">
      {/* Sticky selection bar */}
      {selectionMode && (
        <div className="sticky top-0 z-30 bg-[#1a1d27] border-b border-[#3d4168] px-4 md:px-6 lg:px-8 py-3 shadow-lg">
          <div className="flex items-center gap-3 flex-wrap max-w-screen-xl">
            <span className="text-sm font-semibold text-white shrink-0">
              {selectedCount > 0 ? `${selectedCount} Karte${selectedCount !== 1 ? 'n' : ''} ausgewählt` : 'Karten auswählen'}
            </span>
            <button
              onClick={allFilteredSelected ? clearSelection : selectAll}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
            >
              {allFilteredSelected ? 'Alle abwählen' : `Alle ${filteredCards.length} auswählen`}
            </button>
            <button
              onClick={handleBulkExport}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-400 text-sm font-semibold transition-colors shrink-0"
            >
              📦 Exportieren
            </button>
            <button
              onClick={() => { onStudy(setCards.filter(c => selectedIds.has(c.id))); exitSelectionMode(); }}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shrink-0"
            >
              ▶ Lernen ({selectedCount})
            </button>
            <button
              onClick={exitSelectionMode}
              className="ml-auto px-3 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors shrink-0"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

    <div className="p-4 md:p-6 lg:p-8 space-y-6">
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
              {set.subject   && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{set.subject}</span>}
              {set.examiner  && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {set.examiner}</span>}
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{setCards.length} Karte{setCards.length !== 1 ? 'n' : ''}</span>
              {dueCount    > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">{dueCount} fällig</span>}
              {flaggedCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400">🚩 {flaggedCount}</span>}
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
            ▶ {filtersActive ? `${filteredCards.length} Gefilterte lernen` : `Lernen (${setCards.length})`}
          </button>
        )}
        {setCards.length > 0 && (
          <button
            onClick={() => { setSelectionMode(s => !s); clearSelection(); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              selectionMode
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                : 'bg-[#1e2130] border-[#2d3148] text-[#9ca3af] hover:text-white'
            }`}
          >
            ☑ Auswählen
          </button>
        )}
        <button onClick={handleBackupJSON} disabled={setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40">
          💾 Backup
          <InfoTooltip side="bottom" text="Vollständiger Export mit deinem persönlichen Lernfortschritt (SRS-Daten, Intervalle). Nur für dein eigenes Backup — nicht zum Weitergeben geeignet." />
        </button>
        <button onClick={handleShareJSON} disabled={setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40">
          📤 Als Datei teilen
          <InfoTooltip side="bottom" text="Export zum Weitergeben: Karteninhalte & Prüfer-Metadaten bleiben erhalten, persönlicher Lernfortschritt (SRS, Flaggen, Intervalle) wird zurückgesetzt. Empfänger starten frisch." />
        </button>
        <button onClick={handleExportCSV} disabled={setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40">
          📊 CSV
        </button>
        <button onClick={handleShare} disabled={sharing || setCards.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40">
          {sharing ? '⟳ Teilen…' : '🔗 Code teilen'}
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

      {/* Share code */}
      {shareCode && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-5">
          <p className="text-sm font-semibold text-white mb-1">Geteilter Code</p>
          <p className="text-xs text-[#9ca3af] mb-3">Gib diesen Code auf der Import/Export-Seite ein um das Set zu importieren.</p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold text-indigo-300 tracking-[0.3em] select-all">{shareCode}</span>
            <button onClick={handleCopyCode}
              className="px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 text-xs font-medium transition-colors">
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
          {/* Section header */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">
              Karten
              {filtersActive && (
                <span className="ml-2 text-indigo-400 normal-case font-normal tracking-normal">
                  — {filteredCards.length} von {setCards.length}
                </span>
              )}
            </h3>
            {filtersActive && (
              <button type="button" onClick={resetFilters}
                className="text-xs text-[#6b7280] hover:text-[#9ca3af] transition-colors">
                ✕ Filter löschen
              </button>
            )}
          </div>

          {/* Filter bar — Library-style dropdowns, only showing options present in this set */}
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-3 space-y-2">
            {/* Suchfeld */}
            <input
              type="text"
              placeholder="Suchen… oder #42 für Karte direkt"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">

              {/* SRS Status — nur Optionen die im Set vorkommen */}
              {availableSRS.length > 1 && (
                <select
                  value={filterSRS}
                  onChange={e => setFilterSRS(e.target.value as SRSStatus | '')}
                  className={`${selectCls} ${filterSRS ? selectActiveCls : ''}`}
                >
                  <option value="">Status</option>
                  {availableSRS.map(s => (
                    <option key={s} value={s}>{srsLabels[s]}</option>
                  ))}
                </select>
              )}

              {/* Schwierigkeit — nur Optionen die im Set vorkommen */}
              {availableDiff.length > 1 && (
                <select
                  value={filterDiff}
                  onChange={e => setFilterDiff(e.target.value as Difficulty | '')}
                  className={`${selectCls} ${filterDiff ? selectActiveCls : ''}`}
                >
                  <option value="">Schwierigkeit</option>
                  {availableDiff.map(d => (
                    <option key={d} value={d}>{diffLabels[d]}</option>
                  ))}
                </select>
              )}

              {/* Prüfer — Multi-Select Dropdown wie in der Bibliothek */}
              {availableExaminers.length > 1 && (
                <div ref={examinerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setExaminerOpen(o => !o)}
                    className={`flex items-center gap-1.5 ${selectCls} ${filterExaminers.size > 0 ? selectActiveCls : ''}`}
                  >
                    👤 Prüfer{filterExaminers.size > 0 ? ` (${filterExaminers.size})` : ''}
                    <span className="text-xs opacity-60 ml-1">{examinerOpen ? '▲' : '▼'}</span>
                  </button>
                  {examinerOpen && (
                    <div className="absolute top-full left-0 mt-1 z-40 bg-[#1e2130] border border-[#2d3148] rounded-xl shadow-2xl min-w-[200px] max-h-64 overflow-y-auto py-1">
                      {availableExaminers.map(ex => {
                        const checked = filterExaminers.has(ex);
                        return (
                          <label
                            key={ex}
                            onClick={() => setFilterExaminers(prev => {
                              const next = new Set(prev);
                              if (next.has(ex)) next.delete(ex); else next.add(ex);
                              return next;
                            })}
                            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#252840] transition-colors"
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              checked ? 'bg-indigo-500 border-indigo-500' : 'bg-transparent border-[#3d4168]'
                            }`}>
                              {checked && <span className="text-white text-[10px] leading-none">✓</span>}
                            </span>
                            <span className="text-sm text-white truncate">{ex}</span>
                          </label>
                        );
                      })}
                      {filterExaminers.size > 0 && (
                        <div className="border-t border-[#2d3148] mt-1 pt-1 px-3 pb-1">
                          <button
                            onClick={() => setFilterExaminers(new Set())}
                            className="text-xs text-indigo-400 hover:text-indigo-300"
                          >
                            Auswahl löschen
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Fällig toggle — nur wenn Fällige vorhanden */}
              {dueCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOnlyDue(d => !d)}
                  className={`${selectCls} ${onlyDue ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400' : ''}`}
                >
                  ⏰ Fällig ({dueCount})
                </button>
              )}

              {/* Flagged toggle — nur wenn Flagged vorhanden */}
              {flaggedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOnlyFlagged(f => !f)}
                  className={`${selectCls} ${onlyFlagged ? 'bg-orange-500/15 border-orange-500/40 text-orange-400' : ''}`}
                >
                  🚩 Flagged ({flaggedCount})
                </button>
              )}

            </div>
          </div>

          {/* Card list */}
          {filteredCards.length === 0 ? (
            <div className="text-center py-10 bg-[#1e2130] border border-[#2d3148] rounded-xl">
              <p className="text-2xl mb-2">🔍</p>
              <p className="text-sm text-[#9ca3af]">Keine Karten entsprechen den Filtern</p>
              <button type="button" onClick={resetFilters}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
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
                  selectionMode={selectionMode}
                  selected={selectedIds.has(card.id)}
                  onToggleSelect={() => toggleSelection(card.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

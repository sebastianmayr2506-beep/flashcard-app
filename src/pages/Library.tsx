import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Flashcard, AppSettings, Difficulty, SRSStatus, CardSet, CardLink, FlagAttempt } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import SRSBadge from '../components/SRSBadge';
import MarkdownText from '../components/MarkdownText';
import ProbabilityBadge from '../components/ProbabilityBadge';
import { exportJSON } from '../utils/export';
import DuplicateFinderModal from '../components/DuplicateFinderModal';
import CardChatDrawer from '../components/CardChatDrawer';
import { PriorityBadge } from '../components/PriorityPicker';
import { useChatExistsSet } from '../hooks/useCardChat';

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  sets: CardSet[];
  links: CardLink[];
  flagAttempts: FlagAttempt[];
  userId: string | null;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onStudyFiltered: (cards: Flashcard[]) => void;
  onBulkAssignSet: (cardIds: string[], setId: string | undefined) => void;
  onBulkCreateAndAssignSet: (cardIds: string[], setName: string) => void;
  onBulkDelete: (cardIds: string[]) => void;
  onBulkSetBlacklist: (cardIds: string[], blacklisted: boolean) => void;
  onUpdateCard: (id: string, patch: Partial<Flashcard>) => void;
  onMergeCards: (cardIds: string[]) => void;
  onGenerateMC: (cardIds: string[]) => Promise<{ okIds: string[]; failedIds: string[] }>;
  onNavigate: (page: string) => void;
  initialSrsFilter?: string;
}

type ViewMode = 'grid' | 'list';

export default function Library({ cards, settings, sets, links, flagAttempts, userId, onEdit, onDelete, onStudyFiltered, onBulkAssignSet, onBulkCreateAndAssignSet, onBulkDelete, onBulkSetBlacklist, onUpdateCard, onMergeCards, onGenerateMC, onNavigate, initialSrsFilter }: Props) {
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminers, setFilterExaminers] = useState<Set<string>>(new Set());
  const [examinerDropdownOpen, setExaminerDropdownOpen] = useState(false);
  const examinerDropdownRef = useRef<HTMLDivElement>(null);

  // Close examiner dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (examinerDropdownRef.current && !examinerDropdownRef.current.contains(e.target as Node)) {
        setExaminerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');
  const [filterPriority, setFilterPriority] = useState<'' | 'A' | 'B' | 'C' | 'none'>('');
  const [filterMC, setFilterMC] = useState<'' | 'yes' | 'no'>('');
  // 'show' = default, show all incl. blacklisted with badge
  // 'only' = only blacklisted cards (for managing them)
  // 'hide' = hide blacklisted entirely (sometimes useful for clean browsing)
  const [filterBlacklist, setFilterBlacklist] = useState<'show' | 'only' | 'hide'>('show');
  // SRS-Status filter has no longer a manual UI control (cleanup pass to
  // declutter the filter bar). It's still wired up so the Dashboard SRS-grid
  // can deep-link into Library with a pre-filter applied, with the banner
  // explaining the active filter + a clear-button on it.
  const [filterSRS, setFilterSRS] = useState<SRSStatus | ''>(initialSrsFilter as SRSStatus | '' ?? '');
  const [showSrsFilterBanner, setShowSrsFilterBanner] = useState(!!initialSrsFilter);
  const [filterSet, setFilterSet] = useState('');
  const [filterCatalog, setFilterCatalog] = useState('');
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'probability'>('default');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  // Specialist filters (Schwierigkeit, MC-Status, Katalogjahr) are hidden
  // behind a "+ Mehr Filter"-Toggle to keep the main bar slim.
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDuplicateFinder, setShowDuplicateFinder] = useState(false);
  const [bulkSetId, setBulkSetId] = useState('');
  const [showNewSetInput, setShowNewSetInput] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // Preview
  const [previewCard, setPreviewCard] = useState<Flashcard | null>(null);
  // Which cards have a saved AI chat — for the 💬-badge in preview
  const chatCardIds = useChatExistsSet(userId);

  // Examiners available given current catalog filter (or all if no catalog selected)
  const activeExaminers = useMemo(() => {
    const s = new Set<string>();
    cards
      .filter(c => !filterCatalog || c.askedInCatalogs?.some(v => v.includes(filterCatalog)))
      .forEach(c => c.examiners?.forEach(e => s.add(e)));
    return Array.from(s).sort();
  }, [cards, filterCatalog]);

  // Catalogs available given current examiner filter (or all if no examiners selected)
  const activeCatalogs = useMemo(() => {
    const s = new Set<string>();
    cards
      .filter(c => filterExaminers.size === 0 || c.examiners?.some(e => filterExaminers.has(e)))
      .forEach(c => c.askedInCatalogs?.forEach(v => {
        const m = v.match(/\b(\d{4})\b/);
        if (m) s.add(m[1]);
      }));
    return Array.from(s).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }, [cards, filterExaminers]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = cards.filter(c => {
      if (q && !c.front.toLowerCase().includes(q)) return false;
      if (filterSubject && !c.subjects?.includes(filterSubject)) return false;
      if (filterExaminers.size > 0 && !c.examiners?.some(e => filterExaminers.has(e))) return false;
      if (filterDifficulty && c.difficulty !== filterDifficulty) return false;
      if (filterPriority) {
        // 'A'|'B'|'C' = match exactly; 'none' = match cards without any priority
        if (filterPriority === 'none' ? !!c.priority : c.priority !== filterPriority) return false;
      }
      if (filterMC === 'yes' && (!c.mcQuestions || c.mcQuestions.length === 0)) return false;
      if (filterMC === 'no'  && c.mcQuestions && c.mcQuestions.length > 0)      return false;
      if (filterBlacklist === 'hide' && c.blacklisted) return false;
      if (filterBlacklist === 'only' && !c.blacklisted) return false;
      if (filterSRS && getSRSStatus(c) !== filterSRS) return false;
      if (filterSet && c.setId !== filterSet) return false;
      if (filterCatalog && !c.askedInCatalogs?.some(v => v.includes(filterCatalog))) return false;
      if (filterFlagged && !c.flagged) return false;
      return true;
    });
    if (sortBy === 'probability') {
      result.sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    }
    return result;
  }, [cards, search, filterSubject, filterExaminers, filterDifficulty, filterPriority, filterMC, filterBlacklist, filterSRS, filterSet, filterCatalog, filterFlagged, sortBy]);

  const hasFilters = search || filterSubject || filterExaminers.size > 0 || filterDifficulty || filterPriority || filterMC || filterBlacklist !== 'show' || filterSRS || filterSet || filterCatalog || filterFlagged || sortBy !== 'default';

  const clearFilters = () => {
    setSearch(''); setFilterSubject(''); setFilterExaminers(new Set());
    setFilterDifficulty(''); setFilterPriority(''); setFilterMC('');
    setFilterBlacklist('show');
    setFilterSRS(''); setFilterSet(''); setFilterCatalog('');
    setFilterFlagged(false); setSortBy('default');
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filtered.map(c => c.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkSetId('');
    setShowNewSetInput(false);
    setNewSetName('');
  };

  const handleCreateAndAssign = () => {
    const name = newSetName.trim();
    if (!name || selectedIds.size === 0) return;
    onBulkCreateAndAssignSet(Array.from(selectedIds), name);
    exitSelectionMode();
  };

  const handleBulkAssign = () => {
    if (selectedIds.size === 0) return;
    onBulkAssignSet(Array.from(selectedIds), bulkSetId || undefined);
    exitSelectionMode();
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`${selectedIds.size} Karte${selectedIds.size !== 1 ? 'n' : ''} wirklich löschen?`)) return;
    onBulkDelete(Array.from(selectedIds));
    exitSelectionMode();
  };

  const handleBulkExport = () => {
    if (selectedIds.size === 0) return;
    const toExport = cards.filter(c => selectedIds.has(c.id));
    exportJSON(toExport, `karten_auswahl_${selectedIds.size}.json`);
  };

  const selectedCount = selectedIds.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));

  // If every selected card is already parked, the bulk button unparks instead.
  const allSelectedBlacklisted = selectedCount > 0 && cards.every(c => !selectedIds.has(c.id) || c.blacklisted);

  const handleBulkParken = () => {
    if (selectedCount === 0) return;
    onBulkSetBlacklist(Array.from(selectedIds), !allSelectedBlacklisted);
    exitSelectionMode();
  };

  return (
    <div className="fade-in">
      {/* Sticky bulk-action bar — always visible at top when selection mode is active */}
      {selectionMode && (
        <div className="sticky top-0 z-30 bg-[#1a1d27] border-b border-[#3d4168] px-4 md:px-6 lg:px-8 py-3 shadow-lg">
          <div className="flex items-center gap-3 flex-wrap max-w-screen-xl">
            <span className="text-sm font-semibold text-white shrink-0">
              {selectedCount > 0 ? `${selectedCount} Karte${selectedCount !== 1 ? 'n' : ''} ausgewählt` : 'Karten auswählen'}
            </span>
            {showNewSetInput ? (
              <>
                <input
                  autoFocus
                  type="text"
                  value={newSetName}
                  onChange={e => setNewSetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAssign(); if (e.key === 'Escape') setShowNewSetInput(false); }}
                  placeholder="Set-Name…"
                  className="flex-1 min-w-[120px] text-sm bg-[#252840] border border-indigo-500 rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:outline-none"
                />
                <button
                  onClick={handleCreateAndAssign}
                  disabled={!newSetName.trim() || selectedCount === 0}
                  className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shrink-0"
                >
                  Erstellen & Zuweisen
                </button>
                <button
                  onClick={() => setShowNewSetInput(false)}
                  className="px-3 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] text-sm transition-colors shrink-0"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                {sets.length > 0 && (
                  <>
                    <select
                      value={bulkSetId}
                      onChange={e => setBulkSetId(e.target.value)}
                      className="flex-1 min-w-[120px] text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">Kein Set</option>
                      {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button
                      onClick={handleBulkAssign}
                      disabled={selectedCount === 0}
                      className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shrink-0"
                    >
                      Zuweisen
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowNewSetInput(true)}
                  disabled={selectedCount === 0}
                  className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-400 text-sm font-semibold transition-colors shrink-0"
                >
                  + Neues Set
                </button>
              </>
            )}
            <button
              onClick={handleBulkExport}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-400 text-sm font-semibold transition-colors shrink-0"
            >
              📦 Exportieren
            </button>
            {selectedCount >= 2 && (
              <button
                onClick={() => onMergeCards(Array.from(selectedIds))}
                className="px-4 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-300 text-sm font-semibold transition-colors shrink-0"
              >
                🤖 Zusammenführen
              </button>
            )}
            <button
              onClick={() => onGenerateMC(Array.from(selectedIds))}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-indigo-300 text-sm font-semibold transition-colors shrink-0"
              title="MC-Fragen via KI für die ausgewählten Karten generieren und auf den Karten speichern"
            >
              🎯 MC generieren
            </button>
            <button
              onClick={handleBulkParken}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-amber-300 text-sm font-semibold transition-colors shrink-0"
              title={allSelectedBlacklisted
                ? 'Karten wieder zum Lernen aktivieren'
                : 'Karten vom Lernen ausschließen (bleiben in Bibliothek)'}
            >
              {allSelectedBlacklisted ? '✓ Aktivieren' : '🚫 Auf Blacklist'}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 text-sm font-semibold transition-colors shrink-0"
            >
              🗑 Löschen
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

      <div className="p-4 md:p-6 lg:p-8 space-y-5">

      {/* SRS filter banner — shown when navigated from Dashboard SRS grid */}
      {showSrsFilterBanner && filterSRS && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-indigo-300 text-sm">
            <span className="font-semibold">Gefiltert nach SRS-Status:</span>{' '}
            {{ neu: 'Neu 🆕', lernend: 'Lernend 📘', wiederholen: 'Wiederholen 🔄', beherrscht: 'Beherrscht ✅' }[filterSRS] ?? filterSRS}
            {' '}— {filtered.length} von {cards.length} Karten sichtbar
          </p>
          <button
            onClick={() => { clearFilters(); setShowSrsFilterBanner(false); }}
            className="text-indigo-400 hover:text-indigo-200 font-semibold text-sm shrink-0 transition-colors"
          >
            ✕ Filter löschen
          </button>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Kartei-Bibliothek</h2>
          <p className="text-[#9ca3af] text-sm mt-0.5">{filtered.length} von {cards.length} Karten</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDuplicateFinder(true)}
            className="text-sm font-medium px-3 py-2 rounded-xl border bg-[#1e2130] border-[#2d3148] text-[#9ca3af] hover:text-amber-400 hover:border-amber-500/30 transition-colors"
            title="Karten mit ähnlichen Fragen gruppiert anzeigen — manueller Merge"
          >
            🔍 Dubletten
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className="p-2 rounded-lg bg-[#1e2130] border border-[#2d3148] text-[#9ca3af] hover:text-white transition-colors"
            title={viewMode === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
          >
            {viewMode === 'grid' ? '☰' : '⊞'}
          </button>
          <button
            onClick={() => { setSelectionMode(!selectionMode); clearSelection(); }}
            className={`text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
              selectionMode
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                : 'bg-[#1e2130] border-[#2d3148] text-[#9ca3af] hover:text-white'
            }`}
          >
            ☑ Auswählen
          </button>
          <button
            onClick={() => onNavigate('new-card')}
            className="bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            + Neue Karte
          </button>
        </div>
      </div>

      {/* Filter bar
          Mobile: 2-column grid so the various widths line up cleanly.
          Desktop (≥sm): flex-wrap with natural widths — keeps the dense look. */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <input
            type="text"
            placeholder="Suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="col-span-2 sm:col-span-1 sm:flex-1 sm:min-w-[160px] text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
          />
          <Select value={filterSubject} onChange={setFilterSubject} placeholder="Fach" options={settings.subjects} />
          {/* Multi-select examiner dropdown */}
          {activeExaminers.length > 0 && (
            <div ref={examinerDropdownRef} className="relative w-full sm:w-auto">
              <button
                onClick={() => setExaminerDropdownOpen(o => !o)}
                className={`w-full sm:w-auto flex items-center justify-between gap-1.5 text-sm px-3 py-2 rounded-xl border transition-colors whitespace-nowrap ${
                  filterExaminers.size > 0
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                    : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
                }`}
              >
                Prüfer{filterExaminers.size > 0 ? ` (${filterExaminers.size})` : ''}
                <span className="text-xs opacity-60">{examinerDropdownOpen ? '▲' : '▼'}</span>
              </button>
              {examinerDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-40 bg-[#1e2130] border border-[#2d3148] rounded-xl shadow-2xl min-w-[200px] max-h-64 overflow-y-auto py-1">
                  {activeExaminers.map(ex => {
                    const checked = filterExaminers.has(ex);
                    return (
                      <label
                        key={ex}
                        onClick={() => {
                          setFilterExaminers(prev => {
                            const next = new Set(prev);
                            if (next.has(ex)) next.delete(ex); else next.add(ex);
                            return next;
                          });
                          // If a catalog year is active but the toggled examiner didn't
                          // examine in that year, clear the catalog filter
                          if (filterCatalog) {
                            const examinerInCatalog = cards.some(c =>
                              c.examiners?.includes(ex) &&
                              c.askedInCatalogs?.some(v => v.includes(filterCatalog))
                            );
                            if (!examinerInCatalog) setFilterCatalog('');
                          }
                        }}
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
          {/* Priority filter — manual select instead of Select component so we
              can show "Ohne Priorität" as a sentinel option. */}
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value as '' | 'A' | 'B' | 'C' | 'none')}
            className="w-full sm:w-auto text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
            title="Filter nach A/B/C-Priorität"
          >
            <option value="">Priorität</option>
            <option value="A">🅰️ A · Muss können</option>
            <option value="B">🅱️ B · Sollte kennen</option>
            <option value="C">🅲 C · Nice to know</option>
            <option value="none">— Ohne Priorität</option>
          </select>
          <select
            value={filterBlacklist}
            onChange={e => setFilterBlacklist(e.target.value as 'show' | 'only' | 'hide')}
            className={`w-full sm:w-auto text-sm rounded-xl px-3 py-2 focus:outline-none appearance-none cursor-pointer border ${
              filterBlacklist !== 'show'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-[#252840] border-[#2d3148] text-white focus:border-indigo-500'
            }`}
            title="Blacklist (vom Lernen ausgeschlossen)"
          >
            <option value="show">Blacklist: alle</option>
            <option value="only">🚫 Nur Blacklist</option>
            <option value="hide">Blacklist ausblenden</option>
          </select>
          {sets.length > 0 && (
            <select
              value={filterSet}
              onChange={e => setFilterSet(e.target.value)}
              className="w-full sm:w-auto text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
            >
              <option value="">Set</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setFilterFlagged(!filterFlagged)}
            className={`w-full sm:w-auto px-3 py-2 rounded-xl text-sm border transition-colors ${filterFlagged
              ? 'bg-red-500/15 border-red-500/40 text-red-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            🚩 Geflaggt
          </button>
          <button
            onClick={() => setSortBy(sortBy === 'probability' ? 'default' : 'probability')}
            className={`w-full sm:w-auto px-3 py-2 rounded-xl text-sm border transition-colors ${sortBy === 'probability'
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            📊 Nach Wahrscheinlichkeit
          </button>
          <button
            onClick={() => setShowMoreFilters(v => !v)}
            className={`w-full sm:w-auto px-3 py-2 rounded-xl text-sm border transition-colors ${
              filterDifficulty || filterMC || filterCatalog
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'
            }`}
            title="Schwierigkeit · MC-Status · Katalogjahr"
          >
            + Mehr Filter{(filterDifficulty || filterMC || filterCatalog) ? ' •' : ''}
          </button>
        </div>

        {/* Mehr Filter — collapsible specialist row */}
        {showMoreFilters && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap pt-3 border-t border-[#2d3148]">
            <Select value={filterDifficulty} onChange={v => setFilterDifficulty(v as Difficulty | '')} placeholder="Schwierigkeit" options={['einfach','mittel','schwer']} />
            <select
              value={filterMC}
              onChange={e => setFilterMC(e.target.value as '' | 'yes' | 'no')}
              className="w-full sm:w-auto text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
              title="Filter nach MC-Verfügbarkeit"
            >
              <option value="">MC-Status</option>
              <option value="yes">✓ Mit MC</option>
              <option value="no">✗ Ohne MC</option>
            </select>
            {activeCatalogs.length > 0 && (
              <Select
                value={filterCatalog}
                onChange={year => {
                  setFilterCatalog(year);
                  if (year && filterExaminers.size > 0) {
                    const validExaminers = new Set(
                      cards
                        .filter(c => c.askedInCatalogs?.some(v => v.includes(year)))
                        .flatMap(c => c.examiners ?? [])
                    );
                    setFilterExaminers(prev => {
                      const next = new Set([...prev].filter(e => validExaminers.has(e)));
                      return next.size !== prev.size ? next : prev;
                    });
                  }
                }}
                placeholder="Katalogjahr"
                options={activeCatalogs}
              />
            )}
          </div>
        )}
        {hasFilters && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9ca3af]">{filtered.length} Treffer</span>
            <button onClick={clearFilters} className="text-xs text-indigo-400 hover:text-indigo-300">Filter zurücksetzen</button>
          </div>
        )}
      </div>

      {/* Action row: study button OR select-all hint */}
      {filtered.length > 0 && !selectionMode && (
        <div className="flex justify-end">
          <button
            onClick={() => onStudyFiltered(filtered)}
            className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2"
          >
            ▶ Diese Auswahl lernen ({filtered.length})
          </button>
        </div>
      )}
      {selectionMode && filtered.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={allFilteredSelected ? clearSelection : selectAll}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {allFilteredSelected ? 'Alle abwählen' : `Alle ${filtered.length} auswählen`}
          </button>
          {selectedCount > 0 && (
            <span className="text-xs text-[#9ca3af]">{selectedCount} ausgewählt</span>
          )}
          {selectedCount > 0 && (
            <button
              onClick={handleBulkDelete}
              className="ml-auto text-sm font-semibold px-4 py-1.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 transition-colors"
            >
              🗑 {selectedCount} Karte{selectedCount !== 1 ? 'n' : ''} löschen
            </button>
          )}
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">{hasFilters ? '🔍' : '🃏'}</p>
          <p className="text-lg font-semibold text-white">
            {hasFilters ? 'Keine Karten für diesen Filter' : 'Keine Karten vorhanden'}
          </p>
          <p className="text-[#9ca3af] text-sm mt-1">
            {hasFilters
              ? `${cards.length} Karte${cards.length !== 1 ? 'n' : ''} insgesamt – der aktive Filter zeigt keine Ergebnisse`
              : 'Erstelle deine erste Karteikarte'}
          </p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-4 bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              ✕ Alle Filter löschen ({cards.length} Karten anzeigen)
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(card => (
            <CardGridItem
              key={card.id} card={card} sets={sets} links={links}
              flagAttempts={flagAttempts} autoUnflagEnabled={settings.autoUnflagEnabled}
              selectionMode={selectionMode}
              selected={selectedIds.has(card.id)}
              onToggleSelect={() => toggleSelection(card.id)}
              onEdit={onEdit} onDelete={onDelete}
              onPreview={setPreviewCard}
              onToggleBlacklist={(c) => onUpdateCard(c.id, { blacklisted: !c.blacklisted })}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(card => (
            <CardListItem
              key={card.id} card={card} sets={sets} links={links}
              flagAttempts={flagAttempts} autoUnflagEnabled={settings.autoUnflagEnabled}
              selectionMode={selectionMode}
              selected={selectedIds.has(card.id)}
              onToggleSelect={() => toggleSelection(card.id)}
              onEdit={onEdit} onDelete={onDelete}
              onPreview={setPreviewCard}
              onToggleBlacklist={(c) => onUpdateCard(c.id, { blacklisted: !c.blacklisted })}
            />
          ))}
        </div>
      )}

      {previewCard && createPortal(
        <CardPreviewModal
          card={previewCard}
          onClose={() => setPreviewCard(null)}
          onEdit={onEdit}
          userId={userId}
          hasChat={chatCardIds.has(previewCard.id)}
          onUpdateCard={onUpdateCard}
          onGenerateMC={onGenerateMC}
          apiKeys={{
            gemini: settings.geminiApiKey,
            anthropic: settings.anthropicApiKey,
            groq: settings.groqApiKey,
          }}
        />,
        document.body
      )}

      {showDuplicateFinder && createPortal(
        <DuplicateFinderModal
          cards={cards}
          onMergeCards={onMergeCards}
          onClose={() => setShowDuplicateFinder(false)}
        />,
        document.body
      )}
      </div>
    </div>
  );
}

function Select({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      // w-full on mobile (grid cell), auto on desktop (flex-wrap natural width)
      className="w-full sm:w-auto text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SetDot({ setId, sets }: { setId?: string; sets: CardSet[] }) {
  if (!setId) return null;
  const set = sets.find(s => s.id === setId);
  if (!set) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{ backgroundColor: set.color + '22', borderColor: set.color + '55', color: set.color }}
    >
      📂 {set.name}
    </span>
  );
}

interface CardItemProps {
  card: Flashcard;
  sets: CardSet[];
  links: CardLink[];
  flagAttempts: FlagAttempt[];
  autoUnflagEnabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (c: Flashcard) => void;
  onDelete: (id: string) => void;
  onPreview: (c: Flashcard) => void;
  onToggleBlacklist: (c: Flashcard) => void;
}

function flagTooltip(cardId: string, flagAttempts: FlagAttempt[], autoUnflagEnabled: boolean): string {
  if (!autoUnflagEnabled) return '🚩 Manuell geflaggt';
  const days = new Set(
    flagAttempts.filter(a => a.cardId === cardId && a.answeredCorrectly).map(a => a.attemptedAt)
  ).size;
  if (days === 0) return '🚩 Noch 2 Tage mit richtiger Antwort im Prüfungsmodus nötig';
  if (days === 1) return '🚩 Noch 1 weiterer Tag mit richtiger Antwort im Prüfungsmodus nötig';
  return '🚩 Flagge wird bald automatisch entfernt';
}

function CardGridItem({ card, sets, links, flagAttempts, autoUnflagEnabled, selectionMode, selected, onToggleSelect, onEdit, onDelete, onPreview, onToggleBlacklist }: CardItemProps) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);
  const linkCount = links.filter(l => l.cardId === card.id || l.linkedCardId === card.id).length;
  // Inline 2-Klick-Confirm: erster Klick zeigt "Sicher?" + Ja/Nein. Vermeidet
  // versehentliches Löschen ohne den Workflow durch ein Modal zu unterbrechen.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Auto-reset nach 3 Sekunden falls User nicht entscheidet — sonst hängt der
  // "Sicher?"-State unsichtbar weiter.
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const imgSrc = card.frontImage
    ? (card.frontImage.type === 'base64' ? `data:${card.frontImage.mimeType ?? 'image/png'};base64,${card.frontImage.data}` : card.frontImage.data)
    : null;

  const handleClick = () => { if (selectionMode) onToggleSelect(); else onPreview(card); };

  return (
    <div
      onClick={handleClick}
      className={`bg-[#1e2130] border rounded-2xl p-4 flex flex-col gap-3 transition-all duration-200 group relative
        ${selectionMode ? 'cursor-pointer' : ''}
        ${card.blacklisted ? 'opacity-60' : ''}
        ${selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : card.blacklisted ? 'border-amber-500/30 hover:border-amber-500/50' : due ? 'border-indigo-500/30 hover:border-indigo-500/40' : 'border-[#2d3148] hover:border-indigo-500/40'}`}
    >
      {selectionMode && (
        <div className={`absolute top-3 right-3 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
          ${selected ? 'bg-indigo-500 border-indigo-500' : 'bg-[#252840] border-[#3d4168]'}`}
        >
          {selected && <span className="text-white text-xs font-bold">✓</span>}
        </div>
      )}
      {imgSrc && <img src={imgSrc} alt="" className="w-full h-28 object-cover rounded-xl" />}
      <div className="flex-1">
        <p className="text-sm text-white font-medium line-clamp-3 leading-snug">
          <MarkdownText text={card.front || '(leer)'} />
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {card.subjects?.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{s}</span>)}
        {card.examiners?.map(e => <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {e}</span>)}
        <DifficultyBadge difficulty={card.difficulty} />
        <PriorityBadge value={card.priority} />
        {card.mcQuestions && card.mcQuestions.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 font-semibold" title={`${card.mcQuestions.length} MC-Fragen verfügbar`}>
            🎯 {card.mcQuestions.length}
          </span>
        )}
        {card.blacklisted && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold" title="Auf Blacklist — vom Lernen ausgeschlossen">
            🚫 Blacklist
          </span>
        )}
        <SRSBadge status={status} />
        {card.flagged && <span title={flagTooltip(card.id, flagAttempts, autoUnflagEnabled)} className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 cursor-help">🚩</span>}
        {linkCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">🔗 {linkCount}</span>}
        <SetDot setId={card.setId} sets={sets} />
      </div>
      {card.probabilityPercent != null && card.probabilityPercent > 0 && (
        <ProbabilityBadge pct={card.probabilityPercent} size="xs" />
      )}
      {card.customTags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {card.customTags.slice(0,3).map(t => (
            <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-[#252840] text-[#9ca3af]">#{t}</span>
          ))}
          {card.customTags.length > 3 && <span className="text-xs text-[#6b7280]">+{card.customTags.length - 3}</span>}
        </div>
      )}
      {!selectionMode && (
        // Slim action row: Bearbeiten · Blacklist · Löschen. Preview is via
        // clicking the card itself; Split and single-card Export removed —
        // both rarely used, available via selection-mode bulk actions if
        // needed. Slimmer card → less visual clutter in the library grid.
        <div className="flex gap-2">
          <button
            onClick={e => { e.stopPropagation(); onEdit(card); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] hover:border-indigo-500/30 transition-colors"
          >
            Bearbeiten
          </button>
          <button
            onClick={e => { e.stopPropagation(); onToggleBlacklist(card); }}
            className={`text-xs py-1.5 px-2 rounded-lg border transition-colors ${
              card.blacklisted
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                : 'bg-[#252840] hover:bg-amber-500/20 text-[#9ca3af] hover:text-amber-300 border-[#2d3148] hover:border-amber-500/30'
            }`}
            title={card.blacklisted ? "Von Blacklist entfernen" : "Auf Blacklist setzen (vom Lernen ausschließen)"}
          >
            {card.blacklisted ? '✓' : '🚫'}
          </button>
          {confirmDelete ? (
            <div className="flex-1 flex gap-1">
              <button
                onClick={e => { e.stopPropagation(); onDelete(card.id); setConfirmDelete(false); }}
                className="flex-1 text-xs py-1.5 rounded-lg bg-red-500/25 hover:bg-red-500/40 border border-red-500/50 text-red-300 font-semibold transition-colors"
              >
                Sicher? Ja
              </button>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] transition-colors"
              >
                Nein
              </button>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
              className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] hover:border-red-500/30 transition-colors"
            >
              Löschen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CardListItem({ card, sets, links, flagAttempts, autoUnflagEnabled, selectionMode, selected, onToggleSelect, onEdit, onDelete, onPreview, onToggleBlacklist }: CardItemProps) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);
  const linkCount = links.filter(l => l.cardId === card.id || l.linkedCardId === card.id).length;
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  return (
    <div
      onClick={() => { if (selectionMode) onToggleSelect(); else onPreview(card); }}
      className={`bg-[#1e2130] border rounded-xl px-4 py-3 flex items-center gap-3 transition-all group cursor-pointer
        ${selectionMode ? 'cursor-pointer' : ''}
        ${card.blacklisted ? 'opacity-60' : ''}
        ${selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : card.blacklisted ? 'border-amber-500/30 hover:border-amber-500/50' : due ? 'border-indigo-500/30 hover:border-indigo-500/40' : 'border-[#2d3148] hover:border-indigo-500/40'}`}
    >
      {selectionMode && (
        <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
          ${selected ? 'bg-indigo-500 border-indigo-500' : 'bg-[#252840] border-[#3d4168]'}`}
        >
          {selected && <span className="text-white text-xs font-bold">✓</span>}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium truncate">
          <MarkdownText text={card.front || '(leer)'} />
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        {card.subjects?.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">{s}</span>)}
        {card.examiners?.map(e => <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">👤 {e}</span>)}
        <DifficultyBadge difficulty={card.difficulty} />
        <PriorityBadge value={card.priority} />
        {card.mcQuestions && card.mcQuestions.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 font-semibold" title={`${card.mcQuestions.length} MC-Fragen verfügbar`}>
            🎯 {card.mcQuestions.length}
          </span>
        )}
        {card.blacklisted && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold" title="Auf Blacklist — vom Lernen ausgeschlossen">
            🚫 Blacklist
          </span>
        )}
        <SRSBadge status={status} />
        {card.flagged && <span title={flagTooltip(card.id, flagAttempts, autoUnflagEnabled)} className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 cursor-help">🚩</span>}
        {linkCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">🔗 {linkCount}</span>}
        {card.probabilityPercent != null && card.probabilityPercent > 0 && (
          <ProbabilityBadge pct={card.probabilityPercent} size="xs" />
        )}
        <SetDot setId={card.setId} sets={sets} />
      </div>
      {!selectionMode && (
        // Slim action row (List-View): Bearbeiten · Blacklist · Löschen.
        <div className="flex gap-1.5 shrink-0">
          <button onClick={e => { e.stopPropagation(); onEdit(card); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] transition-colors">Bearbeiten</button>
          <button
            onClick={e => { e.stopPropagation(); onToggleBlacklist(card); }}
            className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
              card.blacklisted
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                : 'bg-[#252840] hover:bg-amber-500/20 text-[#9ca3af] hover:text-amber-300 border-[#2d3148]'
            }`}
            title={card.blacklisted ? "Von Blacklist entfernen" : "Auf Blacklist setzen (vom Lernen ausschließen)"}
          >
            {card.blacklisted ? '✓' : '🚫'}
          </button>
          {confirmDelete ? (
            <>
              <button onClick={e => { e.stopPropagation(); onDelete(card.id); setConfirmDelete(false); }} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/25 hover:bg-red-500/40 border border-red-500/50 text-red-300 font-semibold transition-colors">Sicher? Ja</button>
              <button onClick={e => { e.stopPropagation(); setConfirmDelete(false); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] transition-colors">Nein</button>
            </>
          ) : (
            <button onClick={e => { e.stopPropagation(); setConfirmDelete(true); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] transition-colors">Löschen</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Card Preview Modal ───────────────────────────────────────

function CardPreviewModal({
  card,
  onClose,
  onEdit,
  userId,
  hasChat,
  onUpdateCard,
  onGenerateMC,
  apiKeys,
}: {
  card: Flashcard;
  onClose: () => void;
  onEdit: (c: Flashcard) => void;
  userId: string | null;
  hasChat: boolean;
  onUpdateCard: (id: string, patch: Partial<Flashcard>) => void;
  onGenerateMC: (cardIds: string[]) => Promise<{ okIds: string[]; failedIds: string[] }>;
  apiKeys: { gemini?: string; anthropic?: string; groq?: string };
}) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    setIsFlipped(false);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' || e.key === 'Enter') setIsFlipped(f => !f);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [card, onClose]);

  const imgSrc = (img: Flashcard['frontImage']) =>
    img ? (img.type === 'base64' ? `data:${img.mimeType ?? 'image/png'};base64,${img.data}` : img.data) : null;
  const frontImg = imgSrc(card.frontImage);
  const backImg  = imgSrc(card.backImage);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#9ca3af] uppercase tracking-widest">Vorschau</span>
          <div className="flex items-center gap-2">
            {/* Chat-Button erscheint nur wenn die Karte umgedreht ist — der User
                hat dann die Antwort gesehen und kann gezielt nachfragen. */}
            {isFlipped && (
              <button
                onClick={() => setChatOpen(true)}
                title="KI fragen"
                className="text-sm px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 text-purple-300 transition-colors"
              >
                💬 {hasChat ? 'Chat fortsetzen' : 'KI fragen'}
              </button>
            )}
            <button
              onClick={() => { onClose(); onEdit(card); }}
              className="text-sm px-3 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 transition-colors"
            >
              Bearbeiten
            </button>
            <button onClick={onClose} className="text-[#9ca3af] hover:text-white text-2xl leading-none transition-colors">✕</button>
          </div>
        </div>

        {/* Card */}
        <div className="perspective" style={{ height: '320px' }}>
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
                {frontImg && <img src={frontImg} alt="" className="max-h-32 max-w-full object-contain rounded-xl" />}
                <p className="text-lg font-medium text-white leading-relaxed w-full">
                  <MarkdownText text={card.front || '(leer)'} />
                </p>
              </div>
              {!isFlipped && (
                <div className="shrink-0 pb-4 text-center">
                  <p className="text-xs text-[#6b7280] animate-pulse">Klicken oder Leertaste zum Umdrehen</p>
                </div>
              )}
            </div>
            {/* Back */}
            <div
              className="card-face card-back-face bg-[#1e2130] border border-indigo-500/40 rounded-3xl flex flex-col select-none"
              style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <div className="shrink-0 pt-5 pb-2 text-center">
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-widest">Antwort</span>
              </div>
              <div className="flex-1 overflow-y-auto px-8 pb-6 flex flex-col items-start gap-3">
                {backImg && <img src={backImg} alt="" className="max-h-32 max-w-full object-contain rounded-xl" />}
                <p className="text-base text-[#e8eaf0] leading-relaxed w-full">
                  <MarkdownText text={card.back || '(leer)'} />
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-1.5 justify-center">
          {card.subjects?.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#1e2130] border border-[#2d3148] text-[#9ca3af]">{s}</span>)}
          {card.examiners?.map(e => <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-[#1e2130] border border-[#2d3148] text-[#9ca3af]">👤 {e}</span>)}
          <DifficultyBadge difficulty={card.difficulty} />
        <PriorityBadge value={card.priority} />
        {card.mcQuestions && card.mcQuestions.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 font-semibold" title={`${card.mcQuestions.length} MC-Fragen verfügbar`}>
            🎯 {card.mcQuestions.length}
          </span>
        )}
        {card.blacklisted && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold" title="Auf Blacklist — vom Lernen ausgeschlossen">
            🚫 Blacklist
          </span>
        )}
        {hasChat && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/40 text-purple-300 font-semibold" title="Existierender KI-Chat — Antwort der Karte anschauen, dann fortsetzen">
            💬 Chat
          </span>
        )}
          {card.customTags.map(t => <span key={t} className="text-xs text-[#6b7280]">#{t}</span>)}
        </div>
      </div>

      {/* AI Chat drawer — opens via 💬-button when card is flipped */}
      <CardChatDrawer
        card={card}
        userId={userId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onUpdateCard={onUpdateCard}
        onRegenerateMC={async (id) => { await onGenerateMC([id]); }}
        apiKeys={apiKeys}
      />
    </div>
  );
}

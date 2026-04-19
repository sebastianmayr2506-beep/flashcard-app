import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Flashcard, AppSettings, Difficulty, SRSStatus, CardSet, CardLink, FlagAttempt } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import SRSBadge from '../components/SRSBadge';
import MarkdownText from '../components/MarkdownText';
import ProbabilityBadge from '../components/ProbabilityBadge';
import { exportJSON } from '../utils/export';

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  sets: CardSet[];
  links: CardLink[];
  flagAttempts: FlagAttempt[];
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onStudyFiltered: (cards: Flashcard[]) => void;
  onBulkAssignSet: (cardIds: string[], setId: string | undefined) => void;
  onBulkCreateAndAssignSet: (cardIds: string[], setName: string) => void;
  onBulkDelete: (cardIds: string[]) => void;
  onNavigate: (page: string) => void;
}

type ViewMode = 'grid' | 'list';

export default function Library({ cards, settings, sets, links, flagAttempts, onEdit, onDelete, onStudyFiltered, onBulkAssignSet, onBulkCreateAndAssignSet, onBulkDelete, onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminer, setFilterExaminer] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');
  const [filterTag, setFilterTag] = useState('');
  const [filterSRS, setFilterSRS] = useState<SRSStatus | ''>('');
  const [filterSet, setFilterSet] = useState('');
  const [filterDue, setFilterDue] = useState(false);
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [filterKlassiker, setFilterKlassiker] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'probability'>('default');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSetId, setBulkSetId] = useState('');
  const [showNewSetInput, setShowNewSetInput] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // Preview
  const [previewCard, setPreviewCard] = useState<Flashcard | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    cards.forEach(c => c.customTags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [cards]);

  const activeExaminers = useMemo(() => {
    const s = new Set<string>();
    cards.forEach(c => c.examiners?.forEach(e => s.add(e)));
    return Array.from(s).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = cards.filter(c => {
      if (q && !c.front.toLowerCase().includes(q) && !c.back.toLowerCase().includes(q)) return false;
      if (filterSubject && !c.subjects?.includes(filterSubject)) return false;
      if (filterExaminer && !c.examiners?.includes(filterExaminer)) return false;
      if (filterDifficulty && c.difficulty !== filterDifficulty) return false;
      if (filterTag && !c.customTags.includes(filterTag)) return false;
      if (filterSRS && getSRSStatus(c) !== filterSRS) return false;
      if (filterSet && c.setId !== filterSet) return false;
      if (filterDue && !isDueToday(c)) return false;
      if (filterFlagged && !c.flagged) return false;
      if (filterKlassiker && (c.probabilityPercent ?? 0) <= 60) return false;
      return true;
    });
    if (sortBy === 'probability') {
      result.sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0));
    }
    return result;
  }, [cards, search, filterSubject, filterExaminer, filterDifficulty, filterTag, filterSRS, filterSet, filterDue, filterFlagged, filterKlassiker, sortBy]);

  const hasFilters = search || filterSubject || filterExaminer || filterDifficulty || filterTag || filterSRS || filterSet || filterDue || filterFlagged || filterKlassiker || sortBy !== 'default';

  const clearFilters = () => {
    setSearch(''); setFilterSubject(''); setFilterExaminer('');
    setFilterDifficulty(''); setFilterTag(''); setFilterSRS('');
    setFilterSet(''); setFilterDue(false); setFilterFlagged(false);
    setFilterKlassiker(false); setSortBy('default');
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

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-5 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Kartei-Bibliothek</h2>
          <p className="text-[#9ca3af] text-sm mt-0.5">{filtered.length} von {cards.length} Karten</p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Filter bar */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[160px] text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none"
          />
          <Select value={filterSubject} onChange={setFilterSubject} placeholder="Fach" options={settings.subjects} />
          <Select value={filterExaminer} onChange={setFilterExaminer} placeholder="Prüfer" options={activeExaminers} />
          <Select value={filterDifficulty} onChange={v => setFilterDifficulty(v as Difficulty | '')} placeholder="Schwierigkeit" options={['einfach','mittel','schwer']} />
          {allTags.length > 0 && <Select value={filterTag} onChange={setFilterTag} placeholder="Tag" options={allTags} />}
          <Select value={filterSRS} onChange={v => setFilterSRS(v as SRSStatus | '')} placeholder="SRS-Status"
            options={['neu','lernend','wiederholen','beherrscht']}
          />
          {sets.length > 0 && (
            <select
              value={filterSet}
              onChange={e => setFilterSet(e.target.value)}
              className="text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
            >
              <option value="">Set</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setFilterDue(!filterDue)}
            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${filterDue
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            📅 Fällig
          </button>
          <button
            onClick={() => setFilterFlagged(!filterFlagged)}
            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${filterFlagged
              ? 'bg-red-500/15 border-red-500/40 text-red-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            🚩 Geflaggt
          </button>
          <button
            onClick={() => setFilterKlassiker(!filterKlassiker)}
            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${filterKlassiker
              ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            🔥 Nur Klassiker
          </button>
          <button
            onClick={() => setSortBy(sortBy === 'probability' ? 'default' : 'probability')}
            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${sortBy === 'probability'
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            📊 Nach Wahrscheinlichkeit
          </button>
        </div>
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
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-lg font-semibold text-white">Keine Karten gefunden</p>
          <p className="text-[#9ca3af] text-sm mt-1">Versuche andere Filtereinstellungen</p>
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
            />
          ))}
        </div>
      )}

      {previewCard && createPortal(
        <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} onEdit={onEdit} />,
        document.body
      )}

      {/* Sticky bulk-action bar */}
      {selectionMode && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-xl px-4">
          <div className="bg-[#1a1d27] border border-[#3d4168] rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-white shrink-0">
              {selectedCount > 0 ? `${selectedCount} Karte${selectedCount !== 1 ? 'n' : ''}` : 'Karten auswählen'}
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
            <button
              onClick={handleBulkDelete}
              disabled={selectedCount === 0}
              className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-red-400 text-sm font-semibold transition-colors shrink-0"
            >
              🗑 Löschen
            </button>
            <button
              onClick={exitSelectionMode}
              className="px-3 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors shrink-0"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
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
      className="text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none cursor-pointer"
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

function CardGridItem({ card, sets, links, flagAttempts, autoUnflagEnabled, selectionMode, selected, onToggleSelect, onEdit, onDelete, onPreview }: CardItemProps) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);
  const linkCount = links.filter(l => l.cardId === card.id || l.linkedCardId === card.id).length;

  const imgSrc = card.frontImage
    ? (card.frontImage.type === 'base64' ? `data:${card.frontImage.mimeType ?? 'image/png'};base64,${card.frontImage.data}` : card.frontImage.data)
    : null;

  const handleClick = () => { if (selectionMode) onToggleSelect(); else onPreview(card); };

  return (
    <div
      onClick={handleClick}
      className={`bg-[#1e2130] border rounded-2xl p-4 flex flex-col gap-3 transition-all duration-200 group relative
        ${selectionMode ? 'cursor-pointer' : ''}
        ${selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : due ? 'border-indigo-500/30 hover:border-indigo-500/40' : 'border-[#2d3148] hover:border-indigo-500/40'}`}
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
        <SRSBadge status={status} />
        {due && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">Fällig</span>}
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
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onPreview(card); }}
            className="text-xs py-1.5 px-2 rounded-lg bg-[#252840] hover:bg-purple-500/20 text-[#9ca3af] hover:text-purple-400 border border-[#2d3148] hover:border-purple-500/30 transition-colors"
            title="Vorschau"
          >
            👁
          </button>
          <button
            onClick={e => { e.stopPropagation(); onEdit(card); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] hover:border-indigo-500/30 transition-colors"
          >
            Bearbeiten
          </button>
          <button
            onClick={e => { e.stopPropagation(); exportJSON([card], `karte_${card.id.slice(0,8)}.json`); }}
            className="text-xs py-1.5 px-2 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] hover:border-indigo-500/30 transition-colors"
            title="JSON exportieren"
          >
            📦
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(card.id); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] hover:border-red-500/30 transition-colors"
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function CardListItem({ card, sets, links, flagAttempts, autoUnflagEnabled, selectionMode, selected, onToggleSelect, onEdit, onDelete, onPreview }: CardItemProps) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);
  const linkCount = links.filter(l => l.cardId === card.id || l.linkedCardId === card.id).length;
  return (
    <div
      onClick={() => { if (selectionMode) onToggleSelect(); else onPreview(card); }}
      className={`bg-[#1e2130] border rounded-xl px-4 py-3 flex items-center gap-3 transition-all group cursor-pointer
        ${selectionMode ? 'cursor-pointer' : ''}
        ${selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : due ? 'border-indigo-500/30 hover:border-indigo-500/40' : 'border-[#2d3148] hover:border-indigo-500/40'}`}
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
        <SRSBadge status={status} />
        {due && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">Fällig</span>}
        {card.flagged && <span title={flagTooltip(card.id, flagAttempts, autoUnflagEnabled)} className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 cursor-help">🚩</span>}
        {linkCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-[#252840] border border-[#2d3148] text-[#9ca3af]">🔗 {linkCount}</span>}
        {card.probabilityPercent != null && card.probabilityPercent > 0 && (
          <ProbabilityBadge pct={card.probabilityPercent} size="xs" />
        )}
        <SetDot setId={card.setId} sets={sets} />
      </div>
      {!selectionMode && (
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={e => { e.stopPropagation(); onPreview(card); }} className="text-xs px-2 py-1.5 rounded-lg bg-[#252840] hover:bg-purple-500/20 text-[#9ca3af] hover:text-purple-400 border border-[#2d3148] transition-colors" title="Vorschau">👁</button>
          <button onClick={e => { e.stopPropagation(); onEdit(card); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] transition-colors">Bearbeiten</button>
          <button onClick={e => { e.stopPropagation(); exportJSON([card], `karte_${card.id.slice(0,8)}.json`); }} className="text-xs px-2 py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] transition-colors" title="JSON exportieren">📦</button>
          <button onClick={e => { e.stopPropagation(); onDelete(card.id); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] transition-colors">Löschen</button>
        </div>
      )}
    </div>
  );
}

// ─── Card Preview Modal ───────────────────────────────────────

function CardPreviewModal({ card, onClose, onEdit }: { card: Flashcard; onClose: () => void; onEdit: (c: Flashcard) => void }) {
  const [isFlipped, setIsFlipped] = useState(false);

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
          {card.customTags.map(t => <span key={t} className="text-xs text-[#6b7280]">#{t}</span>)}
        </div>
      </div>
    </div>
  );
}

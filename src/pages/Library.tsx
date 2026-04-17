import { useState, useMemo } from 'react';
import type { Flashcard, AppSettings, Difficulty, SRSStatus } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import DifficultyBadge from '../components/DifficultyBadge';
import SRSBadge from '../components/SRSBadge';
import MarkdownText from '../components/MarkdownText';

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onStudyFiltered: (cards: Flashcard[]) => void;
  onNavigate: (page: string) => void;
}

type ViewMode = 'grid' | 'list';

export default function Library({ cards, settings, onEdit, onDelete, onStudyFiltered, onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminer, setFilterExaminer] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');
  const [filterTag, setFilterTag] = useState('');
  const [filterSRS, setFilterSRS] = useState<SRSStatus | ''>('');
  const [filterDue, setFilterDue] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const allTags = useMemo(() => {
    const s = new Set<string>();
    cards.forEach(c => c.customTags.forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cards.filter(c => {
      if (q && !c.front.toLowerCase().includes(q) && !c.back.toLowerCase().includes(q)) return false;
      if (filterSubject && !c.subjects?.includes(filterSubject)) return false;
      if (filterExaminer && !c.examiners?.includes(filterExaminer)) return false;
      if (filterDifficulty && c.difficulty !== filterDifficulty) return false;
      if (filterTag && !c.customTags.includes(filterTag)) return false;
      if (filterSRS && getSRSStatus(c) !== filterSRS) return false;
      if (filterDue && !isDueToday(c)) return false;
      return true;
    });
  }, [cards, search, filterSubject, filterExaminer, filterDifficulty, filterTag, filterSRS, filterDue]);

  const hasFilters = search || filterSubject || filterExaminer || filterDifficulty || filterTag || filterSRS || filterDue;

  const clearFilters = () => {
    setSearch(''); setFilterSubject(''); setFilterExaminer('');
    setFilterDifficulty(''); setFilterTag(''); setFilterSRS(''); setFilterDue(false);
  };

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
          <Select value={filterExaminer} onChange={setFilterExaminer} placeholder="Prüfer" options={settings.examiners} />
          <Select value={filterDifficulty} onChange={v => setFilterDifficulty(v as Difficulty | '')} placeholder="Schwierigkeit" options={['einfach','mittel','schwer']} />
          {allTags.length > 0 && <Select value={filterTag} onChange={setFilterTag} placeholder="Tag" options={allTags} />}
          <Select value={filterSRS} onChange={v => setFilterSRS(v as SRSStatus | '')} placeholder="SRS-Status"
            options={['neu','lernend','wiederholen','beherrscht']}
          />
          <button
            onClick={() => setFilterDue(!filterDue)}
            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${filterDue
              ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
              : 'bg-[#252840] border-[#2d3148] text-[#9ca3af] hover:text-white'}`}
          >
            📅 Fällig
          </button>
        </div>
        {hasFilters && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9ca3af]">{filtered.length} Treffer</span>
            <button onClick={clearFilters} className="text-xs text-indigo-400 hover:text-indigo-300">Filter zurücksetzen</button>
          </div>
        )}
      </div>

      {/* Study filtered button */}
      {filtered.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => onStudyFiltered(filtered)}
            className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2"
          >
            ▶ Diese Auswahl lernen ({filtered.length})
          </button>
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
            <CardGridItem key={card.id} card={card} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(card => (
            <CardListItem key={card.id} card={card} onEdit={onEdit} onDelete={onDelete} />
          ))}
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

function CardGridItem({ card, onEdit, onDelete }: { card: Flashcard; onEdit: (c: Flashcard) => void; onDelete: (id: string) => void }) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);

  const imgSrc = card.frontImage
    ? (card.frontImage.type === 'base64' ? `data:${card.frontImage.mimeType ?? 'image/png'};base64,${card.frontImage.data}` : card.frontImage.data)
    : null;

  return (
    <div className={`bg-[#1e2130] border rounded-2xl p-4 flex flex-col gap-3 hover:border-indigo-500/40 transition-all duration-200 group ${due ? 'border-indigo-500/30' : 'border-[#2d3148]'}`}>
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
      </div>
      {card.customTags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {card.customTags.slice(0,3).map(t => (
            <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-[#252840] text-[#9ca3af]">#{t}</span>
          ))}
          {card.customTags.length > 3 && <span className="text-xs text-[#6b7280]">+{card.customTags.length - 3}</span>}
        </div>
      )}
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(card)}
          className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] hover:border-indigo-500/30 transition-colors"
        >
          Bearbeiten
        </button>
        <button
          onClick={() => onDelete(card.id)}
          className="flex-1 text-xs py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] hover:border-red-500/30 transition-colors"
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

function CardListItem({ card, onEdit, onDelete }: { card: Flashcard; onEdit: (c: Flashcard) => void; onDelete: (id: string) => void }) {
  const status = getSRSStatus(card);
  const due = isDueToday(card);
  return (
    <div className={`bg-[#1e2130] border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-indigo-500/40 transition-all group ${due ? 'border-indigo-500/30' : 'border-[#2d3148]'}`}>
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
      </div>
      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={() => onEdit(card)} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-indigo-500/20 text-[#9ca3af] hover:text-indigo-400 border border-[#2d3148] transition-colors">Bearbeiten</button>
        <button onClick={() => onDelete(card.id)} className="text-xs px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 border border-[#2d3148] transition-colors">Löschen</button>
      </div>
    </div>
  );
}

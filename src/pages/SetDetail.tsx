import { useState } from 'react';
import type { CardSet, Flashcard, CardLink } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { exportSetJSON, exportSetCSV } from '../utils/export';
import { createShareCode } from '../utils/shareCode';
import DifficultyBadge from '../components/DifficultyBadge';
import SRSBadge from '../components/SRSBadge';
import MarkdownText from '../components/MarkdownText';

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

export default function SetDetail({ set, cards, links, userId, onBack, onEdit, onDelete, onStudy, showToast }: Props) {
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Kopieren');

  const setCards = cards.filter(c => c.setId === set.id);
  const dueCount = setCards.filter(isDueToday).length;

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
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {setCards.length > 0 && (
          <button
            onClick={() => onStudy(setCards)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
          >
            ▶ Lernen ({setCards.length})
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
          <h3 className="text-sm font-semibold text-[#9ca3af] uppercase tracking-wider">Karten</h3>
          <div className="flex flex-col gap-2">
            {setCards.map(card => {
              const status = getSRSStatus(card);
              const due = isDueToday(card);
              return (
                <div
                  key={card.id}
                  className={`bg-[#1e2130] border rounded-xl px-4 py-3 flex items-center gap-4 hover:border-indigo-500/40 transition-all group ${due ? 'border-indigo-500/30' : 'border-[#2d3148]'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      <MarkdownText text={card.front || '(leer)'} />
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <DifficultyBadge difficulty={card.difficulty} />
                    <SRSBadge status={status} />
                    {due && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">Fällig</span>}
                  </div>
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

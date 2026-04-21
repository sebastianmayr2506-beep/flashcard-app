import { useState, useEffect } from 'react';
import type { Flashcard } from '../types/card';

interface Props {
  card: Flashcard;
  onSave: (id: string, data: Partial<Flashcard>) => void;
  onClose: () => void;
}

/**
 * Lightweight inline editor for fixing front/back text during a study or
 * exam session without losing session state. Saves via updateCard.
 */
export default function QuickEditModal({ card, onSave, onClose }: Props) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);

  // Keep fields in sync if the card prop changes (e.g. after a rating)
  useEffect(() => {
    setFront(card.front);
    setBack(card.back);
  }, [card.id]);

  const hasChanges = front !== card.front || back !== card.back;

  const handleSave = () => {
    if (!hasChanges) { onClose(); return; }
    onSave(card.id, { front, back });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#1a1d27] rounded-3xl border border-[#2d3148] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2d3148] shrink-0">
          <span className="text-sm font-semibold text-white">✏️ Karte bearbeiten</span>
          <button onClick={onClose} className="text-[#9ca3af] hover:text-white text-xl leading-none transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-indigo-400 uppercase tracking-wider block mb-1.5">Frage</label>
            <textarea
              value={front}
              onChange={e => setFront(e.target.value)}
              rows={3}
              className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-purple-400 uppercase tracking-wider block mb-1.5">Antwort</label>
            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              rows={10}
              className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y font-mono"
            />
            <p className="text-xs text-[#6b7280] mt-1">Markdown unterstützt (**fett**, *kursiv*, | Tabellen |, ```Code-Blöcke```)</p>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-[#2d3148] shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

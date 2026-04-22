import { useEffect, useState } from 'react';
import type { Flashcard, Difficulty } from '../types/card';
import type { SplitResult, SplitCard } from '../utils/claudeSplit';
import MarkdownText from './MarkdownText';

interface Props {
  source: Flashcard;
  result: SplitResult;
  onConfirm: (cards: SplitCard[]) => void;
  onCancel: () => void;
  onForce?: (hint?: string) => void;
  forceLoading?: boolean;
}

export default function SplitPreviewModal({ source, result, onConfirm, onCancel, onForce, forceLoading }: Props) {
  const [cards, setCards] = useState<SplitCard[]>(result.split ? result.cards : []);
  const [showReasoning, setShowReasoning] = useState(true);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [forceHint, setForceHint] = useState('');

  // Sync cards when result changes (e.g. after force split returns split=true)
  useEffect(() => {
    setCards(result.split ? result.cards : []);
    setShowReasoning(true);
  }, [result]);

  const updateCard = (idx: number, patch: Partial<SplitCard>) => {
    setCards(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeCard = (idx: number) => {
    setCards(prev => prev.filter((_, i) => i !== idx));
  };

  const canConfirm = result.split && cards.length >= 2 && cards.every(c => c.front.trim() && c.back.trim());

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-5xl bg-[#1a1d27] rounded-3xl border border-[#2d3148] shadow-2xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3148] shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">✂️</span>
            <div>
              <h2 className="text-sm font-bold text-white">KI-Trennung</h2>
              <p className="text-xs text-[#9ca3af]">
                {result.split
                  ? `Karte wird in ${cards.length} eigenständige Karten aufgeteilt`
                  : 'Karte ist nicht trennbar'}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-[#9ca3af] hover:text-white text-xl leading-none transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Original card */}
          <div>
            <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">Originalkarte</p>
            <div className="bg-[#252840] border border-[#2d3148] rounded-xl p-4 space-y-2">
              <div>
                <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-1">Frage</p>
                <div className="text-sm text-white"><MarkdownText text={source.front || '(leer)'} /></div>
              </div>
              <div className="border-t border-[#2d3148] pt-2">
                <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1">Antwort</p>
                <div className="text-sm text-[#d1d5db]"><MarkdownText text={source.back || '(leer)'} /></div>
              </div>
            </div>
          </div>

          {/* AI Reasoning */}
          <div>
            <button
              onClick={() => setShowReasoning(s => !s)}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <span>{showReasoning ? '▾' : '▸'}</span>
              KI-Begründung
            </button>
            {showReasoning && (
              <div className={`mt-2 border rounded-xl px-4 py-3 ${result.split ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-amber-500/5 border-amber-500/30'}`}>
                <p className={`text-sm leading-relaxed ${result.split ? 'text-[#c7d2fe]' : 'text-amber-200'}`}>
                  {result.reasoning || '—'}
                </p>
              </div>
            )}
          </div>

          {/* Not splittable state */}
          {!result.split && (
            <div className="bg-[#1e2130] border border-amber-500/30 rounded-2xl overflow-hidden">
              <div className="p-6 text-center">
                <p className="text-4xl mb-2">🚫</p>
                <p className="text-white font-semibold text-sm">Diese Karte wurde nicht getrennt</p>
                <p className="text-[#9ca3af] text-xs mt-1">
                  Die KI hat entschieden, dass die Inhalte zusammengehören.
                </p>
              </div>
              {onForce && (
                <div className="border-t border-amber-500/20 px-5 pb-5 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Trotzdem trennen?</p>
                  <input
                    type="text"
                    value={forceHint}
                    onChange={e => setForceHint(e.target.value)}
                    placeholder='Optional: Hinweis geben, z.B. "Trenn bei Frage 1 und Frage 2"'
                    className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm placeholder-[#6b7280] focus:border-amber-500 focus:outline-none"
                    disabled={forceLoading}
                  />
                  <button
                    onClick={() => onForce(forceHint.trim() || undefined)}
                    disabled={forceLoading}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    {forceLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        KI trennt…
                      </>
                    ) : (
                      <>✂️ KI zum Trennen zwingen</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Split cards preview / editor */}
          {result.split && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider">
                  Getrennte Karten ({cards.length})
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setActiveTab('edit')}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${activeTab === 'edit' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-[#9ca3af] hover:text-white'}`}
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${activeTab === 'preview' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-[#9ca3af] hover:text-white'}`}
                  >
                    Vorschau
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {cards.map((c, idx) => (
                  <div key={idx} className="bg-[#1e2130] border border-indigo-500/30 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2d3148]">
                      <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                        Karte {idx + 1}
                      </span>
                      {cards.length > 2 && (
                        <button
                          onClick={() => removeCard(idx)}
                          className="text-xs text-[#9ca3af] hover:text-red-400 transition-colors"
                          title="Diese Teilkarte verwerfen"
                        >
                          ✕ Entfernen
                        </button>
                      )}
                    </div>

                    {activeTab === 'edit' ? (
                      <div className="p-4 space-y-3">
                        <div>
                          <label className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider block mb-1">Frage</label>
                          <textarea
                            value={c.front}
                            onChange={e => updateCard(idx, { front: e.target.value })}
                            rows={3}
                            className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-purple-400 uppercase tracking-wider block mb-1">Antwort</label>
                          <textarea
                            value={c.back}
                            onChange={e => updateCard(idx, { back: e.target.value })}
                            rows={8}
                            className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y font-mono"
                          />
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div>
                            <label className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wider block mb-1">Schwierigkeit</label>
                            <select
                              value={c.difficulty}
                              onChange={e => updateCard(idx, { difficulty: e.target.value as Difficulty })}
                              className="text-xs bg-[#252840] border border-[#2d3148] rounded-lg px-2 py-1.5 text-white focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="einfach">einfach</option>
                              <option value="mittel">mittel</option>
                              <option value="schwer">schwer</option>
                            </select>
                          </div>
                          {c.customTags.length > 0 && (
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wider mb-1">Tags</p>
                              <div className="flex gap-1 flex-wrap">
                                {c.customTags.map(t => (
                                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[#252840] border border-[#2d3148] text-[#9ca3af]">
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 space-y-3">
                        <div>
                          <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-1">Frage</p>
                          <div className="text-sm text-white"><MarkdownText text={c.front || '(leer)'} /></div>
                        </div>
                        <div className="border-t border-[#2d3148] pt-3">
                          <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1">Antwort</p>
                          <div className="text-sm text-[#d1d5db]"><MarkdownText text={c.back || '(leer)'} /></div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[#2d3148] shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors"
          >
            {result.split ? 'Abbrechen' : 'Schließen'}
          </button>
          {result.split && (
            <button
              onClick={() => onConfirm(cards.map(c => ({ ...c, front: c.front.trim(), back: c.back.trim() })))}
              disabled={!canConfirm}
              className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              ✂️ Trennen & Original löschen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

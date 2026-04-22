import { useEffect, useState } from 'react';
import type { Flashcard, Difficulty } from '../types/card';
import type { MergeResult } from '../utils/claudeMerge';
import MarkdownText from './MarkdownText';

interface Props {
  sources: Flashcard[];
  suggestion: MergeResult;
  onConfirm: (merged: MergeResult) => void;
  onCancel: () => void;
  onRevise?: (current: MergeResult, feedback: string) => Promise<void> | void;
  reviseLoading?: boolean;
}

export default function MergePreviewModal({ sources, suggestion, onConfirm, onCancel, onRevise, reviseLoading }: Props) {
  const [front, setFront] = useState(suggestion.front);
  const [back, setBack] = useState(suggestion.back);
  const [difficulty, setDifficulty] = useState<Difficulty>(suggestion.difficulty);
  const [showReasoning, setShowReasoning] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  // When a new AI suggestion arrives (e.g. after revision), sync local editor state
  useEffect(() => {
    setFront(suggestion.front);
    setBack(suggestion.back);
    setDifficulty(suggestion.difficulty);
  }, [suggestion]);

  // Warn if source cards have different subjects
  const allSubjects = new Set(sources.flatMap(c => c.subjects ?? []));
  const mixedSubjects = allSubjects.size > 1;

  // Computed metadata (mirrors App.tsx handleConfirmMerge logic — shown as preview)
  const maxProb = sources.reduce((max, c) => Math.max(max, c.probabilityPercent ?? 0), 0);
  const totalAsked = sources.reduce((s, c) => s + (c.timesAsked ?? 0), 0);

  const handleConfirm = () => {
    onConfirm({ ...suggestion, front: front.trim(), back: back.trim(), difficulty });
  };

  const handleRevise = async () => {
    if (!onRevise || !feedback.trim() || reviseLoading) return;
    await onRevise(
      { front: front.trim(), back: back.trim(), difficulty, reasoning: suggestion.reasoning },
      feedback.trim()
    );
    setFeedback('');
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-4xl bg-[#1a1d27] rounded-3xl border border-[#2d3148] shadow-2xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3148] shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">🤖</span>
            <div>
              <h2 className="text-sm font-bold text-white">KI-Zusammenführung</h2>
              <p className="text-xs text-[#9ca3af]">{sources.length} Karten werden zu einer zusammengeführt</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-[#9ca3af] hover:text-white text-xl leading-none transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Mixed subjects warning */}
          {mixedSubjects && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-amber-400 text-lg shrink-0">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-300">Verschiedene Fächer</p>
                <p className="text-xs text-amber-200/70 mt-0.5">
                  Die ausgewählten Karten gehören zu: {Array.from(allSubjects).join(', ')}. Prüfe ob das Zusammenführen sinnvoll ist.
                </p>
              </div>
            </div>
          )}

          {/* Source cards summary */}
          <div>
            <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-2">Quellkarten ({sources.length})</p>
            <div className="space-y-2">
              {sources.map(c => (
                <div key={c.id} className="bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 flex items-start gap-2">
                  <span className="text-[#6b7280] text-xs mt-0.5 shrink-0">→</span>
                  <p className="text-sm text-[#d1d5db] line-clamp-2">{c.front}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Reasoning */}
          <div>
            <button
              onClick={() => setShowReasoning(s => !s)}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <span>{showReasoning ? '▾' : '▸'}</span>
              KI-Begründung anzeigen
            </button>
            {showReasoning && (
              <div className="mt-2 bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-4 py-3">
                <p className="text-sm text-[#c7d2fe] leading-relaxed">{suggestion.reasoning}</p>
              </div>
            )}
          </div>

          {/* Merged card editor */}
          <div className="bg-[#1e2130] border border-indigo-500/30 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Zusammengeführte Karte</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setTab('edit')}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${tab === 'edit' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-[#9ca3af] hover:text-white'}`}
                >
                  Bearbeiten
                </button>
                <button
                  onClick={() => setTab('preview')}
                  className={`text-xs px-3 py-1 rounded-lg transition-colors ${tab === 'preview' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-[#9ca3af] hover:text-white'}`}
                >
                  Vorschau
                </button>
              </div>
            </div>

            {tab === 'edit' ? (
              <div className="p-4 space-y-4">
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
                    rows={14}
                    className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y font-mono"
                  />
                  <p className="text-xs text-[#6b7280] mt-1">Markdown unterstützt (**fett**, *kursiv*, ## Überschriften, | Tabellen |, ```Code-Blöcke```)</p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1">Schwierigkeit</label>
                    <select
                      value={difficulty}
                      onChange={e => setDifficulty(e.target.value as Difficulty)}
                      className="text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none appearance-none"
                    >
                      <option value="einfach">einfach</option>
                      <option value="mittel">mittel</option>
                      <option value="schwer">schwer</option>
                    </select>
                  </div>
                  {/* Computed metadata preview */}
                  {maxProb > 0 && (
                    <div className="text-sm text-[#9ca3af]">
                      Wahrscheinlichkeit: <span className="text-amber-400 font-semibold">{maxProb}%</span>
                      <span className="text-[#6b7280] text-xs ml-1">(Maximum)</span>
                    </div>
                  )}
                  {totalAsked > 0 && (
                    <div className="text-sm text-[#9ca3af]">
                      Mal gefragt: <span className="text-white font-semibold">{totalAsked}×</span>
                      <span className="text-[#6b7280] text-xs ml-1">(Summe)</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Frage</p>
                  <div className="text-white text-sm leading-relaxed">
                    <MarkdownText text={front || '(leer)'} />
                  </div>
                </div>
                <div className="border-t border-[#2d3148] pt-4">
                  <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">Antwort</p>
                  <div className="text-[#d1d5db] text-sm leading-relaxed">
                    <MarkdownText text={back || '(leer)'} />
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Revision / feedback panel — sticky above footer, always visible */}
        {onRevise && (
          <div className="shrink-0 border-t border-[#2d3148] bg-[#1a1d27]">
            <button
              onClick={() => setShowFeedback(s => !s)}
              className="w-full flex items-center justify-between px-6 py-3 hover:bg-[#1e2130] transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-purple-400 uppercase tracking-wider">
                <span>✨</span> Änderungswünsche an KI {showFeedback ? '' : '— klicken zum Öffnen'}
              </span>
              <span className="text-[#9ca3af] text-xs">{showFeedback ? '▾' : '▸'}</span>
            </button>
            {showFeedback && (
              <div className="px-6 pb-4 space-y-3 border-t border-[#2d3148] pt-3">
                <p className="text-xs text-[#9ca3af] leading-relaxed">
                  Beschreibe, was du ändern möchtest (z.&nbsp;B. „Kürzer", „Mehr Beispiele", „Tabelle ergänzen", „Die Frage präziser formulieren"). Die KI überarbeitet die aktuelle Karte entsprechend.
                </p>
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  rows={2}
                  placeholder="z.B. Mach die Antwort kürzer und ergänze eine Tabelle mit den Vor- und Nachteilen."
                  className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
                  disabled={reviseLoading}
                />
                <button
                  onClick={handleRevise}
                  disabled={!feedback.trim() || reviseLoading}
                  className="w-full py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {reviseLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      KI überarbeitet…
                    </>
                  ) : (
                    <>🔄 KI überarbeiten lassen</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[#2d3148] shrink-0">
          <button
            onClick={onCancel}
            disabled={reviseLoading}
            className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Abbrechen
          </button>
          <button
            onClick={handleConfirm}
            disabled={!front.trim() || !back.trim() || reviseLoading}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            ✓ Zusammenführen & {sources.length} Karten löschen
          </button>
        </div>
      </div>
    </div>
  );
}

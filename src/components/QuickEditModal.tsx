import { useState, useEffect } from 'react';
import type { Flashcard, CardImage } from '../types/card';
import ImageInput from './ImageInput';
import { reviseCardWithGemini } from '../utils/geminiReviseCard';

interface Props {
  card: Flashcard;
  onSave: (id: string, data: Partial<Flashcard>) => void;
  onClose: () => void;
  geminiApiKey?: string;
  onApiError?: (message: string) => void;
}

/**
 * Lightweight inline editor for fixing front/back text during a study or
 * exam session without losing session state. Saves via updateCard.
 */
export default function QuickEditModal({ card, onSave, onClose, geminiApiKey, onApiError }: Props) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [frontImage, setFrontImage] = useState<CardImage | undefined>(card.frontImage);
  const [backImage, setBackImage] = useState<CardImage | undefined>(card.backImage);
  const [showFrontImage, setShowFrontImage] = useState(!!card.frontImage);
  const [showBackImage, setShowBackImage] = useState(!!card.backImage);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiFeedback, setAiFeedback] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiScope, setAiScope] = useState<'back' | 'both'>('back');

  // Keep fields in sync if the card prop changes (e.g. after a rating)
  useEffect(() => {
    setFront(card.front);
    setBack(card.back);
    setFrontImage(card.frontImage);
    setBackImage(card.backImage);
    setShowFrontImage(!!card.frontImage);
    setShowBackImage(!!card.backImage);
    setAiOpen(false);
    setAiFeedback('');
  }, [card.id]);

  const handleAiRevise = async () => {
    if (!aiFeedback.trim() || aiLoading) return;
    if (!geminiApiKey?.trim()) {
      onApiError?.('Bitte trage zuerst deinen Gemini API-Schlüssel in den Einstellungen ein.');
      return;
    }
    setAiLoading(true);
    try {
      const result = await reviseCardWithGemini({
        apiKey: geminiApiKey,
        front,
        back,
        feedback: aiFeedback.trim(),
        backOnly: aiScope === 'back',
      });
      if (aiScope === 'both') setFront(result.front);
      setBack(result.back);
      setAiFeedback('');
    } catch (err) {
      console.error('Gemini revise error:', err);
      onApiError?.(`Gemini-Fehler: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiLoading(false);
    }
  };

  const hasChanges =
    front !== card.front ||
    back !== card.back ||
    frontImage !== card.frontImage ||
    backImage !== card.backImage;

  const handleSave = () => {
    if (!hasChanges) { onClose(); return; }
    onSave(card.id, { front, back, frontImage, backImage });
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
            {showFrontImage ? (
              <div className="mt-2">
                <ImageInput value={frontImage} onChange={setFrontImage} label="Bild Vorderseite" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowFrontImage(true)}
                className="mt-2 text-xs text-[#6b7280] hover:text-indigo-400 transition-colors flex items-center gap-1"
              >
                🖼️ Bild hinzufügen
              </button>
            )}
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
            {showBackImage ? (
              <div className="mt-2">
                <ImageInput value={backImage} onChange={setBackImage} label="Bild Rückseite" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowBackImage(true)}
                className="mt-2 text-xs text-[#6b7280] hover:text-purple-400 transition-colors flex items-center gap-1"
              >
                🖼️ Bild hinzufügen
              </button>
            )}
          </div>
        </div>

        {/* AI revision panel — sticky above footer */}
        <div className="shrink-0 border-t border-[#2d3148] bg-[#1a1d27]">
          <button
            onClick={() => setAiOpen(s => !s)}
            className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-[#1e2130] transition-colors"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-purple-400 uppercase tracking-wider">
              <span>✨</span> KI überarbeiten (Gemini) {aiOpen ? '' : '— klicken zum Öffnen'}
            </span>
            <span className="text-[#9ca3af] text-xs">{aiOpen ? '▾' : '▸'}</span>
          </button>
          {aiOpen && (
            <div className="px-5 pb-4 pt-2 border-t border-[#2d3148] space-y-2.5">
              <div className="flex gap-1 text-xs">
                <button
                  onClick={() => setAiScope('back')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${aiScope === 'back' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-[#9ca3af] hover:text-white border border-transparent'}`}
                >
                  Nur Antwort ändern
                </button>
                <button
                  onClick={() => setAiScope('both')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${aiScope === 'both' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-[#9ca3af] hover:text-white border border-transparent'}`}
                >
                  Frage + Antwort
                </button>
              </div>
              <textarea
                value={aiFeedback}
                onChange={e => setAiFeedback(e.target.value)}
                rows={2}
                placeholder='z.B. "Mach die Antwort kürzer und ergänze ein Beispiel" oder "Erklär SWOT-Analyse ausführlicher"'
                className="w-full bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white text-sm placeholder-[#6b7280] focus:border-purple-500 focus:outline-none resize-y"
                disabled={aiLoading}
              />
              <button
                onClick={handleAiRevise}
                disabled={!aiFeedback.trim() || aiLoading}
                className="w-full py-2 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {aiLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Gemini überarbeitet…
                  </>
                ) : (
                  <>🔄 Mit Gemini überarbeiten</>
                )}
              </button>
              {!geminiApiKey?.trim() && (
                <p className="text-[11px] text-amber-300/80">
                  ⚠️ Kein Gemini API-Schlüssel hinterlegt. Trage einen in den Einstellungen ein (gratis via aistudio.google.com).
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-[#2d3148] shrink-0">
          <button
            onClick={onClose}
            disabled={aiLoading}
            className="flex-1 py-2.5 rounded-xl border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || aiLoading}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

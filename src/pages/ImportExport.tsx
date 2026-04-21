import { useRef, useState } from 'react';
import type { Flashcard, CardSet } from '../types/card';
import { exportJSON, exportCSV } from '../utils/export';
import { importFromJSON, importFromCSV, extractParentLinks } from '../utils/import';
import { importByShareCode } from '../utils/shareCode';

interface Props {
  cards: Flashcard[];
  sets: CardSet[];
  userId: string;
  onImport: (cards: Flashcard[], merge: boolean) => Promise<void> | void;
  onImportSet: (set: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>, cards: Flashcard[], userId: string, links?: Array<{ cardFront: string; linkedCardFront: string; linkType: 'child' | 'related' }>) => void;
  onImportLinks: (jsonText: string, importedCards: Flashcard[]) => void;
  onRepairLinks: (jsonText: string) => number;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function ImportExport({ cards, sets, userId, onImport, onImportSet, onImportLinks, onRepairLinks, showToast }: Props) {
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);
  const [mergeMode, setMergeMode] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [shareLoading, setShareLoading] = useState(false);

  const handleExportJSON = () => {
    exportJSON(cards);
    showToast(`${cards.length} Karten als JSON exportiert`);
  };

  const handleExportCSV = () => {
    exportCSV(cards);
    showToast(`${cards.length} Karten als CSV exportiert`);
  };

  // Process a single file in isolation (handles set-export JSON up front).
  // Returns `null` if the file was a set export (already handled) or unsupported,
  // otherwise returns the parsed cards + raw text for link extraction.
  const parseFile = async (file: File): Promise<{ cards: Flashcard[]; text: string } | null> => {
    const text = await file.text();
    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'set' in parsed && 'cards' in parsed) {
          const setData = parsed.set as CardSet;
          const setCards = parsed.cards as Flashcard[];
          onImportSet(
            { name: setData.name, description: setData.description, subject: setData.subject, examiner: setData.examiner, color: setData.color ?? '#6366f1' },
            setCards,
            userId
          );
          showToast(`Set "${setData.name}" mit ${setCards.length} Karten importiert!`, 'success');
          return null;
        }
      } catch {
        // fall through
      }
      return { cards: importFromJSON(text), text };
    }
    if (file.name.endsWith('.csv')) {
      return { cards: importFromCSV(text), text: '' };
    }
    showToast(`Nicht unterstütztes Dateiformat: ${file.name}`, 'error');
    return null;
  };

  // Combine multiple files into a single import so "Ersetzen" replaces ONCE,
  // not once per file (which would wipe earlier files).
  const processFiles = async (files: File[]) => {
    try {
      const parsed = await Promise.all(files.map(parseFile));
      const results = parsed.filter((r): r is { cards: Flashcard[]; text: string } => r !== null);
      if (results.length === 0) return;

      // Dedupe by id across all files
      const seen = new Set<string>();
      const allCards: Flashcard[] = [];
      for (const { cards: c } of results) {
        for (const card of c) {
          if (!seen.has(card.id)) {
            seen.add(card.id);
            allCards.push(card);
          }
        }
      }

      // Safety: require explicit confirmation before replacing all cards
      if (!mergeMode) {
        const confirmed = window.confirm(
          `⚠️ ACHTUNG: Ersetzen-Modus!\n\nAlle ${cards.length} vorhandenen Karten werden unwiderruflich gelöscht und durch ${allCards.length} neue Karten ersetzt.\n\nFortfahren?`
        );
        if (!confirmed) return;
      }

      await onImport(allCards, mergeMode);
      showToast(
        `${allCards.length} Karten aus ${results.length} Datei${results.length !== 1 ? 'en' : ''} importiert!`,
        'success'
      );

      // Parent-question link extraction across all JSON files
      for (const { cards: c, text } of results) {
        if (text) {
          const hints = extractParentLinks(text);
          if (hints.length > 0) onImportLinks(text, c);
        }
      }
    } catch (err) {
      showToast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) await processFiles(files);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await processFiles(files);
  };

  const handleShareImport = async () => {
    const code = shareCodeInput.trim();
    if (!code) return;
    setShareLoading(true);
    try {
      const payload = await importByShareCode(code);
      const freshCards: Flashcard[] = payload.cards.map(c => ({
        ...c,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReviewDate: new Date().toISOString(),
      }));
      onImportSet(payload.set, freshCards, userId, payload.links);
      showToast(`Set "${payload.set.name}" mit ${freshCards.length} Karten importiert!`, 'success');
      setShareCodeInput('');
    } catch (err) {
      showToast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Import / Export</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Karten sichern, teilen oder importieren</p>
      </div>

      {/* Export */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-white">Export</h3>
        <p className="text-sm text-[#9ca3af]">Alle {cards.length} Karten exportieren</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ExportCard
            icon="📦"
            title="JSON-Export"
            description="Vollständige Daten inkl. SRS-Status"
            badge="Empfohlen"
            onClick={handleExportJSON}
            disabled={cards.length === 0}
          />
          <ExportCard
            icon="📊"
            title="CSV-Export"
            description="Textfelder für Excel / Sheets"
            onClick={handleExportCSV}
            disabled={cards.length === 0}
          />
        </div>
        {sets.length > 0 && (
          <p className="text-xs text-[#6b7280]">
            Sets einzeln exportieren: Sets-Seite → Set öffnen → Exportieren
          </p>
        )}
      </div>

      {/* Share code import */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-white">Set per Code importieren</h3>
        <p className="text-sm text-[#9ca3af]">Gib den 8-stelligen Code ein um ein geteiltes Set zu importieren.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={shareCodeInput}
            onChange={e => setShareCodeInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleShareImport()}
            placeholder="z.B. AB3K7PQX"
            maxLength={8}
            className="flex-1 font-mono text-base bg-[#252840] border border-[#2d3148] rounded-xl px-4 py-2.5 text-white placeholder-[#6b7280] focus:border-indigo-500 focus:outline-none tracking-widest"
          />
          <button
            onClick={handleShareImport}
            disabled={shareCodeInput.trim().length < 4 || shareLoading}
            className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {shareLoading ? '⟳' : 'Importieren'}
          </button>
        </div>
      </div>

      {/* Import */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-white">Datei importieren</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <div
            onClick={() => setMergeMode(!mergeMode)}
            className={`w-10 h-6 rounded-full transition-colors relative ${mergeMode ? 'bg-indigo-500' : 'bg-[#2d3148]'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${mergeMode ? 'left-5' : 'left-1'}`} />
          </div>
          <div>
            <span className="text-sm text-white">{mergeMode ? 'Zusammenführen' : 'Ersetzen'}</span>
            <p className="text-xs text-[#9ca3af]">{mergeMode ? 'Vorhandene Karten bleiben erhalten' : 'Alle vorhandenen Karten werden ersetzt!'}</p>
          </div>
        </label>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-[#2d3148] hover:border-[#6b7280]'}`}
        >
          <p className="text-3xl mb-3">📂</p>
          <p className="text-sm font-medium text-white">Datei hier ablegen</p>
          <p className="text-xs text-[#9ca3af] mt-1 mb-4">JSON oder CSV · Set-JSON wird automatisch erkannt</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => jsonRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 text-sm font-medium transition-colors"
            >
              JSON importieren
            </button>
            <button
              onClick={() => csvRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors"
            >
              CSV importieren
            </button>
          </div>
        </div>

        {/* CSV format guide */}
        <div className="bg-[#252840] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#9ca3af] uppercase tracking-wider mb-2">CSV-Format</p>
          <p className="text-xs text-[#6b7280] font-mono">front_text, back_text, subjects, examiners, difficulty, customTags</p>
          <p className="text-xs text-[#6b7280] mt-1">difficulty: einfach | mittel | schwer · Tags mit Semikolon trennen</p>
        </div>
      </div>

      {/* Repair links */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold text-white">🔗 Links reparieren</h3>
        <p className="text-sm text-[#9ca3af]">
          Falls Verknüpfungen aus <code className="text-indigo-400">parent_question</code>-Feldern fehlen: dieselbe JSON-Datei hier hochladen. Es werden keine Karten importiert — nur fehlende Links erstellt.
        </p>
        <button
          onClick={() => repairRef.current?.click()}
          className="px-4 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 text-sm font-medium transition-colors"
        >
          🔗 JSON für Link-Reparatur wählen
        </button>
      </div>

      <input ref={jsonRef} type="file" accept=".json" multiple className="hidden" onChange={handleFile} />
      <input ref={csvRef} type="file" accept=".csv" multiple className="hidden" onChange={handleFile} />
      <input ref={repairRef} type="file" accept=".json" className="hidden" onChange={async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
          const text = await file.text();
          const count = onRepairLinks(text);
          showToast(count > 0 ? `🔗 ${count} Link${count !== 1 ? 's' : ''} erstellt` : 'Keine neuen Links gefunden', count > 0 ? 'success' : 'info');
        } catch {
          showToast('Fehler beim Lesen der Datei', 'error');
        }
      }} />
    </div>
  );
}

function ExportCard({ icon, title, description, badge, onClick, disabled }: {
  icon: string; title: string; description: string; badge?: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-4 p-4 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] hover:border-indigo-500/40 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed group"
    >
      <span className="text-3xl">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">{title}</p>
          {badge && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">{badge}</span>}
        </div>
        <p className="text-xs text-[#9ca3af] mt-0.5">{description}</p>
      </div>
      <span className="text-[#6b7280] group-hover:text-indigo-400 transition-colors">↓</span>
    </button>
  );
}

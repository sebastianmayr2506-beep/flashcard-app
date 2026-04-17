import { useRef, useState } from 'react';
import type { Flashcard } from '../types/card';
import { exportJSON, exportCSV } from '../utils/export';
import { importFromJSON, importFromCSV } from '../utils/import';

interface Props {
  cards: Flashcard[];
  onImport: (cards: Flashcard[], merge: boolean) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function ImportExport({ cards, onImport, showToast }: Props) {
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [mergeMode, setMergeMode] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  const handleExportJSON = () => {
    exportJSON(cards);
    showToast(`${cards.length} Karten als JSON exportiert`);
  };

  const handleExportCSV = () => {
    exportCSV(cards);
    showToast(`${cards.length} Karten als CSV exportiert`);
  };

  const processFile = async (file: File) => {
    try {
      const text = await file.text();
      let imported: Flashcard[];
      if (file.name.endsWith('.json')) {
        imported = importFromJSON(text);
      } else if (file.name.endsWith('.csv')) {
        imported = importFromCSV(text);
      } else {
        showToast('Nicht unterstütztes Dateiformat. Bitte JSON oder CSV.', 'error');
        return;
      }
      onImport(imported, mergeMode);
      showToast(`${imported.length} Karten erfolgreich importiert!`, 'success');
    } catch (err) {
      showToast(`Import fehlgeschlagen: ${(err as Error).message}`, 'error');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
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
      </div>

      {/* Import */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-white">Import</h3>

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
          <p className="text-xs text-[#9ca3af] mt-1 mb-4">JSON oder CSV</p>
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

      <input ref={jsonRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
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

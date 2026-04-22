import { useState, useEffect } from 'react';
import type { AppSettings, Flashcard } from '../types/card';
import { calculatePaceMetrics } from '../utils/dailyGoal';

interface Props {
  settings: AppSettings;
  cards: Flashcard[];
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  onAddSubject: (s: string) => void;
  onRemoveSubject: (s: string) => void;
  onAddExaminer: (e: string) => void;
  onRemoveExaminer: (e: string) => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  onResetAllSrs: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Settings({
  settings, cards, onUpdateSettings, onAddSubject, onRemoveSubject,
  onAddExaminer, onRemoveExaminer, onAddTag, onRemoveTag, onResetAllSrs, showToast,
}: Props) {
  const [dailyGoalInput, setDailyGoalInput] = useState(String(settings.dailyNewCardGoal ?? 10));
  const [reviewCapInput, setReviewCapInput] = useState(
    settings.dailyReviewCap && settings.dailyReviewCap < 9999 ? String(settings.dailyReviewCap) : ''
  );
  const [apiKeyInput, setApiKeyInput] = useState(settings.anthropicApiKey ?? '');
  const [showApiKey, setShowApiKey] = useState(false);

  // Sync when settings load from Supabase after mount
  useEffect(() => {
    setApiKeyInput(settings.anthropicApiKey ?? '');
  }, [settings.anthropicApiKey]);

  const daysUntilExam = settings.examDate
    ? Math.ceil((new Date(settings.examDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
    : null;
  const hasExamDate = !!settings.examDate && daysUntilExam !== null && daysUntilExam >= 0;

  // SM-2-aware pace metrics (only compute when exam date is set and there are cards)
  const pace = (daysUntilExam !== null && daysUntilExam > 0 && cards.length > 0)
    ? calculatePaceMetrics(cards, daysUntilExam)
    : null;

  const unseenCount = cards.filter(c => c.repetitions === 0).length;

  const handleExamDateChange = (val: string) => {
    onUpdateSettings({ examDate: val || undefined });
    showToast(val ? '📅 Prüfungsdatum gespeichert' : 'Prüfungsdatum entfernt', 'info');
  };

  const handleDailyGoalBlur = () => {
    const n = Math.max(1, Math.min(500, parseInt(dailyGoalInput) || 10));
    setDailyGoalInput(String(n));
    onUpdateSettings({ dailyNewCardGoal: n });
    showToast(`Tagesmaximum: ${n} neue Karten pro Tag`);
  };

  const handleReviewCapBlur = () => {
    const raw = reviewCapInput.trim();
    if (!raw) {
      // Empty = no cap
      onUpdateSettings({ dailyReviewCap: 9999 });
      return;
    }
    const n = Math.max(1, Math.min(9999, parseInt(raw) || 9999));
    setReviewCapInput(String(n));
    onUpdateSettings({ dailyReviewCap: n });
    showToast(`Max. Wiederholungen: ${n} pro Tag`);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Einstellungen</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Prüfung, Tagesziel, Fächer und Prüfer verwalten</p>
      </div>

      {/* Exam countdown + daily goal */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-5">
        <h3 className="font-semibold text-white flex items-center gap-2">🎯 Prüfungsvorbereitung</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">
              Prüfungsdatum
            </label>
            <input
              type="date"
              value={settings.examDate ?? ''}
              onChange={e => handleExamDateChange(e.target.value)}
              className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none [color-scheme:dark]"
            />
            {settings.examDate && (
              <p className="text-xs text-indigo-400 mt-1.5">
                {formatExamCountdown(settings.examDate)}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">
              {hasExamDate ? 'Tagesmaximum (optional)' : 'Neue Karten pro Tag'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={dailyGoalInput}
                onChange={e => setDailyGoalInput(e.target.value)}
                onBlur={handleDailyGoalBlur}
                onKeyDown={e => e.key === 'Enter' && handleDailyGoalBlur()}
                className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-[#6b7280] text-sm shrink-0">/ Tag</span>
            </div>
            <p className="text-xs text-[#6b7280] mt-1.5">
              {hasExamDate
                ? 'Begrenzt die tägliche Anzahl nach oben'
                : 'Wird ohne Prüfungsdatum als fixes Ziel verwendet'}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">
              Max. Wiederholungen pro Tag
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={9999}
                value={reviewCapInput}
                onChange={e => setReviewCapInput(e.target.value)}
                onBlur={handleReviewCapBlur}
                onKeyDown={e => e.key === 'Enter' && handleReviewCapBlur()}
                placeholder="Kein Limit"
                className="w-full text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#4b5563] focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-[#6b7280] text-sm shrink-0">/ Tag</span>
            </div>
            <p className="text-xs text-[#6b7280] mt-1.5">
              Verhindert Überschwemmung durch importierte Karten mit altem SRS-Stand.
              Leer lassen = kein Limit. Tipp: z.B. 20–30 am Anfang.
            </p>
          </div>
        </div>

        {/* SM-2-aware pace panel */}
        {hasExamDate && pace && (
          <div className="space-y-3">
            {/* Main recommendation */}
            <div className={`rounded-xl px-4 py-3 flex items-start gap-3 ${
              pace.requiredNewPerDay <= settings.dailyNewCardGoal
                ? 'bg-emerald-500/10 border border-emerald-500/30'
                : 'bg-amber-500/10 border border-amber-500/30'
            }`}>
              <span className="text-xl shrink-0 mt-0.5">
                {pace.requiredNewPerDay <= settings.dailyNewCardGoal ? '✅' : '⚠️'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${
                  pace.requiredNewPerDay <= settings.dailyNewCardGoal ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  Empfohlenes Lerntempo: <span className="text-white">{pace.requiredNewPerDay} neue Karten / Tag</span>
                </p>
                <p className="text-xs text-[#9ca3af] mt-0.5">
                  {unseenCount} ungesehene Karten ÷ {pace.effectiveDays} verfügbare Tage
                  {' '}(SM-2 braucht ~15 Tage für 3 Wiederholungen je Karte)
                </p>
                {pace.requiredNewPerDay <= settings.dailyNewCardGoal
                  ? <p className="text-xs text-emerald-400 mt-1">Du liegst im Plan 🎉</p>
                  : <p className="text-xs text-amber-400 mt-1">Tagesmaximum zu niedrig — erhöhe auf mindestens {pace.requiredNewPerDay}</p>
                }
              </div>
              {pace.requiredNewPerDay > settings.dailyNewCardGoal && (
                <button
                  onClick={() => {
                    setDailyGoalInput(String(pace.requiredNewPerDay));
                    onUpdateSettings({ dailyNewCardGoal: pace.requiredNewPerDay });
                    showToast(`Tagesmaximum auf ${pace.requiredNewPerDay} gesetzt`, 'success');
                  }}
                  className="ml-auto shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs font-semibold transition-colors"
                >
                  Übernehmen
                </button>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#252840] rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{pace.requiredNewPerDay}</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Neue / Tag</p>
              </div>
              <div className="bg-[#252840] rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-indigo-300">~{pace.estimatedDailyReviews}</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Wdh. / Tag</p>
              </div>
              <div className={`rounded-xl px-3 py-2.5 text-center ${
                pace.masteryRateAtExam >= 90 ? 'bg-emerald-500/10' :
                pace.masteryRateAtExam >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10'
              }`}>
                <p className={`text-lg font-bold ${
                  pace.masteryRateAtExam >= 90 ? 'text-emerald-400' :
                  pace.masteryRateAtExam >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>{pace.masteryRateAtExam}%</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Beherrscht</p>
              </div>
            </div>

            <p className="text-[11px] text-[#6b7280]">
              Wdh. / Tag = Simulation deiner Karten durch den Anki-Algorithmus (SM-2) · Beherrscht = ≥3 Wiederholungen bis Prüfungstag
            </p>
          </div>
        )}
      </div>

      <TagManager
        title="Fächer"
        icon="📚"
        items={settings.subjects}
        color="indigo"
        onAdd={v => { onAddSubject(v); showToast(`Fach "${v}" hinzugefügt`); }}
        onRemove={v => { onRemoveSubject(v); showToast(`Fach "${v}" entfernt`, 'info'); }}
        placeholder="Neues Fach…"
      />

      <TagManager
        title="Prüfer"
        icon="👨‍🏫"
        items={settings.examiners}
        color="purple"
        onAdd={v => { onAddExaminer(v); showToast(`Prüfer "${v}" hinzugefügt`); }}
        onRemove={v => { onRemoveExaminer(v); showToast(`Prüfer "${v}" entfernt`, 'info'); }}
        placeholder="Neuer Prüfer…"
      />

      <TagManager
        title="Globale Tags"
        icon="🏷️"
        items={settings.customTags}
        color="amber"
        onAdd={v => { onAddTag(v); showToast(`Tag "${v}" hinzugefügt`); }}
        onRemove={v => { onRemoveTag(v); showToast(`Tag "${v}" entfernt`, 'info'); }}
        placeholder="Neuer Tag…"
      />

      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold text-white flex items-center gap-2">🚩 Prüfungsmodus – Flaggen</h3>
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <p className="text-sm text-white">Automatische Flaggen-Entfernung</p>
            <p className="text-xs text-[#6b7280] mt-0.5">
              Flagge wird entfernt, sobald du eine Karte im Prüfungsmodus an 2 verschiedenen Tagen richtig beantwortest
            </p>
          </div>
          <div
            onClick={() => onUpdateSettings({ autoUnflagEnabled: !settings.autoUnflagEnabled })}
            className={`shrink-0 w-10 h-6 rounded-full transition-colors relative cursor-pointer ${settings.autoUnflagEnabled ? 'bg-indigo-500' : 'bg-[#2d3148]'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.autoUnflagEnabled ? 'left-5' : 'left-1'}`} />
          </div>
        </label>
      </div>

      {/* Anthropic API Key for AI Merge */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">🤖 KI-Zusammenführung</h3>
          <p className="text-xs text-[#6b7280] mt-1">
            Trage deinen Anthropic API-Schlüssel ein, um Karten per KI automatisch zusammenzuführen (Bibliothek → Auswählen → Zusammenführen).
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
            Anthropic API Key
          </label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-[#252840] border border-[#2d3148] rounded-xl overflow-hidden focus-within:border-indigo-500">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-…"
                className="flex-1 bg-transparent px-3 py-2 text-white text-sm focus:outline-none font-mono"
              />
              <button
                onClick={() => setShowApiKey(s => !s)}
                className="px-3 text-[#6b7280] hover:text-white text-xs transition-colors"
              >
                {showApiKey ? '🙈' : '👁'}
              </button>
            </div>
            <button
              onClick={() => {
                const key = apiKeyInput.trim();
                onUpdateSettings({ anthropicApiKey: key || undefined });
                showToast(key ? 'API-Schlüssel gespeichert ✓' : 'API-Schlüssel entfernt', key ? 'success' : 'info');
              }}
              className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition-colors shrink-0"
            >
              Speichern
            </button>
          </div>
          <p className="text-xs text-[#6b7280] mt-1.5">
            Der Schlüssel wird verschlüsselt in deinem Account gespeichert.
            API-Schlüssel erhältst du unter{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
              console.anthropic.com
            </a>.
          </p>
        </div>
      </div>

      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
        <h3 className="font-semibold text-white mb-1 flex items-center gap-2">📊 Lernstatistik</h3>
        <p className="text-sm text-[#9ca3af]">Aktueller Streak: <span className="text-amber-400 font-semibold">{settings.studyStreak} Tag{settings.studyStreak !== 1 ? 'e' : ''} 🔥</span></p>
        {settings.lastStudiedDate && (
          <p className="text-xs text-[#6b7280] mt-1">Zuletzt gelernt: {settings.lastStudiedDate}</p>
        )}
      </div>

      {/* SRS Reset */}
      <div className="bg-[#1e2130] border border-red-500/20 rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold text-white flex items-center gap-2">⚠️ Lernfortschritt zurücksetzen</h3>
        <p className="text-sm text-[#9ca3af]">
          Setzt alle Karten auf <span className="text-white font-medium">„Neu"</span> zurück —
          alle Wiederholungsintervalle, Wiederholungszähler und SRS-Daten werden gelöscht.
          Sinnvoll wenn du Karten importiert hast, die bereits den Lernstand von jemand anderem hatten.
        </p>
        <p className="text-xs text-red-400">Nicht rückgängig zu machen. Dein eigener Lernfortschritt geht verloren.</p>
        <button
          onClick={() => {
            const typed = window.prompt(
              `⚠️ SRS-Daten zurücksetzen\n\nAlle ${cards.length} Karten werden auf "Neu" gesetzt — Intervalle, Wiederholungen und Lernfortschritt werden gelöscht.\n\nTippe RESET (in Großbuchstaben) um fortzufahren.`
            );
            if (typed === 'RESET') {
              onResetAllSrs();
              showToast(`✅ SRS-Daten für ${cards.length} Karten zurückgesetzt`, 'success');
            } else if (typed !== null) {
              showToast('Abgebrochen — falsches Wort eingegeben', 'info');
            }
          }}
          className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold transition-colors"
        >
          🔄 Alle Karten auf Neu zurücksetzen
        </button>
      </div>
    </div>
  );
}

function formatExamCountdown(examDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(examDate);
  exam.setHours(0, 0, 0, 0);
  const days = Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'Prüfung bereits vorbei';
  if (days === 0) return 'Prüfung ist heute!';
  if (days === 1) return 'Prüfung ist morgen!';
  return `Noch ${days} Tage bis zur Prüfung`;
}

const colorMap = {
  indigo: { btn: 'bg-indigo-500 hover:bg-indigo-400', pill: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300', input: 'focus:border-indigo-500' },
  purple: { btn: 'bg-purple-500 hover:bg-purple-400', pill: 'bg-purple-500/10 border-purple-500/30 text-purple-300', input: 'focus:border-purple-500' },
  amber:  { btn: 'bg-amber-500 hover:bg-amber-400',   pill: 'bg-amber-500/10 border-amber-500/30 text-amber-300',   input: 'focus:border-amber-500' },
};

function TagManager({ title, icon, items, color, onAdd, onRemove, placeholder }: {
  title: string; icon: string; items: string[]; color: 'indigo' | 'purple' | 'amber';
  onAdd: (v: string) => void; onRemove: (v: string) => void; placeholder: string;
}) {
  const [input, setInput] = useState('');
  const c = colorMap[color];

  const handleAdd = () => {
    const v = input.trim();
    if (!v || items.includes(v)) return;
    onAdd(v);
    setInput('');
  };

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
      <h3 className="font-semibold text-white flex items-center gap-2">{icon} {title}</h3>
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {items.length === 0 && <p className="text-xs text-[#6b7280]">Noch keine Einträge</p>}
        {items.map(item => (
          <span key={item} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm ${c.pill}`}>
            {item}
            <button
              onClick={() => onRemove(item)}
              className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-xs"
              title="Entfernen"
            >✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          className={`flex-1 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#6b7280] focus:outline-none ${c.input}`}
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className={`px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40 ${c.btn}`}
        >
          + Hinzufügen
        </button>
      </div>
    </div>
  );
}

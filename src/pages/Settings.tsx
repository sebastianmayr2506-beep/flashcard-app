import { useState } from 'react';
import type { AppSettings } from '../types/card';

interface Props {
  settings: AppSettings;
  unseenCount: number;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  onAddSubject: (s: string) => void;
  onRemoveSubject: (s: string) => void;
  onAddExaminer: (e: string) => void;
  onRemoveExaminer: (e: string) => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Settings({
  settings, unseenCount, onUpdateSettings, onAddSubject, onRemoveSubject,
  onAddExaminer, onRemoveExaminer, onAddTag, onRemoveTag, showToast,
}: Props) {
  const [dailyGoalInput, setDailyGoalInput] = useState(String(settings.dailyNewCardGoal ?? 10));

  // Auto-calculated required pace based on exam date
  const daysUntilExam = settings.examDate
    ? Math.ceil((new Date(settings.examDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
    : null;
  const requiredPace = (daysUntilExam !== null && daysUntilExam > 0)
    ? Math.ceil(unseenCount / daysUntilExam)
    : daysUntilExam === 0 ? unseenCount : null;
  const hasExamDate = !!settings.examDate && daysUntilExam !== null && daysUntilExam >= 0;

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
        </div>

        {/* Auto-calculated pace banner */}
        {hasExamDate && requiredPace !== null && (
          <div className={`rounded-xl px-4 py-3 flex items-start gap-3 ${
            requiredPace <= settings.dailyNewCardGoal
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : 'bg-amber-500/10 border border-amber-500/30'
          }`}>
            <span className="text-xl shrink-0 mt-0.5">
              {requiredPace <= settings.dailyNewCardGoal ? '✅' : '⚠️'}
            </span>
            <div>
              <p className={`text-sm font-semibold ${
                requiredPace <= settings.dailyNewCardGoal ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                Benötigtes Lerntempo: <span className="text-white">{requiredPace} Karten / Tag</span>
              </p>
              <p className="text-xs text-[#9ca3af] mt-0.5">
                {unseenCount} ungesehene Karten ÷ {daysUntilExam} Tage
                {requiredPace <= settings.dailyNewCardGoal
                  ? ' — du liegst im Plan 🎉'
                  : ` — erhöhe dein Tagesmaximum auf mindestens ${requiredPace}`}
              </p>
            </div>
            {requiredPace > settings.dailyNewCardGoal && (
              <button
                onClick={() => {
                  setDailyGoalInput(String(requiredPace));
                  onUpdateSettings({ dailyNewCardGoal: requiredPace });
                  showToast(`Tagesmaximum auf ${requiredPace} gesetzt`, 'success');
                }}
                className="ml-auto shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs font-semibold transition-colors"
              >
                Übernehmen
              </button>
            )}
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

      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
        <h3 className="font-semibold text-white mb-1 flex items-center gap-2">📊 Lernstatistik</h3>
        <p className="text-sm text-[#9ca3af]">Aktueller Streak: <span className="text-amber-400 font-semibold">{settings.studyStreak} Tag{settings.studyStreak !== 1 ? 'e' : ''} 🔥</span></p>
        {settings.lastStudiedDate && (
          <p className="text-xs text-[#6b7280] mt-1">Zuletzt gelernt: {settings.lastStudiedDate}</p>
        )}
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

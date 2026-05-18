import { useState, useEffect } from 'react';
import type { AppSettings, Flashcard } from '../types/card';
import { calculatePaceMetrics } from '../utils/dailyGoal';
import { supabase } from '../lib/supabase';
import type { useGoogleDrive } from '../hooks/useGoogleDrive';
import { previewClassification, inspectDistribution } from '../utils/priority';
import { normalizeAll, type NormalizationSummary } from '../utils/normalizeStats';
import InfoTooltip from '../components/InfoTooltip';
import { ADMIN_EMAIL } from '../utils/admin';
import AdminStatsPanel from '../components/AdminStatsPanel';

// ─── Tageslimit-Presets ──────────────────────────────────────────────────────
// Ein Preset setzt die 3 echten Settings (dailyNewCardGoal, ...Mode,
// dailyReviewCap) auf eine sinnvolle Kombination. Reviews bleiben in allen
// Presets ungebremst — ein zu niedriger Wdh.-Cap baut Backlog auf und
// untergräbt SRS. Custom-Modus lässt den User trotzdem alles fein justieren.
type PresetId = 'relaxed' | 'standard' | 'intensive' | 'auto' | 'custom';
interface Preset {
  id: PresetId;
  emoji: string;
  label: string;
  tagline: string;       // Ein-Satz Untertitel auf der Karte
  requiresExamDate?: boolean;
  apply?: () => Partial<AppSettings>;  // undefined for 'custom' (no auto-apply)
}
const PRESETS: Preset[] = [
  {
    id: 'relaxed',
    emoji: '🌿',
    label: 'Entspannt',
    tagline: '10 neue Karten / Tag',
    apply: () => ({ dailyNewCardGoal: 10, dailyNewCardGoalMode: 'manual', dailyReviewCap: 9999 }),
  },
  {
    id: 'standard',
    emoji: '📚',
    label: 'Standard',
    tagline: '20 neue Karten / Tag',
    apply: () => ({ dailyNewCardGoal: 20, dailyNewCardGoalMode: 'manual', dailyReviewCap: 9999 }),
  },
  {
    id: 'intensive',
    emoji: '⚡',
    label: 'Intensiv',
    tagline: '40 neue Karten / Tag',
    apply: () => ({ dailyNewCardGoal: 40, dailyNewCardGoalMode: 'manual', dailyReviewCap: 9999 }),
  },
  {
    id: 'auto',
    emoji: '🎯',
    label: 'Auto-Pace',
    tagline: 'Schafft alles bis zur Prüfung',
    requiresExamDate: true,
    apply: () => ({ dailyNewCardGoalMode: 'auto', dailyReviewCap: 9999 }),
  },
  {
    id: 'custom',
    emoji: '⚙️',
    label: 'Eigene Werte',
    tagline: 'Selbst justieren',
  },
];

/** Detect which preset the current settings match exactly. Falls back to 'custom'. */
function detectActivePreset(s: AppSettings): PresetId {
  const cap = s.dailyReviewCap ?? 9999;
  const noReviewCap = cap >= 9999;
  const mode = s.dailyNewCardGoalMode ?? 'manual';
  if (!noReviewCap) return 'custom';
  if (mode === 'auto') return 'auto';
  if (mode === 'manual' && s.dailyNewCardGoal === 10) return 'relaxed';
  if (mode === 'manual' && s.dailyNewCardGoal === 20) return 'standard';
  if (mode === 'manual' && s.dailyNewCardGoal === 40) return 'intensive';
  return 'custom';
}

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
  onResetAllSrs: (mode: 'all' | 'broken-only') => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  userEmail?: string;
  gdrive: ReturnType<typeof useGoogleDrive>;
  onAutoClassifyPriority: (overwrite: boolean) => Promise<{ A: number; B: number; C: number; touched: number }>;
  onNormalizeStats: () => Promise<NormalizationSummary>;
}

export default function Settings({
  settings, cards, onUpdateSettings, onAddSubject, onRemoveSubject,
  onAddExaminer, onRemoveExaminer, onAddTag, onRemoveTag, onResetAllSrs, showToast, userEmail,
  gdrive, onAutoClassifyPriority, onNormalizeStats,
}: Props) {
  const [dailyGoalInput, setDailyGoalInput] = useState(String(settings.dailyNewCardGoal ?? 10));
  const [reviewCapInput, setReviewCapInput] = useState(
    settings.dailyReviewCap && settings.dailyReviewCap < 9999 ? String(settings.dailyReviewCap) : ''
  );
  const [apiKeyInput, setApiKeyInput] = useState(settings.anthropicApiKey ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState(settings.geminiApiKey ?? '');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [groqKeyInput, setGroqKeyInput] = useState(settings.groqApiKey ?? '');
  const [showGroqKey, setShowGroqKey] = useState(false);

  // Sync when settings load from Supabase after mount
  useEffect(() => {
    setApiKeyInput(settings.anthropicApiKey ?? '');
  }, [settings.anthropicApiKey]);

  useEffect(() => {
    setGeminiKeyInput(settings.geminiApiKey ?? '');
  }, [settings.geminiApiKey]);

  useEffect(() => {
    setGroqKeyInput(settings.groqApiKey ?? '');
  }, [settings.groqApiKey]);

  const daysUntilExam = settings.examDate
    ? Math.ceil((new Date(settings.examDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
    : null;
  const hasExamDate = !!settings.examDate && daysUntilExam !== null && daysUntilExam >= 0;

  // SM-2-aware pace metrics (only compute when exam date is set and there are cards)
  const pace = (daysUntilExam !== null && daysUntilExam > 0 && cards.length > 0)
    ? calculatePaceMetrics(cards, daysUntilExam, settings.dailyNewCardGoal)
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

      {/* ─── Exam date + daily-limit (preset picker) ─────────────────────── */}
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-5">
        <h3 className="font-semibold text-white flex items-center gap-2">🎯 Prüfungsvorbereitung</h3>

        {/* Step 1: Exam date */}
        <div>
          <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-2">
            Prüfungsdatum
          </label>
          <input
            type="date"
            value={settings.examDate ?? ''}
            onChange={e => handleExamDateChange(e.target.value)}
            className="w-full sm:w-64 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none [color-scheme:dark]"
          />
          {settings.examDate && (
            <p className="text-xs text-indigo-400 mt-1.5">
              {formatExamCountdown(settings.examDate)}
            </p>
          )}
          {!settings.examDate && (
            <p className="text-xs text-[#6b7280] mt-1.5">
              Optional. Mit Datum kann die App ein automatisches Lerntempo berechnen.
            </p>
          )}
        </div>

        {/* Step 2: Daily-limit preset picker */}
        <DailyLimitSection
          settings={settings}
          dailyGoalInput={dailyGoalInput}
          setDailyGoalInput={setDailyGoalInput}
          reviewCapInput={reviewCapInput}
          setReviewCapInput={setReviewCapInput}
          handleDailyGoalBlur={handleDailyGoalBlur}
          handleReviewCapBlur={handleReviewCapBlur}
          hasExamDate={hasExamDate}
          pace={pace}
          unseenCount={unseenCount}
          onUpdateSettings={onUpdateSettings}
          showToast={showToast}
        />
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

        {/* Gemini key — for AI card revision inside the editor */}
        <div className="pt-4 border-t border-[#2d3148]">
          <h3 className="font-semibold text-white flex items-center gap-2">✨ KI-Überarbeitung (Gemini)</h3>
          <p className="text-xs text-[#6b7280] mt-1 mb-3">
            Trage deinen Google AI Studio API-Schlüssel ein, um einzelne Karten während des Lernens oder in der Bibliothek per KI überarbeiten zu lassen. Gemini 2.5 Flash ist kostenlos nutzbar.
          </p>
          <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
            Gemini API Key
          </label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-[#252840] border border-[#2d3148] rounded-xl overflow-hidden focus-within:border-purple-500">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                placeholder="AIza…"
                className="flex-1 bg-transparent px-3 py-2 text-white text-sm focus:outline-none font-mono"
              />
              <button
                onClick={() => setShowGeminiKey(s => !s)}
                className="px-3 text-[#6b7280] hover:text-white text-xs transition-colors"
              >
                {showGeminiKey ? '🙈' : '👁'}
              </button>
            </div>
            <button
              onClick={() => {
                const key = geminiKeyInput.trim();
                onUpdateSettings({ geminiApiKey: key || undefined });
                showToast(key ? 'Gemini-Schlüssel gespeichert ✓' : 'Gemini-Schlüssel entfernt', key ? 'success' : 'info');
              }}
              className="px-4 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-white text-sm font-semibold transition-colors shrink-0"
            >
              Speichern
            </button>
          </div>
          <p className="text-xs text-[#6b7280] mt-1.5">
            API-Schlüssel erhältst du unter{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">
              aistudio.google.com/apikey
            </a>
            {' '}— gratis, ohne Kreditkarte.
          </p>
        </div>

        {/* Groq key — free fallback when Gemini is overloaded */}
        <div className="pt-4 border-t border-[#2d3148]">
          <h3 className="font-semibold text-white flex items-center gap-2">⚡ Groq Fallback <span className="text-xs font-normal text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">kostenlos</span></h3>
          <p className="text-xs text-[#6b7280] mt-1 mb-3">
            Wenn Gemini überlastet ist, springt Groq automatisch ein — komplett gratis, keine Kreditkarte nötig.
            Reihenfolge: Gemini → Groq → Claude.
          </p>
          <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider block mb-1.5">
            Groq API Key
          </label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-[#252840] border border-[#2d3148] rounded-xl overflow-hidden focus-within:border-green-500">
              <input
                type={showGroqKey ? 'text' : 'password'}
                value={groqKeyInput}
                onChange={e => setGroqKeyInput(e.target.value)}
                placeholder="gsk_…"
                className="flex-1 bg-transparent px-3 py-2 text-white text-sm focus:outline-none font-mono"
              />
              <button onClick={() => setShowGroqKey(s => !s)} className="px-3 text-[#6b7280] hover:text-white text-xs transition-colors">
                {showGroqKey ? '🙈' : '👁'}
              </button>
            </div>
            <button
              onClick={() => {
                const key = groqKeyInput.trim();
                onUpdateSettings({ groqApiKey: key || undefined });
                showToast(key ? 'Groq-Schlüssel gespeichert ✓' : 'Groq-Schlüssel entfernt', key ? 'success' : 'info');
              }}
              className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors shrink-0"
            >
              Speichern
            </button>
          </div>
          <p className="text-xs text-[#6b7280] mt-1.5">
            Kostenlosen Key bekommst du unter{' '}
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">
              console.groq.com/keys
            </a>
            {' '}— Account erstellen, fertig.
          </p>
        </div>
      </div>

      {/* Data normalization — runs BEFORE classification so the heuristic
          can use the cleaned-up dedicated fields */}
      <NormalizeStatsSection cards={cards} onApply={onNormalizeStats} />

      {/* Priority auto-classification */}
      <PriorityClassifySection cards={cards} onApply={onAutoClassifyPriority} />

      {/* Google Drive automatic backup */}
      <GoogleDriveSection gdrive={gdrive} cards={cards} />

      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
        <h3 className="font-semibold text-white mb-1 flex items-center gap-2">📊 Lernstatistik</h3>
        <p className="text-sm text-[#9ca3af]">Aktueller Streak: <span className="text-amber-400 font-semibold">{settings.studyStreak} Tag{settings.studyStreak !== 1 ? 'e' : ''} 🔥</span></p>
        {settings.lastStudiedDate && (
          <p className="text-xs text-[#6b7280] mt-1">Zuletzt gelernt: {settings.lastStudiedDate}</p>
        )}
      </div>

      {/* Invite codes — admin only */}
      {userEmail === ADMIN_EMAIL && (
        <InviteCodesPanel showToast={showToast} />
      )}

      {/* Admin-Stats — admin only, default zugeklappt, lädt lazy */}
      {userEmail === ADMIN_EMAIL && (
        <AdminStatsPanel adminEmail={userEmail} />
      )}

      {/* SRS Reset */}
      <div className="bg-[#1e2130] border border-red-500/20 rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-white flex items-center gap-2">⚠️ Lernfortschritt zurücksetzen</h3>

        {/* Option 1: surgical — safe */}
        {(() => {
          const brokenCount = cards.filter(c => c.repetitions === 0 && c.interval > 0).length;
          return brokenCount > 0 ? (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-300">🩹 Empfohlen: Nur fehlerhafte Import-Daten bereinigen</p>
              <p className="text-sm text-[#9ca3af]">
                {brokenCount} Karten haben widersprüchliche SRS-Werte (aus einem fremden Import):
                sie stehen als <span className="text-white font-medium">„Neu"</span> aber haben bereits ein Review-Intervall gesetzt.
                Das sorgt für falsche Wiederholungen. <span className="text-white">Deine {cards.filter(c => c.repetitions > 0).length} gelernten Karten bleiben unberührt.</span>
              </p>
              <button
                onClick={() => {
                  onResetAllSrs('broken-only');
                  showToast(`✅ ${brokenCount} fehlerhafte Karten bereinigt — dein Fortschritt bleibt erhalten`, 'success');
                }}
                className="px-4 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-sm font-semibold transition-colors"
              >
                🩹 {brokenCount} fehlerhafte Karten bereinigen (sicher)
              </button>
            </div>
          ) : null;
        })()}

        {/* Option 2: full reset — nuclear */}
        <div className="space-y-2">
          <p className="text-sm text-[#9ca3af]">
            Setzt <span className="text-white font-medium">alle</span> Karten auf „Neu" zurück — auch deine eigenen Lernfortschritte gehen verloren.
          </p>
          <p className="text-xs text-red-400">Nicht rückgängig zu machen.</p>
          <button
            onClick={() => {
              const typed = window.prompt(
                `⚠️ ALLES zurücksetzen\n\nAlle ${cards.length} Karten werden auf "Neu" gesetzt — auch dein eigener Lernfortschritt geht verloren.\n\nTippe RESET (in Großbuchstaben) um fortzufahren.`
              );
              if (typed === 'RESET') {
                onResetAllSrs('all');
                showToast(`✅ SRS-Daten für alle ${cards.length} Karten zurückgesetzt`, 'success');
              } else if (typed !== null) {
                showToast('Abgebrochen — falsches Wort eingegeben', 'info');
              }
            }}
            className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold transition-colors"
          >
            🔄 Alle Karten zurücksetzen
          </button>
        </div>
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

interface InviteCode {
  id: string;
  code: string;
  created_at: string;
  used_at: string | null;
  used_by_email: string | null;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(4)}-${seg(4)}`;
}

function InviteCodesPanel({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadCodes = async () => {
    setLoadingCodes(true);
    const { data } = await supabase
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setCodes(data as InviteCode[]);
    setLoadingCodes(false);
  };

  useEffect(() => { loadCodes(); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    const code = generateCode();
    const { error } = await supabase.from('invite_codes').insert({ code });
    if (error) {
      showToast('Fehler: ' + error.message, 'error');
    } else {
      showToast(`✓ Code generiert: ${code}`, 'success');
      await loadCodes();
    }
    setGenerating(false);
  };

  const copyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unused = codes.filter(c => !c.used_at);
  const used   = codes.filter(c =>  c.used_at);

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">🔑 Einladungscodes</h3>
          <p className="text-xs text-[#6b7280] mt-0.5">Nur du siehst diesen Bereich · jeder Code ist einmalig verwendbar</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="shrink-0 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          {generating ? '…' : '+ Neuer Code'}
        </button>
      </div>

      {loadingCodes ? (
        <p className="text-xs text-[#6b7280] animate-pulse">Laden…</p>
      ) : codes.length === 0 ? (
        <p className="text-xs text-[#6b7280]">Noch keine Codes — klick auf „+ Neuer Code"</p>
      ) : (
        <div className="space-y-3">
          {unused.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Verfügbar ({unused.length})</p>
              {unused.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#252840] border border-[#2d3148]">
                  <span className="font-mono font-bold text-sm tracking-widest text-white flex-1">{c.code}</span>
                  <button
                    onClick={() => copyCode(c.code, c.id)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 transition-colors shrink-0"
                  >
                    {copiedId === c.id ? '✓ Kopiert!' : '📋 Kopieren'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {used.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Verwendet ({used.length})</p>
              {used.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[#1a1d27] border border-[#2d3148] opacity-50">
                  <span className="font-mono text-sm tracking-widest text-[#6b7280] line-through flex-1">{c.code}</span>
                  <span className="text-xs text-[#6b7280] truncate max-w-[140px]">{c.used_by_email}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      <div className="flex flex-col sm:flex-row gap-2">
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
          className={`w-full sm:w-auto px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40 shrink-0 ${c.btn}`}
        >
          + Hinzufügen
        </button>
      </div>
    </div>
  );
}

// ─── Google Drive backup section ───────────────────────────────────────────
function GoogleDriveSection({
  gdrive,
  cards,
}: {
  gdrive: ReturnType<typeof useGoogleDrive>;
  cards: Flashcard[];
}) {
  if (!gdrive.configured) {
    // Don't surface this section at all if the env var isn't set —
    // most users on a self-hosted variant won't have configured it.
    return (
      <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-2 opacity-60">
        <h3 className="font-semibold text-white flex items-center gap-2">☁️ Google Drive Backup</h3>
        <p className="text-xs text-[#9ca3af]">
          Google-Client-ID nicht konfiguriert (<code className="text-[#6b7280]">VITE_GOOGLE_CLIENT_ID</code>).
          Diese Funktion wird vom Admin aktiviert.
        </p>
      </div>
    );
  }

  const last = gdrive.lastBackupAt
    ? formatRelativeTime(gdrive.lastBackupAt)
    : 'noch nie';

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-white flex items-center gap-2">☁️ Google Drive Backup</h3>
          <p className="text-xs text-[#9ca3af] mt-0.5">
            Tägliches Backup deiner Bibliothek + SRS-Stand in deinem Google Drive
          </p>
        </div>
        {gdrive.connected ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
            Verbunden
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#252840] text-[#9ca3af] border border-[#2d3148]">
            Nicht verbunden
          </span>
        )}
      </div>

      {gdrive.connected && (
        <>
          <div className="bg-[#252840] rounded-xl p-3 text-xs space-y-1">
            {gdrive.email && (
              <p>
                <span className="text-[#6b7280]">Konto:</span>{' '}
                <span className="text-white font-mono">{gdrive.email}</span>
              </p>
            )}
            <p>
              <span className="text-[#6b7280]">Letztes Backup:</span>{' '}
              <span className="text-white">{last}</span>
              {gdrive.lastBackupName && (
                <span className="text-[#6b7280] ml-1">({gdrive.lastBackupName})</span>
              )}
            </p>
            <p>
              <span className="text-[#6b7280]">Karten:</span>{' '}
              <span className="text-white">{cards.length}</span>
            </p>
          </div>

          {/* Auto-toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={gdrive.autoEnabled}
              onChange={e => gdrive.setAutoEnabled(e.target.checked)}
              className="accent-indigo-500 w-4 h-4"
            />
            <div>
              <p className="text-sm text-white">Automatisch sichern</p>
              <p className="text-[11px] text-[#9ca3af]">
                Beim App-Start, höchstens 1× pro Tag · alte Backups (&gt;30 Tage) werden aufgeräumt
              </p>
            </div>
          </label>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => gdrive.backupNow(cards)}
              disabled={gdrive.busy || cards.length === 0}
              className="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center gap-2"
            >
              {gdrive.busy ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sichere…
                </>
              ) : (
                <>💾 Jetzt sichern</>
              )}
            </button>
            <button
              onClick={() => gdrive.disconnect()}
              disabled={gdrive.busy}
              className="text-sm px-4 py-2 rounded-xl border border-[#2d3148] hover:border-red-500/40 text-[#9ca3af] hover:text-red-400 transition-colors disabled:opacity-40"
            >
              Trennen
            </button>
          </div>
        </>
      )}

      {!gdrive.connected && (
        <>
          <p className="text-xs text-[#9ca3af] leading-relaxed">
            Klicke unten, um deinen Google-Account zu verbinden. Wir erhalten nur Zugriff auf
            <strong className="text-white"> die Backup-Dateien, die wir selbst hochladen</strong> — nicht auf den Rest deines Drives.
          </p>
          <button
            onClick={() => gdrive.connect()}
            disabled={gdrive.connecting}
            className="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center gap-2"
          >
            {gdrive.connecting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Verbinde…
              </>
            ) : (
              <>🔗 Mit Google Drive verbinden</>
            )}
          </button>
        </>
      )}

      {gdrive.error && (
        <p className="text-[11px] text-red-400 leading-relaxed">
          ⚠️ {gdrive.error}
        </p>
      )}
    </div>
  );
}

function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return 'gerade eben';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Minute${diffMin !== 1 ? 'n' : ''}`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Stunde${diffH !== 1 ? 'n' : ''}`;
  const diffDay = Math.round(diffH / 24);
  return `vor ${diffDay} Tag${diffDay !== 1 ? 'en' : ''}`;
}

// ─── Priority auto-classification ──────────────────────────────────────────
function PriorityClassifySection({
  cards,
  onApply,
}: {
  cards: Flashcard[];
  onApply: (overwrite: boolean) => Promise<{ A: number; B: number; C: number; touched: number }>;
}) {
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  // Live preview that follows the overwrite toggle
  const preview = previewClassification(cards, overwrite);

  // Current manual distribution (what user has set up to now)
  const existing = cards.reduce((acc, c) => {
    if (c.priority === 'A') acc.A++;
    else if (c.priority === 'B') acc.B++;
    else if (c.priority === 'C') acc.C++;
    else acc.none++;
    return acc;
  }, { A: 0, B: 0, C: 0, none: 0 });

  // Raw signal distribution — shows what data we have to work with.
  // Helps diagnose surprising classifications (e.g., everything ending up C
  // typically means most cards have no probabilityPercent / askedInCatalogs).
  const signals = inspectDistribution(cards);

  const handleApply = async () => {
    if (busy) return;
    if (overwrite) {
      const ok = window.confirm(
        `⚠️ Überschreiben aktiviert!\n\nAlle ${cards.length} Karten werden gemäß Auto-Heuristik neu klassifiziert. ` +
        `Manuelle Einstellungen werden ÜBERSCHRIEBEN.\n\nFortfahren?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try { await onApply(overwrite); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-white flex items-center gap-2">🎯 A/B/C-Priorisierung</h3>
        <p className="text-xs text-[#9ca3af] mt-0.5 leading-relaxed">
          Automatische Einstufung deiner Karten nach Prüfungsrelevanz, basierend auf Klassiker-Score, Häufigkeit
          und manuellen Flaggings. Du kannst einzelne Karten beim Lernen jederzeit umstufen.
        </p>
      </div>

      {/* Existing distribution */}
      {(existing.A + existing.B + existing.C) > 0 && (
        <div className="bg-[#252840] rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">Aktuelle Verteilung</p>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <PriorityCount label="A" count={existing.A} color="bg-red-500" />
            <PriorityCount label="B" count={existing.B} color="bg-amber-400" />
            <PriorityCount label="C" count={existing.C} color="bg-slate-400" />
            <PriorityCount label="—" count={existing.none} color="bg-[#3d4168]" />
          </div>
        </div>
      )}

      {/* Preview after auto-classify */}
      <div className="bg-[#252840] rounded-xl p-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-purple-300/80 uppercase tracking-wider">
          Vorschau nach Auto-Klassifikation
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <PriorityCount label="A" count={preview.A} color="bg-red-500" />
          <PriorityCount label="B" count={preview.B} color="bg-amber-400" />
          <PriorityCount label="C" count={preview.C} color="bg-slate-400" />
        </div>
        {preview.preserved > 0 && !overwrite && (
          <p className="text-[10px] text-amber-300/80 leading-relaxed">
            ⚠️ {preview.preserved} Karten haben bereits eine Priorität und bleiben unverändert.
            Aktiviere "Überschreiben" um eine frische Klassifikation zu starten.
          </p>
        )}
      </div>

      {/* Signal-Diagnose */}
      <details className="bg-[#252840] rounded-xl text-xs">
        <summary className="cursor-pointer hover:bg-[#2a2d45] p-3 font-semibold text-[#9ca3af] uppercase tracking-wider text-[10px]">
          🔬 Daten-Diagnose anzeigen
        </summary>
        <div className="px-3 pb-3 space-y-2 leading-relaxed">
          <p className="text-[#9ca3af]">
            So sieht's in deinen Karten-Daten aus — hilft zu verstehen warum Karten in dieser Verteilung landen:
          </p>
          <div className="space-y-1 font-mono text-[11px] text-[#d1d5db]">
            <p>Klassiker-Score (probabilityPercent):</p>
            <p className="pl-3">≥50% : {signals.byProbability.ge50.toString().padStart(5)} Karten</p>
            <p className="pl-3">25–49%: {signals.byProbability.ge25.toString().padStart(5)} Karten</p>
            <p className="pl-3">10–24%: {signals.byProbability.ge10.toString().padStart(5)} Karten</p>
            <p className="pl-3">1–9%  : {signals.byProbability.ge1.toString().padStart(5)} Karten</p>
            <p className="pl-3">0%    : {signals.byProbability.eq0.toString().padStart(5)} Karten</p>
            <p className="mt-2">Andere Signale:</p>
            <p className="pl-3">Mit Katalog/Häufigkeits-Daten: {signals.withCatalogData}</p>
            <p className="pl-3">Geflaggt: {signals.flaggedCount}</p>
            <p className="pl-3">Komplett ohne Signal: {signals.noSignalAtAll} ← landet in C</p>
          </div>
          {signals.noSignalAtAll > signals.total * 0.5 && (
            <p className="text-amber-300/80 text-[11px] mt-2">
              💡 Über die Hälfte deiner Karten hat gar keine Häufigkeits-/Klassiker-Daten.
              Das ist normal wenn du Karten manuell erstellt hast — die landen automatisch in C.
              Stuf sie beim Lernen einfach manuell um wenn nötig.
            </p>
          )}
        </div>
      </details>

      {/* Overwrite toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={e => setOverwrite(e.target.checked)}
          className="accent-red-500 w-4 h-4"
        />
        <div>
          <p className="text-sm text-white">Manuelle Einstellungen überschreiben</p>
          <p className="text-[11px] text-[#9ca3af]">
            Standardmäßig: nur Karten ohne bisherige Priorität werden gesetzt.
          </p>
        </div>
      </label>

      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={busy || cards.length === 0}
          className="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center gap-2"
        >
          {busy ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Klassifiziere…
            </>
          ) : (
            <>📊 Automatisch klassifizieren</>
          )}
        </button>
      </div>

      <details className="text-[11px] text-[#6b7280]">
        <summary className="cursor-pointer hover:text-[#9ca3af]">Wie funktioniert die Heuristik?</summary>
        <ul className="mt-1.5 space-y-1 leading-relaxed pl-3">
          <li>· <strong className="text-red-300">A</strong>: Klassiker (≥60%), geflaggte Karten, oder oft+schwer</li>
          <li>· <strong className="text-amber-300">B</strong>: Mittelfeld — ein gewisses Maß an Häufigkeit/Relevanz</li>
          <li>· <strong className="text-slate-300">C</strong>: Niedrige Wahrscheinlichkeit, selten/nie gestellt</li>
        </ul>
      </details>
    </div>
  );
}

function PriorityCount({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-white font-mono">{count}</span>
      <span className="text-[#6b7280]">{label}</span>
    </div>
  );
}

// ─── Data normalization (Stats migration) ──────────────────────────────────
function NormalizeStatsSection({
  cards,
  onApply,
}: {
  cards: Flashcard[];
  onApply: () => Promise<NormalizationSummary>;
}) {
  const [busy, setBusy] = useState(false);
  // Live preview — computed on every render, cheap pure function
  const { summary } = normalizeAll(cards);

  const handleApply = async () => {
    if (busy) return;
    if (summary.totalAffected === 0) return;
    const ok = window.confirm(
      `🧹 Daten-Normalisierung\n\n` +
      `${summary.totalAffected} Karten werden bearbeitet:\n` +
      `• ${summary.catalogTagsMovedTotal} "#Fragenkatalog YYYY"-Tags werden in 'In Katalogen' verschoben\n` +
      `• ${summary.cardsWithExaminersFilled} Karten: Prüfer-Daten gespiegelt\n` +
      `• ${summary.cardsWithTimesAskedSet} Karten: Häufigkeit (timesAsked) berechnet\n` +
      `• ${summary.cardsWithProbabilityComputed} Karten: Wahrscheinlichkeit berechnet\n\n` +
      `Karten mit bereits gesetzten Werten bleiben unangetastet.\n\n` +
      `Fortfahren?`
    );
    if (!ok) return;
    setBusy(true);
    try { await onApply(); }
    finally { setBusy(false); }
  };

  const nothingToDo = summary.totalAffected === 0;

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-white flex items-center gap-2">🧹 Daten normalisieren</h3>
        <p className="text-xs text-[#9ca3af] mt-0.5 leading-relaxed">
          Räumt Karten-Daten auf: zieht <code className="text-[#d1d5db]">#Fragenkatalog YYYY</code>-Tags
          in das dedizierte Katalog-Feld, spiegelt Prüfer-Daten in die Stats-Felder und berechnet fehlende
          Häufigkeit + Wahrscheinlichkeit aus den Daten.
        </p>
      </div>

      {/* Preview */}
      <div className="bg-[#252840] rounded-xl p-3 space-y-2 text-xs">
        <p className="text-[10px] font-semibold text-purple-300/80 uppercase tracking-wider">
          Vorschau — was würde passieren
        </p>
        {nothingToDo ? (
          <p className="text-green-400">✨ Deine Daten sind bereits sauber, nichts zu tun.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[#d1d5db]">
              <p>📌 <strong className="text-white">{summary.totalAffected}</strong> von {cards.length} Karten betroffen</p>
              <p>📅 <strong className="text-white">{summary.catalogTagsMovedTotal}</strong> Tag(s) umgezogen</p>
              <p>👥 <strong className="text-white">{summary.cardsWithExaminersFilled}</strong> Prüfer-Spiegelungen</p>
              <p>🔁 <strong className="text-white">{summary.cardsWithTimesAskedSet}</strong> Häufigkeiten berechnet</p>
              <p>📊 <strong className="text-white">{summary.cardsWithProbabilityComputed}</strong> Wahrscheinlichkeiten berechnet</p>
              <p>📚 <strong className="text-white">{summary.globalCatalogYearCount}</strong> Katalogjahre gefunden</p>
            </div>
            {summary.globalCatalogYears.length > 0 && (
              <p className="text-[10px] text-[#6b7280]">
                Erkannte Jahre: {summary.globalCatalogYears.join(', ')}
              </p>
            )}
          </>
        )}
      </div>

      <button
        onClick={handleApply}
        disabled={busy || nothingToDo}
        className="text-sm px-4 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center gap-2"
      >
        {busy ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Normalisiere…
          </>
        ) : nothingToDo ? (
          <>✅ Daten sind sauber</>
        ) : (
          <>🧹 Jetzt normalisieren</>
        )}
      </button>

      <details className="text-[11px] text-[#6b7280]">
        <summary className="cursor-pointer hover:text-[#9ca3af]">Was wird konkret verändert?</summary>
        <ul className="mt-1.5 space-y-1 leading-relaxed pl-3">
          <li>· <strong>Katalogjahre</strong>: <code>#Fragenkatalog 2024</code>-Tags wandern aus
            "Tags" in das Feld "In Katalogen" — saubere Trennung, Tags bleiben für echte Tags reserviert.</li>
          <li>· <strong>Prüfer-Spiegelung</strong>: Wenn das Stats-Feld <code>askedByExaminers</code> leer ist,
            wird's mit den ausgewählten <code>examiners</code> befüllt.</li>
          <li>· <strong>Häufigkeit</strong>: Wenn nicht importiert, wird timesAsked aus
            max(Katalogjahre, Prüfer) berechnet. Importierte Werte gewinnen.</li>
          <li>· <strong>Wahrscheinlichkeit</strong>: Wenn nicht importiert, berechnet aus
            "Katalogjahre der Karte / Gesamt-Katalogjahre × 100". Importierte Werte gewinnen.</li>
        </ul>
      </details>
    </div>
  );
}

// ─── Daily-Limit Section ─────────────────────────────────────────────────────
// Preset-Picker + optional Custom-Tuning. Erklärt Anfängern, was "neue Karten"
// und "Wiederholungen" sind und warum man Reviews NICHT cappen sollte.
function DailyLimitSection({
  settings,
  dailyGoalInput,
  setDailyGoalInput,
  reviewCapInput,
  setReviewCapInput,
  handleDailyGoalBlur,
  handleReviewCapBlur,
  hasExamDate,
  pace,
  unseenCount,
  onUpdateSettings,
  showToast,
}: {
  settings: AppSettings;
  dailyGoalInput: string;
  setDailyGoalInput: (v: string) => void;
  reviewCapInput: string;
  setReviewCapInput: (v: string) => void;
  handleDailyGoalBlur: () => void;
  handleReviewCapBlur: () => void;
  hasExamDate: boolean;
  pace: ReturnType<typeof calculatePaceMetrics> | null;
  unseenCount: number;
  onUpdateSettings: (u: Partial<AppSettings>) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const detectedPreset = detectActivePreset(settings);
  // "Custom" can be either detected (current values match no preset) or
  // explicitly chosen by the user (they clicked "Eigene Werte" to tune even
  // though their values happen to match a preset). The local state lets us
  // open the custom block on demand without modifying settings.
  const [forceCustom, setForceCustom] = useState(false);
  const activePreset: PresetId = forceCustom ? 'custom' : detectedPreset;

  const applyPreset = (p: Preset) => {
    if (p.requiresExamDate && !hasExamDate) {
      showToast('Erst Prüfungsdatum setzen für Auto-Pace', 'info');
      return;
    }
    if (p.id === 'custom') {
      // Open the custom block. Don't touch any settings — user's existing
      // values stay as they are, they're just free to tune them now.
      setForceCustom(true);
      return;
    }
    if (!p.apply) return;
    setForceCustom(false);          // reverting to a preset clears the override
    const patch = p.apply();
    onUpdateSettings(patch);
    // Keep the local input states in sync so the custom-block (if user switches
    // to it next) shows the just-applied values.
    if (typeof patch.dailyNewCardGoal === 'number') setDailyGoalInput(String(patch.dailyNewCardGoal));
    if (typeof patch.dailyReviewCap === 'number') {
      setReviewCapInput(patch.dailyReviewCap >= 9999 ? '' : String(patch.dailyReviewCap));
    }
    showToast(`Modus: ${p.emoji} ${p.label}`, 'success');
  };

  const showCustomBlock = activePreset === 'custom';

  const newPerDayDisplay = settings.dailyNewCardGoalMode === 'auto' && pace
    ? pace.requiredNewPerDay
    : settings.dailyNewCardGoal;
  const reviewCapDisplay = (settings.dailyReviewCap ?? 9999) >= 9999
    ? 'unbegrenzt'
    : `max. ${settings.dailyReviewCap}`;

  // Warning when the configured pace can't finish all cards in time
  const paceTooSlow = hasExamDate && pace && pace.requiredNewPerDay > newPerDayDisplay;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
          Tageslimit
        </label>
        <InfoTooltip text="Wieviele Karten am Tag — bestimmt nur wieviele NEUE Karten eingeführt werden. Wiederholungen kommen immer wenn fällig, sonst staut sich der SRS-Rhythmus." />
      </div>

      {/* Preset picker */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {PRESETS.map(p => {
          const active = activePreset === p.id;
          const disabled = p.requiresExamDate && !hasExamDate;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              disabled={disabled}
              title={disabled ? 'Erst Prüfungsdatum oben setzen' : undefined}
              className={`text-left px-3 py-3 rounded-xl border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                active
                  ? 'bg-indigo-500/15 border-indigo-500/60 ring-1 ring-indigo-500/30'
                  : 'bg-[#252840] border-[#2d3148] hover:border-indigo-500/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-lg">{p.emoji}</span>
                <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-[#d1d5db]'}`}>{p.label}</p>
              </div>
              <p className="text-[11px] text-[#9ca3af] mt-1 leading-snug">{p.tagline}</p>
            </button>
          );
        })}
      </div>

      {/* Status of current selection */}
      <div className="bg-[#15172a] border border-[#2d3148] rounded-xl p-3 space-y-1">
        <p className="text-[11px] uppercase tracking-wider text-[#6b7280] font-semibold">Aktuelle Konfiguration</p>
        <ul className="text-sm text-[#d1d5db] space-y-0.5">
          <li>→ <span className="text-white font-semibold">{newPerDayDisplay}</span> neue Karten / Tag
            {settings.dailyNewCardGoalMode === 'auto' && (
              <span className="text-[10px] text-amber-400 ml-1.5">(auto-berechnet)</span>
            )}
          </li>
          <li>→ Wiederholungen: <span className="text-white font-semibold">{reviewCapDisplay}</span>
            <span className="text-[11px] text-[#6b7280] ml-1.5">(was SRS fällig stellt)</span>
          </li>
          {hasExamDate && pace && (
            <li>→ Prognose zum Examen: <span className={`font-semibold ${
              pace.masteryRateAtExam >= 90 ? 'text-emerald-400' :
              pace.masteryRateAtExam >= 70 ? 'text-amber-400' : 'text-red-400'
            }`}>{pace.masteryRateAtExam}% beherrscht</span>
          </li>
          )}
        </ul>
      </div>

      {/* Warning when configured pace can't finish in time */}
      {paceTooSlow && pace && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3">
          <span className="text-xl shrink-0 mt-0.5">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">
              Mit dem aktuellen Tempo schaffst du nicht alle Karten bis zur Prüfung
            </p>
            <p className="text-xs text-[#9ca3af] mt-0.5">
              {unseenCount} ungesehene Karten ÷ {pace.effectiveDays} Tage = {pace.requiredNewPerDay} neue/Tag nötig.
              Du hast aktuell {newPerDayDisplay} eingestellt.
            </p>
          </div>
          <button
            onClick={() => {
              onUpdateSettings({ dailyNewCardGoalMode: 'auto', dailyReviewCap: 9999 });
              showToast(`Modus: 🎯 Auto-Pace`, 'success');
            }}
            className="ml-auto shrink-0 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold transition-colors"
          >
            Auto-Pace
          </button>
        </div>
      )}

      {/* Custom-tuning block — only when 'Eigene Werte' is active */}
      {showCustomBlock && (
        <div className="bg-[#15172a] border border-[#2d3148] rounded-xl p-4 space-y-4">
          <p className="text-xs text-[#9ca3af] leading-relaxed">
            ⚙️ Justiere selbst — diese Werte stecken auch hinter den Presets oben.
          </p>

          {/* Neue Karten / Tag */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                Neue Karten pro Tag
              </label>
              <InfoTooltip text="Karten, die du noch nie gesehen hast. Beim Lernen werden diese in den Tagesablauf gemischt." />
            </div>

            <div className="flex gap-1 p-0.5 mb-2 rounded-xl bg-[#252840] border border-[#2d3148]">
              {(['manual', 'auto'] as const).map(mode => {
                const active = (settings.dailyNewCardGoalMode ?? 'manual') === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onUpdateSettings({ dailyNewCardGoalMode: mode })}
                    disabled={mode === 'auto' && !hasExamDate}
                    title={mode === 'auto' && !hasExamDate ? 'Erst Prüfungsdatum oben setzen' : undefined}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                      active ? 'bg-indigo-500 text-white' : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {mode === 'manual' ? 'Fester Wert' : '⚡ Auto-Pace'}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={dailyGoalInput}
                onChange={e => setDailyGoalInput(e.target.value)}
                onBlur={handleDailyGoalBlur}
                onKeyDown={e => e.key === 'Enter' && handleDailyGoalBlur()}
                disabled={settings.dailyNewCardGoalMode === 'auto'}
                className="w-full sm:w-32 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-[#6b7280] text-sm">/ Tag</span>
            </div>
            <p className="text-xs text-[#6b7280] mt-1.5 leading-relaxed">
              {settings.dailyNewCardGoalMode === 'auto'
                ? '⚡ Wird automatisch berechnet. Passt sich an, wenn du im Plan vor oder zurückliegst.'
                : 'Fester Wert. Wenn keine neuen Karten mehr da sind, kommen nur noch fällige Wiederholungen.'}
            </p>
          </div>

          {/* Wiederholungs-Cap */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                Max. Wiederholungen pro Tag
              </label>
              <InfoTooltip text="Wir empfehlen 'leer lassen' = kein Limit. Wenn du Wiederholungen cappst, verfallen sie nicht — sie stapeln sich nur jeden Tag mehr. Nur sinnvoll, wenn du gerade einen alten Backup importiert hast und Anfangs nicht überrollt werden willst." />
            </div>
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
                className="w-full sm:w-32 text-sm bg-[#252840] border border-[#2d3148] rounded-xl px-3 py-2 text-white placeholder-[#4b5563] focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-[#6b7280] text-sm">/ Tag</span>
            </div>
            <p className="text-xs text-amber-400/80 mt-1.5 leading-relaxed">
              💡 Empfehlung: leer lassen. Ein Cap auf Wiederholungen baut Tag für Tag Backlog auf und schwächt den SRS-Effekt.
              Nur sinnvoll für die ersten Tage nach einem Import mit vielen alten Karten.
            </p>
          </div>
        </div>
      )}

      {/* Detail panel — SM-2 metrics, collapsible */}
      {hasExamDate && pace && (
        <details className="bg-[#15172a] border border-[#2d3148] rounded-xl">
          <summary className="cursor-pointer hover:bg-[#1a1d2e] p-3 text-xs font-semibold text-[#9ca3af] uppercase tracking-wider transition-colors">
            🔬 Details zum berechneten Lerntempo
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#252840] rounded-lg px-3 py-2.5 text-center">
                <p className="text-base font-bold text-white">{pace.requiredNewPerDay}</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Neue/Tag empfohlen</p>
              </div>
              <div className="bg-[#252840] rounded-lg px-3 py-2.5 text-center">
                <p className="text-base font-bold text-indigo-300">~{pace.estimatedDailyReviews}</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Wdh./Tag geschätzt</p>
              </div>
              <div className={`rounded-lg px-3 py-2.5 text-center ${
                pace.masteryRateAtExam >= 90 ? 'bg-emerald-500/10' :
                pace.masteryRateAtExam >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10'
              }`}>
                <p className={`text-base font-bold ${
                  pace.masteryRateAtExam >= 90 ? 'text-emerald-400' :
                  pace.masteryRateAtExam >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>{pace.masteryRateAtExam}%</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5 uppercase tracking-wide">Beherrscht zum Tag X</p>
              </div>
            </div>
            <p className="text-[11px] text-[#6b7280] leading-relaxed">
              Berechnung: {unseenCount} ungesehene Karten ÷ {pace.effectiveDays} verfügbare Tage
              (SM-2 braucht ~15 Tage für 3 Wiederholungen je Karte, daher wird das vom Examenstag abgezogen).
              „Wdh./Tag" ist eine Simulation deiner Bibliothek durch den Anki-Algorithmus.
              „Beherrscht" = Karten mit ≥3 erfolgreichen Wiederholungen am Examenstag.
            </p>
          </div>
        </details>
      )}

      {/* New-user explainer */}
      <details className="bg-[#0f1117] border border-[#2d3148] rounded-xl">
        <summary className="cursor-pointer hover:bg-[#15172a] p-3 text-xs font-semibold text-indigo-400 uppercase tracking-wider transition-colors">
          💡 Wie funktioniert das Tageslimit?
        </summary>
        <div className="px-3 pb-3 space-y-2 text-xs text-[#d1d5db] leading-relaxed">
          <p>
            <strong className="text-white">Neue Karten</strong> sind Karten, die du noch nie gesehen hast.
            Sie werden langsam in dein Lernpensum eingeführt — du legst fest, wieviele pro Tag.
          </p>
          <p>
            <strong className="text-white">Wiederholungen</strong> sind Karten, die du schon gelernt hast und
            nach dem SRS-Algorithmus heute wieder ansehen solltest, damit sie nicht in Vergessenheit geraten.
            Wieviele das jeden Tag sind, ergibt sich automatisch aus dem, was du in den Tagen davor gelernt hast.
          </p>
          <p>
            <strong className="text-white">Warum gibt's kein „Maximum 5 Karten heute"-Setting?</strong>
            {' '}Weil Wiederholungen nicht warten können — wenn du sie weglässt, vergisst du was du schon kannst.
            Cap nur die neuen Karten — Wiederholungen kommen geduldig durch wie sie sollen.
          </p>
          <p className="pt-1 border-t border-[#2d3148] mt-2">
            <strong className="text-indigo-400">Welcher Modus passt zu mir?</strong>
          </p>
          <ul className="space-y-1 pl-1">
            <li>🌿 <strong>Entspannt</strong> — wenn du keinen Druck hast und langsam aufbauen willst</li>
            <li>📚 <strong>Standard</strong> — gut für die meisten Lern-Routinen</li>
            <li>⚡ <strong>Intensiv</strong> — kurz vor der Prüfung oder bei großem Karten-Stapel</li>
            <li>🎯 <strong>Auto-Pace</strong> — wenn du ein Examensdatum gesetzt hast und die App selbst rechnen lassen willst</li>
            <li>⚙️ <strong>Eigene Werte</strong> — für alle die's genau einstellen wollen</li>
          </ul>
        </div>
      </details>
    </div>
  );
}

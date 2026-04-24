import { useMemo } from 'react';
import {
  ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import type { Flashcard, AppSettings } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { calculateDailyPlan, getCardsRatedToday } from '../utils/dailyGoal';
import ProbabilityBadge from '../components/ProbabilityBadge';
import SrsLevelGrid, { type SrsKey } from '../components/SrsLevelGrid';

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  onNavigate: (page: string) => void;
  onNavigateToLibraryWithSrs: (srs: string) => void;
  onStartDailySession: () => void;
  onDismissUnflagNotification: () => void;
  onEditCard: (card: Flashcard) => void;
}


export default function Dashboard({ cards, settings, onNavigate, onNavigateToLibraryWithSrs, onStartDailySession, onDismissUnflagNotification, onEditCard }: Props) {
  const today = new Date().toDateString();
  const snap = settings.dailyPlanSnapshot;

  // How many new cards were already introduced today (drives the remaining-quota calc)
  const newDoneToday = snap?.date === today ? (snap.newCardsDone ?? 0) : 0;

  // Pass newDoneToday so the plan reflects remaining work, not the original full quota
  const plan = useMemo(
    () => calculateDailyPlan(cards, settings, newDoneToday),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, settings, newDoneToday],
  );

  // Use snapshot totalDone when available (accurate: only counts rating >= 1, incl. Schwer).
  // Always fall back to card-state count — covers the case where the user rated cards
  // outside the daily-plan flow (no snapshot), so the progress bar still reflects real work.
  const ratedToday = snap?.date === today
    ? (snap.totalDone ?? getCardsRatedToday(cards))
    : getCardsRatedToday(cards);

  const stats = useMemo(() => {
    const due = cards.filter(isDueToday);
    const srsGroups = { neu: 0, lernend: 0, wiederholen: 0, beherrscht: 0 };
    cards.forEach(c => srsGroups[getSRSStatus(c)]++);

    const bySubject = settings.subjects.reduce<Record<string, { total: number; due: number; mastered: number }>>((acc, s) => {
      const subCards = cards.filter(c => c.subjects?.includes(s));
      if (subCards.length === 0) return acc;
      acc[s] = {
        total: subCards.length,
        due: subCards.filter(isDueToday).length,
        mastered: subCards.filter(c => getSRSStatus(c) === 'beherrscht').length,
      };
      return acc;
    }, {});

    return { due, srsGroups, bySubject, total: cards.length };
  }, [cards, settings.subjects]);

  const subjectData = Object.entries(stats.bySubject).map(([name, d]) => ({
    name: name.length > 12 ? name.slice(0, 12) + '…' : name,
    Gelernt: d.mastered,
    Ausstehend: d.due,
    Neu: d.total - d.mastered - d.due,
  }));

  const topKlassiker = useMemo(() =>
    cards
      .filter(c => (c.probabilityPercent ?? 0) > 0)
      .sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0))
      .slice(0, 5),
    [cards]
  );

  const unflagNotif = settings.autoUnflagNotification;
  const showUnflagBanner = unflagNotif &&
    unflagNotif.date === new Date().toDateString() &&
    !unflagNotif.dismissed;

  // Progress bar for today's goal.
  // Prefer snapshot total (set at session-start and accounts for all planned work).
  // If no snapshot yet, compute it as ratedToday + remaining planned — so the bar
  // already reflects reviews done before the user pressed "Jetzt lernen".
  const snapshotTotal = snap?.date === today ? snap.totalCards : ratedToday + plan.totalToday;
  const progressTotal = Math.max(snapshotTotal, ratedToday);
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((ratedToday / progressTotal) * 100)) : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Dein Lernfortschritt auf einen Blick</p>
      </div>

      {showUnflagBanner && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-green-400 text-sm font-medium">
            ✅ {unflagNotif!.count} Flagge{unflagNotif!.count !== 1 ? 'n' : ''} heute automatisch entfernt
          </p>
          <button
            onClick={onDismissUnflagNotification}
            className="text-green-600 hover:text-green-400 text-lg leading-none transition-colors shrink-0"
          >✕</button>
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard value={stats.total} label="Karten gesamt" icon="🃏" color="text-white" bg="bg-[#1e2130] border-[#2d3148]" />
        <StatCard
          value={stats.due.length}
          label="Fällig heute"
          icon="📅"
          color={stats.due.length > 0 ? 'text-indigo-400' : 'text-white'}
          bg={stats.due.length > 0 ? 'bg-indigo-500/10 border-indigo-500/30 pulse-glow' : 'bg-[#1e2130] border-[#2d3148]'}
          onClick={() => onNavigate('study')}
          breakdown={stats.due.length > 0 ? [
            { icon: '🔄', label: 'Wdh.', value: plan.reviewCards.length, color: 'text-amber-300' },
            { icon: '✨', label: 'Neu',  value: plan.newCards.length,    color: 'text-purple-300' },
          ] : undefined}
        />
        <StatCard value={stats.srsGroups.beherrscht} label="Beherrscht" icon="✅" color="text-green-400" bg="bg-[#1e2130] border-[#2d3148]" />
        <StatCard value={`${settings.studyStreak}🔥`} label="Lerntage in Folge" icon="" color="text-amber-400" bg="bg-[#1e2130] border-[#2d3148]" />
      </div>

      {/* Exam Countdown Widget */}
      <ExamCountdownWidget plan={plan} settings={settings} onNavigate={onNavigate} />

      {/* Top Klassiker Widget */}
      {topKlassiker.length > 0 && (
        <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">🔥 Top Klassiker</h3>
            <span className="text-xs text-[#6b7280]">Häufigste Prüfungsfragen</span>
          </div>
          <div className="space-y-2">
            {topKlassiker.map(card => (
              <button
                key={card.id}
                onClick={() => onEditCard(card)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] hover:border-indigo-500/30 transition-all text-left group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{card.front || '(leer)'}</p>
                  {card.subjects?.length > 0 && (
                    <p className="text-xs text-[#6b7280] mt-0.5">{card.subjects[0]}</p>
                  )}
                </div>
                <ProbabilityBadge pct={card.probabilityPercent!} size="xs" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Daily Goal Card */}
      {settings.examDate && !plan.examPassed && (
        <DailyGoalCard
          plan={plan}
          ratedToday={ratedToday}
          progressPct={progressPct}
          progressTotal={progressTotal}
          onStart={onStartDailySession}
        />
      )}

      {/* Legacy due-today banner (only if no exam set) */}
      {!settings.examDate && stats.due.length > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-indigo-300 font-semibold text-lg">
              {stats.due.length} {stats.due.length === 1 ? 'Karte' : 'Karten'} zur Wiederholung
            </p>
            <p className="text-indigo-400/70 text-sm mt-0.5">Jetzt lernen und Streak aufrechterhalten!</p>
          </div>
          <button
            onClick={() => onNavigate('study')}
            className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Jetzt lernen →
          </button>
        </div>
      )}

      {/* SRS Level Breakdown — clickable cards */}
      {cards.length > 0 && (
        <SrsLevelGrid
          srsGroups={stats.srsGroups}
          total={stats.total}
          onLevelClick={(srs: SrsKey) => onNavigateToLibraryWithSrs(srs)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        {subjectData.length > 0 && (
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">Fächer</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={subjectData} barSize={12}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#1e2130', border: '1px solid #2d3148', borderRadius: '8px', color: '#e8eaf0', fontSize: 12 }} cursor={{ fill: 'rgba(99,102,241,0.05)' }} />
                <Bar dataKey="Gelernt"    fill="#22c55e" radius={[2,2,0,0]} stackId="a" />
                <Bar dataKey="Ausstehend" fill="#f59e0b" radius={[0,0,0,0]} stackId="a" />
                <Bar dataKey="Neu"        fill="#6366f1" radius={[2,2,0,0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {cards.length === 0 && (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">🃏</p>
          <p className="text-xl font-semibold text-white">Keine Karten vorhanden</p>
          <p className="text-[#9ca3af] mt-2 mb-6">Erstelle deine erste Karteikarte und beginne zu lernen!</p>
          <button onClick={() => onNavigate('new-card')} className="bg-indigo-500 hover:bg-indigo-400 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
            + Erste Karte erstellen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Exam Countdown Widget ────────────────────────────────────

function ExamCountdownWidget({ plan, settings, onNavigate }: {
  plan: ReturnType<typeof calculateDailyPlan>;
  settings: AppSettings;
  onNavigate: (p: string) => void;
}) {
  if (!settings.examDate) {
    return (
      <div className="bg-[#1e2130] border border-dashed border-[#2d3148] rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-white font-medium">📅 Kein Prüfungsdatum gesetzt</p>
          <p className="text-[#9ca3af] text-sm mt-0.5">Setze ein Datum um den Countdown und Tagesplan zu aktivieren</p>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          className="text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-4 py-2 rounded-xl transition-colors"
        >
          Jetzt einstellen →
        </button>
      </div>
    );
  }

  if (plan.examPassed) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 text-center">
        <p className="text-3xl mb-1">🎉</p>
        <p className="text-white font-semibold">Prüfung vorbei!</p>
        <p className="text-[#9ca3af] text-sm mt-1">Hoffentlich lief alles gut.</p>
      </div>
    );
  }

  if (plan.allLearned) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 text-center">
        <p className="text-3xl mb-1">🏆</p>
        <p className="text-white font-semibold">Alle Karten beherrscht!</p>
        <p className="text-[#9ca3af] text-sm mt-1">Du bist bestens vorbereitet.</p>
      </div>
    );
  }

  const days = plan.daysUntilExam!;
  const urgencyColor = days <= 3 ? 'border-red-500/40 bg-red-500/5' :
                       days <= 7 ? 'border-amber-500/40 bg-amber-500/5' :
                       'border-indigo-500/30 bg-indigo-500/5';
  const daysColor = days <= 3 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-indigo-400';
  const examDateFormatted = new Date(settings.examDate!).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`border rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4 ${urgencyColor}`}>
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-black ${daysColor} leading-none`}>{days}</div>
        <div>
          <p className="text-white font-semibold">
            {days === 1 ? 'Tag' : 'Tage'} bis zur Prüfung
          </p>
          <p className="text-[#9ca3af] text-sm">{examDateFormatted}</p>
          {plan.isAheadOfSchedule && (
            <p className="text-green-400 text-xs mt-0.5">✓ Im Zeitplan</p>
          )}
        </div>
      </div>
      {days <= 7 && (
        <div className={`text-xs font-semibold px-3 py-1.5 rounded-full ${days <= 3 ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
          {days <= 3 ? '⚡ Endspurt!' : '📚 Letzte Woche'}
        </div>
      )}
    </div>
  );
}

// ─── Daily Goal Card ─────────────────────────────────────────

function DailyGoalCard({ plan, ratedToday, progressPct, progressTotal, onStart }: {
  plan: ReturnType<typeof calculateDailyPlan>;
  ratedToday: number;
  progressPct: number;
  progressTotal: number;
  onStart: () => void;
}) {
  const goalDone = ratedToday >= progressTotal && progressTotal > 0;
  const totalToday = plan.reviewCards.length + plan.newCards.length;

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-white">Tagesziel</h3>
        {goalDone && (
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">
            ✅ Tagesziel erreicht!
          </span>
        )}
      </div>

      {/* Main counters */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#252840] rounded-xl p-3">
          <p className="text-2xl font-bold text-amber-400">{plan.reviewCards.length}</p>
          <p className="text-xs text-[#9ca3af] mt-0.5">✅ Zu wiederholen</p>
          {plan.reviewOverflow > 0 && (
            <p className="text-[10px] text-amber-500/70 mt-1">+{plan.reviewOverflow} auf morgen verschoben</p>
          )}
        </div>
        <div className="bg-[#252840] rounded-xl p-3">
          <p className="text-2xl font-bold text-indigo-400">{plan.newCards.length}</p>
          <p className="text-xs text-[#9ca3af] mt-0.5">🆕 Neu heute</p>
        </div>
      </div>

      {/* SM-2 pace row */}
      {plan.newCardsPerDay > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-[#252840]/60 rounded-lg px-2 py-2">
            <p className="text-sm font-semibold text-indigo-300">{plan.newCardsPerDay}</p>
            <p className="text-[10px] text-[#6b7280] mt-0.5">Neu / Tag</p>
          </div>
          <div className="bg-[#252840]/60 rounded-lg px-2 py-2">
            <p className="text-sm font-semibold text-indigo-300">~{plan.estimatedDailyReviews}</p>
            <p className="text-[10px] text-[#6b7280] mt-0.5">Wdh. / Tag</p>
          </div>
          <div className={`rounded-lg px-2 py-2 ${
            plan.masteryRateAtExam >= 90 ? 'bg-emerald-500/10' :
            plan.masteryRateAtExam >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10'
          }`}>
            <p className={`text-sm font-semibold ${
              plan.masteryRateAtExam >= 90 ? 'text-emerald-400' :
              plan.masteryRateAtExam >= 70 ? 'text-amber-400' : 'text-red-400'
            }`}>{plan.masteryRateAtExam}%</p>
            <p className="text-[10px] text-[#6b7280] mt-0.5">Prognose</p>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progressTotal > 0 && (
        <div>
          <div className="flex justify-between text-xs text-[#9ca3af] mb-1.5">
            <span>{ratedToday} von {progressTotal} erledigt</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-[#252840] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: progressPct >= 100
                  ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                  : 'linear-gradient(90deg, #6366f1, #818cf8)',
              }}
            />
          </div>
        </div>
      )}

      <button
        onClick={onStart}
        disabled={totalToday === 0}
        className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
      >
        ▶ Jetzt lernen
        {totalToday > 0 && (
          <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{totalToday} Karten</span>
        )}
      </button>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

interface StatCardProps {
  value: number | string; label: string; icon: string;
  color: string; bg: string; onClick?: () => void;
  breakdown?: Array<{ icon: string; label: string; value: number; color?: string }>;
}
function StatCard({ value, label, icon, color, bg, onClick, breakdown }: StatCardProps) {
  return (
    <div
      className={`${bg} border rounded-2xl p-4 transition-all duration-200 ${onClick ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-3xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-[#9ca3af] mt-1 leading-tight">{label}</p>
        </div>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      {breakdown && breakdown.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
          {breakdown.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs"
              title={b.label}
            >
              <span>{b.icon}</span>
              <span className={`font-semibold ${b.color ?? 'text-white/90'}`}>{b.value}</span>
              <span className="text-[#6b7280] hidden sm:inline">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


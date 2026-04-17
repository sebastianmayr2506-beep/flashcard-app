import { useMemo } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import type { Flashcard, AppSettings } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { calculateDailyPlan, getCardsRatedToday } from '../utils/dailyGoal';

interface Props {
  cards: Flashcard[];
  settings: AppSettings;
  onNavigate: (page: string) => void;
  onStartDailySession: () => void;
}

const SRS_COLORS: Record<string, string> = {
  neu: '#a855f7', lernend: '#3b82f6', wiederholen: '#f59e0b', beherrscht: '#22c55e',
};
const SRS_LABELS: Record<string, string> = {
  neu: 'Neu', lernend: 'Lernend', wiederholen: 'Wiederholen', beherrscht: 'Beherrscht',
};

export default function Dashboard({ cards, settings, onNavigate, onStartDailySession }: Props) {
  const plan = useMemo(() => calculateDailyPlan(cards, settings), [cards, settings]);
  const ratedToday = useMemo(() => getCardsRatedToday(cards), [cards]);

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

  const srsData = Object.entries(stats.srsGroups)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: SRS_LABELS[k], value: v, color: SRS_COLORS[k] }));

  const subjectData = Object.entries(stats.bySubject).map(([name, d]) => ({
    name: name.length > 12 ? name.slice(0, 12) + '…' : name,
    Gelernt: d.mastered,
    Ausstehend: d.due,
    Neu: d.total - d.mastered - d.due,
  }));

  // Progress bar for today's goal
  const snapshotTotal = (settings.dailyPlanSnapshot?.date === new Date().toDateString())
    ? settings.dailyPlanSnapshot.totalCards
    : plan.totalToday;
  const progressTotal = Math.max(snapshotTotal, ratedToday);
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((ratedToday / progressTotal) * 100)) : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Dein Lernfortschritt auf einen Blick</p>
      </div>

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
        />
        <StatCard value={stats.srsGroups.beherrscht} label="Beherrscht" icon="✅" color="text-green-400" bg="bg-[#1e2130] border-[#2d3148]" />
        <StatCard value={`${settings.studyStreak}🔥`} label="Lerntage in Folge" icon="" color="text-amber-400" bg="bg-[#1e2130] border-[#2d3148]" />
      </div>

      {/* Exam Countdown Widget */}
      <ExamCountdownWidget plan={plan} settings={settings} onNavigate={onNavigate} />

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {srsData.length > 0 && (
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
            <h3 className="font-semibold text-white mb-4">SRS-Status</h3>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={srsData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {srsData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1e2130', border: '1px solid #2d3148', borderRadius: '8px', color: '#e8eaf0' }} formatter={v => [v, '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 flex-1">
                {srsData.map(d => (
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                      <span className="text-sm text-[#9ca3af]">{d.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#252840] rounded-xl p-3">
          <p className="text-2xl font-bold text-amber-400">{plan.reviewCards.length}</p>
          <p className="text-xs text-[#9ca3af] mt-0.5">✅ Zu wiederholen</p>
        </div>
        <div className="bg-[#252840] rounded-xl p-3">
          <p className="text-2xl font-bold text-indigo-400">{plan.newCards.length}</p>
          <p className="text-xs text-[#9ca3af] mt-0.5">🆕 Neu zu lernen</p>
        </div>
      </div>

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
        disabled={plan.totalToday === 0}
        className="w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
      >
        ▶ Jetzt lernen
        {plan.totalToday > 0 && (
          <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{plan.totalToday} Karten</span>
        )}
      </button>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

interface StatCardProps {
  value: number | string; label: string; icon: string;
  color: string; bg: string; onClick?: () => void;
}
function StatCard({ value, label, icon, color, bg, onClick }: StatCardProps) {
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
    </div>
  );
}

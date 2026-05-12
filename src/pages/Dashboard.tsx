import { useMemo } from 'react';
import {
  ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import type { Flashcard, AppSettings } from '../types/card';
import { getSRSStatus, isDueToday } from '../types/card';
import { calculateDailyPlan, getCardsRatedToday, getNewCardsDoneToday } from '../utils/dailyGoal';
import { applyFocus, type FocusMode } from '../utils/priority';
import InfoTooltip from '../components/InfoTooltip';
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
  onSetFocusMode: (m: FocusMode) => void;
}


export default function Dashboard({ cards, settings, onNavigate, onNavigateToLibraryWithSrs, onStartDailySession, onDismissUnflagNotification, onEditCard, onSetFocusMode }: Props) {
  // Focus-Modus filter applied once at the top — every downstream metric
  // (Fällig heute, Tagesziel, Beherrscht, Klassiker, …) operates on this
  // narrowed subset. With focus='all' this is just `cards`, no change.
  const focusMode: FocusMode = settings.focusMode ?? 'all';
  const focusedCards = useMemo(() => applyFocus(cards, focusMode), [cards, focusMode]);
  const isFocused = focusMode !== 'all';

  // Reconciled count via the dedicated firstStudiedAt field — see getNewCardsDoneToday.
  // Note we feed `focusedCards` so "Neu heute" reflects what's in focus.
  const newDoneToday = getNewCardsDoneToday(focusedCards, settings);

  // Pass newDoneToday so the plan reflects remaining work, not the original full quota
  const plan = useMemo(
    () => calculateDailyPlan(focusedCards, settings, newDoneToday),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedCards, settings, newDoneToday],
  );

  // Always derive ratedToday from card state — getCardsRatedToday now uses
  // the (nextReviewDate - updatedAt === interval) heuristic so it can't be
  // inflated by edits/merges/sync events.
  //
  // We deliberately do NOT use snap.totalDone here, even when fresh:
  // session-start bootstraps it via getCardsRatedToday(cards), so a buggy
  // bootstrap (pre-fix) would freeze a wrong number into the snapshot.
  // Card-state is always the truth; the snapshot is just a (now redundant)
  // performance cache. See "getCardsRatedToday over-counted merges/edits"
  // entry in CHANGELOG.
  const ratedToday = getCardsRatedToday(focusedCards);

  const stats = useMemo(() => {
    const due = focusedCards.filter(isDueToday);
    const srsGroups = { neu: 0, lernend: 0, wiederholen: 0, beherrscht: 0 };
    focusedCards.forEach(c => srsGroups[getSRSStatus(c)]++);

    const bySubject = settings.subjects.reduce<Record<string, { total: number; due: number; mastered: number }>>((acc, s) => {
      const subCards = focusedCards.filter(c => c.subjects?.includes(s));
      if (subCards.length === 0) return acc;
      acc[s] = {
        total: subCards.length,
        due: subCards.filter(isDueToday).length,
        mastered: subCards.filter(c => getSRSStatus(c) === 'beherrscht').length,
      };
      return acc;
    }, {});

    return { due, srsGroups, bySubject, total: focusedCards.length, grandTotal: cards.length };
  }, [focusedCards, cards.length, settings.subjects]);

  const subjectData = Object.entries(stats.bySubject).map(([name, d]) => ({
    name: name.length > 12 ? name.slice(0, 12) + '…' : name,
    Gelernt: d.mastered,
    Ausstehend: d.due,
    Neu: d.total - d.mastered - d.due,
  }));

  const topKlassiker = useMemo(() =>
    focusedCards
      .filter(c => (c.probabilityPercent ?? 0) > 0)
      .sort((a, b) => (b.probabilityPercent ?? 0) - (a.probabilityPercent ?? 0))
      .slice(0, 5),
    [focusedCards]
  );

  const unflagNotif = settings.autoUnflagNotification;
  const showUnflagBanner = unflagNotif &&
    unflagNotif.date === new Date().toDateString() &&
    !unflagNotif.dismissed;

  // Progress bar for today's goal.
  //
  // Denominator = what the user *actually* has to do today:
  //   erledigt (ratedToday) + offen (plan.totalToday)
  //
  // This always balances by construction — so the bar matches the two counter
  // tiles above it. A stale snapshot.totalCards is deliberately NOT used here:
  // it used to ratchet up (via Math.max) and never shrank when cards rated
  // "Schwer" got pushed to tomorrow, producing totals like "36 von 61" when
  // the reality was "36 von 48". See chat thread "Progress bar 61 Bug".
  const progressTotal = ratedToday + plan.totalToday;
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((ratedToday / progressTotal) * 100)) : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Dein Lernfortschritt auf einen Blick</p>
      </div>

      {/* Focus-Modus toggle — the motivation engine. When set to A or AB,
          every metric below collapses to that subset so the user sees
          progress-able numbers instead of the overwhelming global view. */}
      <FocusToggle
        focusMode={focusMode}
        onSetFocusMode={onSetFocusMode}
        focusedCount={focusedCards.length}
        totalCount={cards.length}
      />

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
        <StatCard
          value={stats.total}
          label={isFocused ? 'Karten im Fokus' : 'Karten gesamt'}
          icon="🃏"
          color="text-white"
          bg={isFocused ? 'bg-amber-500/5 border-amber-500/20' : 'bg-[#1e2130] border-[#2d3148]'}
          hint={isFocused ? `von ${stats.grandTotal} gesamt` : undefined}
          info={isFocused
            ? `Karten im aktuellen Fokus-Set (${stats.total} von ${stats.grandTotal}). Wechsle auf 'Alle' um den vollen Stand zu sehen.`
            : 'Alle Karten in deiner Bibliothek — egal wann zuletzt gelernt oder fällig.'}
        />
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
          info="Karten, deren nächster Wiederholungstermin auf heute oder früher fällt. Diese werden beim 'Jetzt lernen'-Klick zuerst gezogen — gemixt mit dem heutigen Neu-Karten-Kontingent."
        />
        <StatCard
          value={stats.srsGroups.beherrscht}
          label="Beherrscht"
          icon="✅"
          color="text-green-400"
          bg="bg-[#1e2130] border-[#2d3148]"
          info="Karten im SRS-Status 'Beherrscht': mindestens 5× richtig wiederholt mit großen Intervallen. Tauchen nur noch sehr selten auf — kannst du."
        />
        <StatCard
          value={`${settings.studyStreak}🔥`}
          label="Lerntage in Folge"
          icon=""
          color="text-amber-400"
          bg="bg-[#1e2130] border-[#2d3148]"
          info="Anzahl Tage in Folge, an denen du mindestens eine Karte bewertet hast. Bricht ab, sobald du einen Tag pausierst."
        />
      </div>

      {/* Exam Countdown Widget */}
      <ExamCountdownWidget plan={plan} settings={settings} onNavigate={onNavigate} />

      {/* Top Klassiker Widget */}
      {topKlassiker.length > 0 && (
        <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              🔥 Top Klassiker
              <InfoTooltip
                side="bottom"
                text="Die 5 Karten mit der höchsten Klassiker-Wahrscheinlichkeit — basierend darauf, in wie vielen Katalogjahren / von wie vielen Prüfern die Frage gestellt wurde. Diese kommen sehr wahrscheinlich auch in deiner Prüfung dran."
              />
            </h3>
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
        <h3 className="font-semibold text-white flex items-center gap-2">
          Tagesziel
          <InfoTooltip
            text="Dein vorgeschlagenes Lern-Pensum für heute: fällige Wiederholungen + neue Karten gemäß deinem Tageslimit. Wenn Fokus aktiv ist, nur Karten aus dem Fokus-Set. Mit 'Jetzt lernen' arbeitest du diese Liste durch."
          />
        </h3>
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
  /** Optional small secondary line under the label, e.g. "von 1037 gesamt". */
  hint?: string;
  /** Optional info tooltip — shows an "i"-icon next to label that explains the metric. */
  info?: string;
}
function StatCard({ value, label, icon, color, bg, onClick, breakdown, hint, info }: StatCardProps) {
  return (
    <div
      className={`${bg} border rounded-2xl p-4 transition-all duration-200 ${onClick ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-3xl font-bold ${color}`}>{value}</p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-xs text-[#9ca3af] leading-tight">{label}</p>
            {info && <InfoTooltip side="bottom" text={info} />}
          </div>
          {hint && <p className="text-[10px] text-[#6b7280] mt-0.5">{hint}</p>}
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

// ─── Focus Toggle ────────────────────────────────────────────
// A segmented control + status banner. When focus is on (A / AB) the
// banner gives visual confirmation of what's been narrowed and how many
// cards remain in scope — so the user can quickly verify they're looking
// at the right slice.

function FocusToggle({
  focusMode,
  onSetFocusMode,
  focusedCount,
  totalCount,
}: {
  focusMode: FocusMode;
  onSetFocusMode: (m: FocusMode) => void;
  focusedCount: number;
  totalCount: number;
}) {
  const isFocused = focusMode !== 'all';
  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 ${
        isFocused
          ? 'bg-amber-500/5 border-amber-500/30'
          : 'bg-[#1e2130] border-[#2d3148]'
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            🎯 Fokus
            <InfoTooltip
              side="bottom"
              text="Reduziert die App auf einen Karten-Subset (A oder A+B), damit 'Fällig heute' eine machbare Zahl zeigt statt der überfordernden Gesamtzahl. Andere Karten sind nicht weg — nur ausgeblendet bis du den Fokus wechselst."
            />
            {isFocused && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                aktiv
              </span>
            )}
          </p>
          <p className="text-xs text-[#9ca3af] mt-0.5 leading-relaxed">
            {isFocused
              ? `Du siehst gerade ${focusedCount.toLocaleString()} von ${totalCount.toLocaleString()} Karten — Rest ist parkiert.`
              : 'Du siehst alle Karten. Fokus reduziert auf A oder A+B für einen klaren Tagesziel-Fokus.'}
          </p>
        </div>
      </div>
      {/* Segmented control */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#15172a] border border-[#2d3148]">
        {(['all', 'AB', 'A'] as FocusMode[]).map(m => {
          const active = focusMode === m;
          return (
            <button
              key={m}
              onClick={() => onSetFocusMode(m)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? m === 'all'
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                    : 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                  : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
              }`}
            >
              {/* Small coloured priority dots (no emoji rendering shenanigans) */}
              {m === 'A' && (
                <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : 'bg-red-500'}`} />
              )}
              {m === 'AB' && (
                <span className="flex items-center gap-0.5">
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : 'bg-red-500'}`} />
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : 'bg-amber-400'}`} />
                </span>
              )}
              <span>
                {m === 'all' ? 'Alle' :
                 m === 'A' ? 'Nur A' :
                 'A + B'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


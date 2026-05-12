import { useMemo } from 'react';
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
    return { due, srsGroups, total: focusedCards.length, grandTotal: cards.length };
  }, [focusedCards, cards.length]);

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
    <div className="p-4 md:p-6 lg:p-8 space-y-4 fade-in">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-[#9ca3af] text-sm mt-1">Dein Lernfortschritt auf einen Blick</p>
      </div>

      {/* Status header: ein-zeilige Statusleiste mit allen wichtigsten Live-
          Signalen (Tage bis Prüfung, On-Track, Streak). Ersetzt das alte
          ExamCountdownWidget + drei der vier Top-Stat-Tiles. */}
      <StatusHeader
        plan={plan}
        settings={settings}
        onNavigate={onNavigate}
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

      {/* HERO: Fokus + Tagesziel + Jetzt-Lernen — alles in einem Block.
          Die einzige Action die du brauchst zum Lernen ist hier. */}
      {cards.length > 0 && (
        <div className={`rounded-2xl border p-5 space-y-4 ${
          isFocused
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-[#1e2130] border-[#2d3148]'
        }`}>
          {/* Focus toggle */}
          <FocusToggleInline
            focusMode={focusMode}
            onSetFocusMode={onSetFocusMode}
            focusedCount={focusedCards.length}
            totalCount={cards.length}
            isFocused={isFocused}
          />

          {/* Tagesziel + Action */}
          <TagesZiel
            plan={plan}
            settings={settings}
            ratedToday={ratedToday}
            progressPct={progressPct}
            progressTotal={progressTotal}
            onStart={onStartDailySession}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {/* Legacy due-today banner (only if no exam set) — kept as fallback */}
      {!settings.examDate && cards.length > 0 && stats.due.length > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
          <p className="text-indigo-300 text-sm">
            💡 Setze ein Prüfungsdatum in den Einstellungen, um den Tagesplan zu aktivieren.
          </p>
          <button
            onClick={() => onNavigate('settings')}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            Jetzt einstellen
          </button>
        </div>
      )}

      {/* SRS Level Breakdown — sekundär, "wo stehe ich grundsätzlich?" */}
      {cards.length > 0 && (
        <SrsLevelGrid
          srsGroups={stats.srsGroups}
          total={stats.total}
          onLevelClick={(srs: SrsKey) => onNavigateToLibraryWithSrs(srs)}
        />
      )}

      {/* Top Klassiker — collapsible, default zu. Nice-to-have, nicht
          handlungsrelevant. */}
      {topKlassiker.length > 0 && (
        <details className="bg-[#1e2130] border border-[#2d3148] rounded-2xl overflow-hidden group">
          <summary className="px-5 py-3 cursor-pointer hover:bg-[#252840] transition-colors flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              🔥 Top Klassiker
              <InfoTooltip
                side="bottom"
                text="Die 5 Karten mit der höchsten Klassiker-Wahrscheinlichkeit — basierend darauf, in wie vielen Katalogjahren / von wie vielen Prüfern die Frage gestellt wurde. Diese kommen sehr wahrscheinlich auch in deiner Prüfung dran."
              />
              <span className="text-xs font-normal text-[#6b7280] ml-1">({topKlassiker.length})</span>
            </h3>
            <span className="text-[#6b7280] text-sm group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="px-5 pb-5 space-y-2">
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
        </details>
      )}

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

// ─── Status Header ────────────────────────────────────────────
// Slim one-liner with Tage bis Prüfung + Im-Zeitplan-Status + Streak.
// Replaces the old standalone ExamCountdownWidget + 3 of the 4 top-stat
// tiles ("Beherrscht", "Lerntage in Folge", and the now-redundant "Karten
// gesamt"). Click navigates to settings when no exam date is set.

function StatusHeader({
  plan,
  settings,
  onNavigate,
}: {
  plan: ReturnType<typeof calculateDailyPlan>;
  settings: AppSettings;
  onNavigate: (p: string) => void;
}) {
  // No exam date → soft prompt to set one
  if (!settings.examDate) {
    return (
      <div className="bg-[#1e2130] border border-dashed border-[#2d3148] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[#9ca3af]">
          📅 Kein Prüfungsdatum · 🔥 {settings.studyStreak} Lerntag{settings.studyStreak === 1 ? '' : 'e'} in Folge
        </p>
        <button
          onClick={() => onNavigate('settings')}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
        >
          Datum setzen →
        </button>
      </div>
    );
  }

  if (plan.examPassed) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3 text-center">
        <p className="text-white font-semibold">🎉 Prüfung vorbei — hoffentlich lief alles gut!</p>
      </div>
    );
  }

  const days = plan.daysUntilExam!;
  const examDateFormatted = new Date(settings.examDate!).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  const urgencyClass =
    days <= 3 ? 'bg-red-500/10 border-red-500/40' :
    days <= 7 ? 'bg-amber-500/10 border-amber-500/40' :
    'bg-[#1e2130] border-[#2d3148]';
  const daysColor =
    days <= 3 ? 'text-red-400' :
    days <= 7 ? 'text-amber-400' :
    'text-indigo-400';

  return (
    <div className={`border rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${urgencyClass}`}>
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="flex items-center gap-1.5">
          <span className={`font-bold text-2xl leading-none ${daysColor}`}>{days}</span>
          <span className="text-[#9ca3af]">
            {days === 1 ? 'Tag' : 'Tage'} bis Prüfung
            <span className="text-[#6b7280] ml-1.5">· {examDateFormatted}</span>
          </span>
        </span>
        <span className="text-[#3d4168]">·</span>
        {plan.isAheadOfSchedule ? (
          <span className="text-green-400 text-xs font-medium">✓ Im Zeitplan</span>
        ) : (
          <span className="text-amber-400 text-xs font-medium">⚠ Hinter Plan</span>
        )}
        <span className="text-[#3d4168]">·</span>
        <span className="text-[#9ca3af] text-xs">🔥 {settings.studyStreak} {settings.studyStreak === 1 ? 'Tag' : 'Tage'} in Folge</span>
      </div>
      {days <= 7 && (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${days <= 3 ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
          {days <= 3 ? '⚡ Endspurt' : '📚 Letzte Woche'}
        </span>
      )}
    </div>
  );
}

// ─── Tagesziel (Hero CTA) ─────────────────────────────────────
// Consolidates: counters + progress bar + Jetzt-Lernen button + pace stats.
// Replaces the old separate DailyGoalCard. Lives inside the Hero block.

function TagesZiel({
  plan,
  settings,
  ratedToday,
  progressPct,
  progressTotal,
  onStart,
  onNavigate,
}: {
  plan: ReturnType<typeof calculateDailyPlan>;
  settings: AppSettings;
  ratedToday: number;
  progressPct: number;
  progressTotal: number;
  onStart: () => void;
  onNavigate: (p: string) => void;
}) {
  const totalToday = plan.reviewCards.length + plan.newCards.length;
  const goalDone = ratedToday >= progressTotal && progressTotal > 0;
  const autoMode = settings.dailyNewCardGoalMode === 'auto';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          Heute zu lernen
          <InfoTooltip
            text="Dein Tagesplan: fällige Wiederholungen + neue Karten gemäß deinem Tageslimit. Wenn Fokus aktiv ist, nur aus dem Fokus-Set. 'Jetzt lernen' arbeitet die Liste durch."
          />
        </h3>
        {goalDone && (
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">
            ✅ Tagesziel erreicht
          </span>
        )}
      </div>

      {/* Big number + breakdown */}
      <div className="flex items-end justify-center gap-3 py-2">
        <span className="text-5xl font-black text-white leading-none">{totalToday}</span>
        <span className="text-sm text-[#9ca3af] pb-1">Karten</span>
      </div>
      {totalToday > 0 && (
        <div className="flex justify-center gap-4 text-sm">
          <span className="text-amber-400 font-medium">{plan.reviewCards.length} Wdh.</span>
          <span className="text-[#3d4168]">·</span>
          <span className="text-purple-300 font-medium">{plan.newCards.length} Neu</span>
          {plan.reviewOverflow > 0 && (
            <>
              <span className="text-[#3d4168]">·</span>
              <span className="text-[#6b7280] text-xs">+{plan.reviewOverflow} auf morgen</span>
            </>
          )}
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

      {/* Jetzt-Lernen button */}
      <button
        onClick={onStart}
        disabled={totalToday === 0}
        className="w-full py-3.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2 text-base"
      >
        ▶ Jetzt lernen
        {totalToday > 0 && (
          <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{totalToday}</span>
        )}
      </button>

      {/* Pace stats — small, at the bottom */}
      {plan.newCardsPerDay > 0 && (
        <div className="pt-2 border-t border-white/5 flex items-center justify-between flex-wrap gap-2 text-xs text-[#9ca3af]">
          <div className="flex items-center gap-3 flex-wrap">
            <span title="Neue Karten pro Tag (Tagesziel)">
              <span className="text-indigo-300 font-semibold">{plan.newCardsPerDay}</span> neu/Tag
              {autoMode && <span className="text-[10px] text-amber-400 ml-1">(auto)</span>}
            </span>
            <span className="text-[#3d4168]">·</span>
            <span title="Geschätzte tägliche Wiederholungen">
              <span className="text-indigo-300 font-semibold">~{plan.estimatedDailyReviews}</span> Wdh./Tag
            </span>
            <span className="text-[#3d4168]">·</span>
            <span title="Geschätzter Beherrschungsgrad zum Prüfungstag">
              Prognose:{' '}
              <span className={`font-semibold ${
                plan.masteryRateAtExam >= 90 ? 'text-emerald-400' :
                plan.masteryRateAtExam >= 70 ? 'text-amber-400' : 'text-red-400'
              }`}>{plan.masteryRateAtExam}%</span>
            </span>
            <InfoTooltip
              text="'Neu/Tag': wie viele neue Karten heute eingeführt werden — entweder fester Wert (manuell) oder automatisch berechnet aus 'verbleibendeKartenImFokus / (TageBisPrüfung × 0.5)'. 'Wdh/Tag': geschätzte Anzahl Wiederholungen pro Tag durch SRS. 'Prognose': geschätzter Anteil beherrschter Karten zum Prüfungstag."
            />
          </div>
          <button
            onClick={() => onNavigate('settings')}
            className="text-[#6b7280] hover:text-indigo-400 underline-offset-2 hover:underline"
          >
            Anpassen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Focus Toggle (inline variant, sits inside the Hero block) ────
// Renders only the focus controls + a short status line, without the
// outer wrapper card (the parent Hero already has one). Same semantics
// as the old FocusToggle.

function FocusToggleInline({
  focusMode,
  onSetFocusMode,
  focusedCount,
  totalCount,
  isFocused,
}: {
  focusMode: FocusMode;
  onSetFocusMode: (m: FocusMode) => void;
  focusedCount: number;
  totalCount: number;
  isFocused: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-white flex items-center gap-2">
          🎯 Fokus
          <InfoTooltip
            side="bottom"
            text="Reduziert die App auf einen Karten-Subset (A oder A+B), damit 'Heute zu lernen' eine machbare Zahl zeigt statt der überfordernden Gesamtzahl. Andere Karten sind nicht weg — nur ausgeblendet bis du den Fokus wechselst."
          />
          {isFocused && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              aktiv
            </span>
          )}
        </p>
        <p className="text-xs text-[#9ca3af]">
          {isFocused
            ? `${focusedCount.toLocaleString()} von ${totalCount.toLocaleString()} Karten im Fokus`
            : `${totalCount.toLocaleString()} Karten gesamt`}
        </p>
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


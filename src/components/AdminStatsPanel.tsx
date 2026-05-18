// Admin-Stats-Panel — versteckt, zugeklappt, zeigt aggregierte
// Lernfortschritts-Zahlen pro User.
//
// Wird nur in Settings.tsx unter `userEmail === ADMIN_EMAIL` gerendert.
// Default zugeklappt, lädt erst beim Aufklappen die RPC (keine
// automatischen Background-Calls).

import { useState } from 'react';
import { useAdminStats, type AdminUserStat } from '../hooks/useAdminStats';

// Relative Zeit-Anzeige in Deutsch ("vor 2 Tagen")
function relativeTime(iso: string | null): string {
  if (!iso) return 'nie';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'gerade eben';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'gestern';
  if (diffD < 7) return `vor ${diffD} Tagen`;
  if (diffD < 30) return `vor ${Math.floor(diffD / 7)} Wo`;
  if (diffD < 365) return `vor ${Math.floor(diffD / 30)} Mo`;
  return `vor ${Math.floor(diffD / 365)} J`;
}

// "Gelernt"-Anteil als kleine 2-stufige Progress-Bar:
// 1. Stufe (emerald, hinten):  reif (mature) / total
// 2. Stufe (indigo, davor):    gelernt (studied) / total — beinhaltet die reifen
function ProgressBar({ total, studied, mature }: { total: number; studied: number; mature: number }) {
  if (total === 0) {
    return <div className="h-2 bg-[#252840] rounded-full" />;
  }
  const studiedPct = Math.min(100, (studied / total) * 100);
  const maturePct = Math.min(100, (mature / total) * 100);
  return (
    <div className="h-2 bg-[#252840] rounded-full overflow-hidden relative">
      {/* indigo background (studied total) */}
      <div
        className="absolute inset-y-0 left-0 bg-indigo-500 transition-all"
        style={{ width: `${studiedPct}%` }}
      />
      {/* emerald foreground (mature subset, sits on top of indigo) */}
      <div
        className="absolute inset-y-0 left-0 bg-emerald-500 transition-all"
        style={{ width: `${maturePct}%` }}
      />
    </div>
  );
}

function StatRow({ user, isMe }: { user: AdminUserStat; isMe: boolean }) {
  const studiedPct = user.total_cards > 0
    ? Math.round((user.studied_cards / user.total_cards) * 100)
    : 0;

  return (
    <div
      className={`px-3 py-3 border-b border-[#2d3148] last:border-b-0 ${isMe ? 'bg-indigo-500/5' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-[#d1d5db] truncate font-medium">{user.email}</span>
          {isMe && (
            <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded shrink-0">
              du
            </span>
          )}
        </div>
        <span className="text-xs text-[#9ca3af] shrink-0 font-mono">
          {relativeTime(user.last_sign_in_at)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <ProgressBar
            total={user.total_cards}
            studied={user.studied_cards}
            mature={user.mature_cards}
          />
        </div>
        <div className="text-xs font-mono text-[#9ca3af] shrink-0 tabular-nums w-32 text-right">
          <span className="text-emerald-400">{user.mature_cards}</span>
          {' / '}
          <span className="text-indigo-400">{user.studied_cards}</span>
          {' / '}
          <span className="text-white">{user.total_cards}</span>
          {' '}
          <span className="text-[#6b7280]">({studiedPct}%)</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminStatsPanel({ adminEmail }: { adminEmail: string }) {
  const [open, setOpen] = useState(false);
  const { stats, loading, error, load } = useAdminStats();

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // Lazy-load: erst beim ersten Aufklappen die RPC anstoßen
    if (next && !stats && !loading) load();
  };

  const handleRefresh = () => {
    load();
  };

  // Aggregate für den Header (nur wenn Daten da)
  const totalUsers = stats?.length ?? 0;
  const activeLastWeek = stats?.filter(s => {
    if (!s.last_sign_in_at) return false;
    const days = (Date.now() - new Date(s.last_sign_in_at).getTime()) / (1000 * 60 * 60 * 24);
    return days <= 7;
  }).length ?? 0;

  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-[#252840] transition-colors text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg">📈</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-white text-sm">Admin-Stats</h3>
            <p className="text-xs text-[#6b7280] mt-0.5">
              {stats
                ? `${totalUsers} User · ${activeLastWeek} aktiv letzte 7 Tage`
                : 'Lernfortschritt aller User · zugeklappt'}
            </p>
          </div>
        </div>
        <span className={`text-[#9ca3af] text-sm transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="border-t border-[#2d3148]">
          {loading && (
            <div className="px-5 py-6 text-center text-sm text-[#9ca3af]">
              <span className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin align-middle mr-2" />
              Lade Stats …
            </div>
          )}
          {error && (
            <div className="px-5 py-4 text-sm text-red-300 bg-red-500/10">
              ⚠️ Fehler beim Laden: {error}
            </div>
          )}
          {stats && !loading && !error && (
            <>
              {/* Legende */}
              <div className="px-5 py-2.5 bg-[#1a1d27] border-b border-[#2d3148] flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 text-[11px] text-[#9ca3af] flex-wrap">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    reif
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                    gelernt
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#252840]" />
                    neu
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="text-[11px] text-[#9ca3af] hover:text-white px-2 py-1 rounded border border-[#3d4168] transition-colors"
                >
                  ↻ Neu laden
                </button>
              </div>

              {stats.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-[#9ca3af]">
                  Keine Daten — vermutlich fehlt die SQL-Migration{' '}
                  <code className="text-[10px] px-1 py-0.5 bg-[#252840] rounded">
                    supabase_migration_admin_stats.sql
                  </code>
                  .
                </div>
              ) : (
                <div>
                  {stats.map(s => (
                    <StatRow key={s.user_id} user={s} isMe={s.email === adminEmail} />
                  ))}
                </div>
              )}

              <div className="px-5 py-3 bg-[#1a1d27] text-[10px] text-[#6b7280] leading-relaxed">
                <strong className="text-[#9ca3af]">Hinweis:</strong> Zahlen werden serverseitig
                aggregiert (RPC <code className="px-1 bg-[#252840] rounded">admin_user_stats</code>),
                Karten-Inhalte werden nie übertragen. Sichtbar nur für die Admin-Email.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

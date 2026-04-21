import type { Flashcard } from '../types/card';
import { getSRSStatus } from '../types/card';

export type SrsKey = 'neu' | 'lernend' | 'wiederholen' | 'beherrscht';

export const SRS_LEVELS: { key: SrsKey; label: string; icon: string; color: string; textColor: string; barColor: string; desc: string }[] = [
  { key: 'neu',         label: 'Neu',         icon: '🆕', color: 'border-purple-500/30 bg-purple-500/5  hover:bg-purple-500/10', textColor: 'text-purple-400',  barColor: 'bg-purple-500', desc: 'Noch nie gelernt' },
  { key: 'lernend',     label: 'Lernend',     icon: '📘', color: 'border-blue-500/30   bg-blue-500/5    hover:bg-blue-500/10',   textColor: 'text-blue-400',    barColor: 'bg-blue-500',   desc: 'Im aktiven Lernen' },
  { key: 'wiederholen', label: 'Wiederholen', icon: '🔄', color: 'border-amber-500/30  bg-amber-500/5   hover:bg-amber-500/10',  textColor: 'text-amber-400',   barColor: 'bg-amber-500',  desc: 'Regelmäßige Wiederholung' },
  { key: 'beherrscht',  label: 'Beherrscht',  icon: '✅', color: 'border-green-500/30  bg-green-500/5   hover:bg-green-500/10',  textColor: 'text-green-400',   barColor: 'bg-green-500',  desc: 'Langfristig eingeprägt' },
];

export function computeSrsGroups(cards: Flashcard[]): Record<SrsKey, number> {
  const groups: Record<SrsKey, number> = { neu: 0, lernend: 0, wiederholen: 0, beherrscht: 0 };
  cards.forEach(c => { groups[getSRSStatus(c)]++; });
  return groups;
}

interface Props {
  srsGroups: Record<SrsKey, number>;
  total: number;
  onLevelClick: (srs: SrsKey) => void;
  title?: string;
  hint?: string;
  percentLabel?: (pct: number) => string;
}

export default function SrsLevelGrid({
  srsGroups,
  total,
  onLevelClick,
  title = 'Lernfortschritt',
  hint = 'Klicken zum Filtern',
  percentLabel = (pct) => `${pct}% aller Karten`,
}: Props) {
  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="text-xs text-[#6b7280]">{hint}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SRS_LEVELS.map(lvl => {
          const count = srsGroups[lvl.key] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const disabled = count === 0;
          return (
            <button
              key={lvl.key}
              onClick={() => !disabled && onLevelClick(lvl.key)}
              disabled={disabled}
              className={`border rounded-xl p-4 text-left transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'} ${lvl.color}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{lvl.icon}</span>
                <span className={`text-2xl font-bold ${lvl.textColor}`}>{count}</span>
              </div>
              <p className="text-sm font-medium text-white">{lvl.label}</p>
              <p className="text-xs text-[#6b7280] mt-0.5 mb-3">{lvl.desc}</p>
              <div className="h-1.5 bg-[#252840] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${lvl.barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-[#6b7280] mt-1">{percentLabel(pct)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

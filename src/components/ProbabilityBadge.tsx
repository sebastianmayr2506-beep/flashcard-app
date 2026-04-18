export interface ProbabilityInfo {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export function getProbabilityInfo(pct: number): ProbabilityInfo {
  if (pct <= 30) return { label: 'Selten gestellt',       color: 'text-[#9ca3af]',  bg: 'bg-[#252840]',       border: 'border-[#2d3148]' };
  if (pct <= 60) return { label: 'Häufig gestellt',       color: 'text-yellow-400', bg: 'bg-yellow-500/10',   border: 'border-yellow-500/30' };
  if (pct <= 80) return { label: 'Sehr häufig gestellt',  color: 'text-orange-400', bg: 'bg-orange-500/10',   border: 'border-orange-500/30' };
  return               { label: 'Prüfungsklassiker 🔥',  color: 'text-red-400',    bg: 'bg-red-500/10',      border: 'border-red-500/30' };
}

export default function ProbabilityBadge({ pct, size = 'sm' }: { pct: number; size?: 'sm' | 'xs' }) {
  const info = getProbabilityInfo(pct);
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1 ${textSize} px-2 py-0.5 rounded-full border font-medium ${info.color} ${info.bg} ${info.border}`}>
      📊 {pct}% · {info.label}
    </span>
  );
}

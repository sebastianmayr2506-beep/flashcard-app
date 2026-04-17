import type { SRSStatus } from '../types/card';

const config = {
  neu:         { label: 'Neu',        className: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  lernend:     { label: 'Lernend',    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  wiederholen: { label: 'Wiederholen',className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  beherrscht:  { label: 'Beherrscht', className: 'bg-green-500/15 text-green-400 border-green-500/30' },
};

export default function SRSBadge({ status }: { status: SRSStatus }) {
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center rounded-full border text-xs px-2 py-0.5 font-medium ${className}`}>
      {label}
    </span>
  );
}

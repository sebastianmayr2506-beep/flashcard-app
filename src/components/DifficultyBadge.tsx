import type { Difficulty } from '../types/card';

const config = {
  einfach: { label: 'Einfach', className: 'bg-green-500/15 text-green-400 border-green-500/30' },
  mittel:  { label: 'Mittel',  className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  schwer:  { label: 'Schwer',  className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface Props {
  difficulty: Difficulty;
  size?: 'sm' | 'md';
}

export default function DifficultyBadge({ difficulty, size = 'sm' }: Props) {
  const { label, className } = config[difficulty];
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${sizeClass} ${className}`}>
      {label}
    </span>
  );
}

// Tiny inline priority picker — a small dot button that opens a popover with
// A / B / C / "remove" choices. Drop it anywhere we want quick re-prioritization
// (card front during study, library row, card editor, ...).

import { useState, useRef, useEffect } from 'react';
import type { Priority } from '../utils/priority';

/** Pill-style read-only display of a priority value. */
export function PriorityBadge({ value }: { value: Priority | undefined }) {
  if (!value) return null;
  const styles = {
    A: 'bg-red-500/15 border-red-500/40 text-red-300',
    B: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
    C: 'bg-slate-500/15 border-slate-500/40 text-slate-300',
  }[value];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${styles}`} title={`Priorität: ${value}`}>
      {value}
    </span>
  );
}

interface Props {
  value: Priority | undefined;
  onChange: (next: Priority | undefined) => void;
  /** Small/medium size for inline use cases */
  size?: 'sm' | 'md';
}

const DOT_COLOURS: Record<Priority, string> = {
  A: 'bg-red-500',
  B: 'bg-amber-400',
  C: 'bg-slate-400',
};

const DOT_RING: Record<Priority, string> = {
  A: 'ring-red-500/30 border-red-500/40',
  B: 'ring-amber-400/30 border-amber-500/40',
  C: 'ring-slate-400/30 border-slate-400/40',
};

export default function PriorityPicker({ value, onChange, size = 'md' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const dotSize = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  const labelSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={value ? `Priorität: ${value}` : 'Priorität setzen'}
        className={`${dotSize} rounded-full border flex items-center justify-center transition-all hover:scale-110 ${
          value
            ? `${DOT_COLOURS[value]} ${DOT_RING[value]} ring-2`
            : 'bg-transparent border-[#3d4168] hover:border-[#6b7280]'
        }`}
      >
        {value && (
          <span className={`${labelSize} font-bold text-white leading-none`}>
            {value}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 bg-[#1a1d27] border border-[#2d3148] rounded-xl shadow-2xl py-1.5 min-w-[140px]"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider px-3 pb-1.5 border-b border-[#2d3148] mb-1">
            Priorität
          </p>
          {(['A', 'B', 'C'] as Priority[]).map(p => (
            <button
              key={p}
              onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${
                value === p ? 'text-white font-semibold' : 'text-[#9ca3af]'
              }`}
            >
              <span className={`w-3 h-3 rounded-full ${DOT_COLOURS[p]}`} />
              <span>{p}</span>
              <span className="text-[10px] text-[#6b7280] ml-auto">
                {p === 'A' && 'Muss können'}
                {p === 'B' && 'Sollte kennen'}
                {p === 'C' && 'Nice to know'}
              </span>
            </button>
          ))}
          {value && (
            <button
              onClick={() => { onChange(undefined); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#9ca3af] hover:text-white hover:bg-white/5 transition-colors border-t border-[#2d3148] mt-1"
            >
              <span className="w-3 h-3 rounded-full border border-[#3d4168]" />
              <span>Entfernen</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

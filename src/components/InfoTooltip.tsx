// Tiny "i" info icon that reveals a tooltip on hover (desktop) or
// tap (mobile). Used throughout the Dashboard to explain what each
// section does without cluttering the layout.

import { useState, useRef, useEffect } from 'react';

interface Props {
  text: string;
  /** Optional position override. Default: above the icon. */
  side?: 'top' | 'bottom';
}

export default function InfoTooltip({ text, side = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Close on outside click (mobile tap-to-open use case)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const positionClass = side === 'top'
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
    : 'top-full left-1/2 -translate-x-1/2 mt-2';

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="w-4 h-4 rounded-full bg-[#252840] hover:bg-[#2d3148] border border-[#3d4168] text-[10px] text-[#9ca3af] hover:text-white flex items-center justify-center cursor-help font-semibold italic transition-colors"
        aria-label="Mehr Info"
      >
        i
      </button>
      {open && (
        <span
          className={`absolute ${positionClass} px-3 py-2 text-xs rounded-lg bg-[#0f1117] border border-[#2d3148] text-[#d1d5db] shadow-2xl w-64 leading-relaxed z-50 normal-case font-normal pointer-events-none`}
          style={{ whiteSpace: 'normal' }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

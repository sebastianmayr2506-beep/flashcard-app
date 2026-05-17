// Shared building blocks für alle Übungen in der App.
//
// Jede Übung sollte diese Bausteine nutzen statt eigene UI zu basteln —
// damit Look & Feel konsistent bleibt mit dem Rest der App. Konventionen
// siehe EXERCISE_GUIDE.md.

import { useState, type ReactNode } from 'react';

// ─── Shell: gemeinsamer Header + Theme-Wrapper ─────────────────────────
export function ExerciseShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 fade-in">
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-widest mb-1">Übung</p>
            <h1 className="text-xl sm:text-2xl font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-sm text-[#9ca3af] mt-1">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-[#252840] hover:bg-[#2d3148] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm transition-colors"
          >
            ✕ Schließen
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Progress-Bar: zeigt aktuellen Step von N ──────────────────────────
export function ProgressBar({
  phases,
  current,
  groupLabel,
}: {
  phases: string[];
  current: number; // 0-basierter Index
  groupLabel?: { left: string; right: string; splitAt: number }; // optional zweigeteilt
}) {
  return (
    <div className="mb-6">
      {groupLabel && (
        <div className="flex gap-1 mb-1 text-[10px] font-semibold uppercase tracking-wider">
          <span className={`flex-1 text-center ${current < groupLabel.splitAt ? 'text-indigo-400' : 'text-[#6b7280]'}`}>
            {groupLabel.left}
          </span>
          <span className={`flex-1 text-center ${current >= groupLabel.splitAt ? 'text-emerald-400' : 'text-[#6b7280]'}`}>
            {groupLabel.right}
          </span>
        </div>
      )}
      <div className="flex gap-1">
        {phases.map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-1.5 rounded ${
              i <= current
                ? (groupLabel && i >= groupLabel.splitAt ? 'bg-emerald-500' : 'bg-indigo-500')
                : 'bg-[#2d3148]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Step-Nav: klickbare Schritte mit ✓-Markierung + optionalem Gruppen-Split ─
//
// Im Gegensatz zur ProgressBar kann der User hier auch zurück- (oder
// vor-)springen, sieht alle Schritte als nummerierte Buttons, und
// abgeschlossene Schritte werden mit ✓ + hellem Hintergrund markiert.
export interface StepNavItem {
  id: string;
  n: number;
  label: string;
  /** Optionaler Gruppen-Key — Steps mit demselben Key werden gleich eingefärbt. */
  group?: string;
}

export function StepNav({
  steps,
  current,
  done,
  onSelect,
  groupLabels,
}: {
  steps: StepNavItem[];
  current: string;
  done: Record<string, boolean>;
  onSelect: (id: string) => void;
  /** Optional: zwei Gruppen-Labels über der Step-Reihe (z.B. "BÜB" / "BAB"). */
  groupLabels?: { left: string; right: string; splitAt: number };
}) {
  // Gruppenfarbe: Default = indigo, alternative Gruppe (alles ab splitAt) = emerald
  const colorFor = (idx: number): 'indigo' | 'emerald' =>
    groupLabels && idx >= groupLabels.splitAt ? 'emerald' : 'indigo';

  const palette = {
    indigo: {
      active: 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30',
      done: 'bg-indigo-500/15 text-indigo-300',
      label: 'text-indigo-400',
    },
    emerald: {
      active: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30',
      done: 'bg-emerald-500/15 text-emerald-300',
      label: 'text-emerald-400',
    },
  } as const;

  const activeLabel = steps.find(s => s.id === current)?.label;

  return (
    <div className="mb-6">
      {groupLabels && (
        <div className="flex gap-1 mb-2 text-[11px] font-bold uppercase tracking-wider">
          <span className={`flex-1 text-center ${palette.indigo.label}`}>{groupLabels.left}</span>
          <span className={`flex-1 text-center ${palette.emerald.label}`}>{groupLabels.right}</span>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {steps.map((s, i) => {
          const isActive = current === s.id;
          const isDone = !!done[s.id];
          const c = colorFor(i);
          const cls = isActive
            ? palette[c].active
            : isDone
              ? palette[c].done
              : 'bg-[#252840] text-[#6b7280]';
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`flex-1 min-w-[2rem] py-1.5 px-1 rounded-lg text-sm font-bold transition-all ${cls}`}
            >
              {isDone && !isActive ? '✓' : s.n}
            </button>
          );
        })}
      </div>
      {activeLabel && (
        <div className="text-center mt-1.5 text-xs text-[#9ca3af]">{activeLabel}</div>
      )}
    </div>
  );
}

// ─── Step-Header: Schritt-Nummer + Titel + Untertitel ──────────────────
export function StepHeader({ step, title, sub }: { step: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-widest mb-1">Schritt {step}</p>
      <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
      {sub && <p className="text-sm text-[#9ca3af]">{sub}</p>}
    </div>
  );
}

// ─── Info-Box (neutraler Hintergrund) ──────────────────────────────────
export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#1e2130] border border-[#2d3148] rounded-xl px-4 py-3 my-3 text-sm leading-relaxed text-[#d1d5db]">
      {children}
    </div>
  );
}

// ─── Feedback-Box (✅ ok / ❌ Fehler) ──────────────────────────────────
export function FeedbackBox({
  feedback,
}: {
  feedback: { ok: boolean; msg: string } | null;
}) {
  if (!feedback) return null;
  return (
    <div
      className={`my-3 px-4 py-3 rounded-xl border text-sm leading-relaxed ${
        feedback.ok
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          : 'bg-red-500/10 border-red-500/30 text-red-300'
      }`}
    >
      {feedback.ok ? '✅ ' : '❌ '}{feedback.msg}
    </div>
  );
}

// ─── Aufklappbarer Hint-Block ──────────────────────────────────────────
export function HintBox({
  children,
  label = '💡 Tipp anzeigen',
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-[#3d4168] text-[#9ca3af] hover:text-white hover:border-[#4d5178] transition-colors"
      >
        {open ? '🔽 Tipp ausblenden' : label}
      </button>
      {open && <InfoBox>{children}</InfoBox>}
    </div>
  );
}

// ─── Zahleneingabe ─────────────────────────────────────────────────────
export function NumIn({
  value,
  onChange,
  width = 'w-24',
  placeholder,
}: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  width?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${width} text-sm font-mono bg-[#252840] border border-[#3d4168] rounded-lg px-2.5 py-1.5 text-white text-right focus:border-indigo-500 focus:outline-none placeholder:text-[#4b5563]`}
    />
  );
}

// ─── Toggle-Button (für Multiple-Choice o.ä.) ──────────────────────────
export function ToggleBtn({
  label,
  active,
  onClick,
  color = 'indigo',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'indigo' | 'red' | 'amber' | 'purple' | 'blue' | 'emerald';
}) {
  const palette: Record<string, { active: string; inactive: string }> = {
    indigo:  { active: 'bg-indigo-500 border-indigo-500 text-white',    inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-white' },
    red:     { active: 'bg-red-500 border-red-500 text-white',          inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-red-300' },
    amber:   { active: 'bg-amber-500 border-amber-500 text-white',      inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-amber-300' },
    purple:  { active: 'bg-purple-500 border-purple-500 text-white',    inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-purple-300' },
    blue:    { active: 'bg-blue-500 border-blue-500 text-white',        inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-blue-300' },
    emerald: { active: 'bg-emerald-500 border-emerald-500 text-white',  inactive: 'border-[#3d4168] text-[#9ca3af] hover:text-emerald-300' },
  };
  const cls = active ? palette[color].active : `bg-[#252840] ${palette[color].inactive}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors whitespace-nowrap ${cls}`}
    >
      {label}
    </button>
  );
}

// ─── Primärer Action-Button ────────────────────────────────────────────
export function PrimaryBtn({
  label,
  onClick,
  disabled,
  color = 'indigo',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: 'indigo' | 'emerald';
}) {
  const palette = {
    indigo:  'bg-indigo-500 hover:bg-indigo-400',
    emerald: 'bg-emerald-500 hover:bg-emerald-400',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mt-3 px-6 py-2.5 rounded-xl ${palette[color]} disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors`}
    >
      {label}
    </button>
  );
}

// ─── Karte für eingeschlossene Inhalte (Sums, Stats, etc.) ─────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1e2130] border border-[#2d3148] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}

// ─── Formatierungs-Helfer (Euros, Locale) ──────────────────────────────
export const fmtEur = (n: number | undefined | null): string =>
  typeof n === 'number' ? n.toLocaleString('de-AT') + ' €' : '–';

export const numFromInput = (v: string | number | undefined): number =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')) || 0;

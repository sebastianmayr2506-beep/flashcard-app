// Übersicht aller verfügbaren Übungen.
//
// Aktuell Admin-only (Sichtbarkeit wird in der Sidebar gefiltert), aber
// die Page selbst macht keine Gate-Check — wenn man hierher navigiert,
// werden alle registrierten EXERCISES gezeigt.

import { Suspense, useState } from 'react';
import { EXERCISES, type ExerciseMeta } from './exercises/index';

const difficultyColor: Record<string, string> = {
  einfach: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  mittel: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  schwer: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export default function Exercises() {
  const [active, setActive] = useState<ExerciseMeta | null>(null);

  if (active) {
    const Comp = active.component;
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
            <div className="text-[#9ca3af] text-sm">Übung lädt…</div>
          </div>
        }
      >
        <Comp onClose={() => setActive(null)} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 fade-in">
        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-widest mb-1">Übungen</p>
          <h1 className="text-2xl font-bold leading-tight">🧠 Interaktive Trainings</h1>
          <p className="text-sm text-[#9ca3af] mt-1">
            Begleitete Aufgaben mit Schritt-für-Schritt-Auswertung. Karteikarten allein bringen dir das Auswendiglernen — hier rechnest du komplette Beispiele durch.
          </p>
        </div>

        {EXERCISES.length === 0 ? (
          <div className="bg-[#1e2130] border border-[#2d3148] rounded-xl p-8 text-center">
            <p className="text-4xl mb-3">🚧</p>
            <p className="text-[#9ca3af] text-sm">Noch keine Übungen verfügbar.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXERCISES.map(ex => (
              <button
                key={ex.slug}
                onClick={() => setActive(ex)}
                className="text-left bg-[#1e2130] hover:bg-[#252840] border border-[#2d3148] hover:border-indigo-500/40 rounded-xl p-4 transition-colors group"
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className="text-3xl shrink-0">{ex.icon ?? '📘'}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-white text-base leading-tight group-hover:text-indigo-300 transition-colors">
                      {ex.title}
                    </h3>
                    {ex.subject && (
                      <p className="text-xs text-[#9ca3af] mt-0.5">{ex.subject}</p>
                    )}
                  </div>
                </div>
                <p className="text-sm text-[#d1d5db] leading-relaxed mb-3">
                  {ex.description}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${difficultyColor[ex.difficulty]}`}>
                    {ex.difficulty}
                  </span>
                  {ex.estimatedMinutes && (
                    <span className="text-[10px] text-[#9ca3af]">
                      ⏱ ca. {ex.estimatedMinutes} min
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

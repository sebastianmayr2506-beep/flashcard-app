import { useMemo, useState, useEffect } from 'react';
import type { Flashcard } from '../types/card';
import { getSRSStatus } from '../types/card';
import { findDuplicateGroups } from '../utils/duplicateDetect';

interface Props {
  cards: Flashcard[];
  /** Triggers the existing AI-merge flow with the given card IDs. */
  onMergeCards: (cardIds: string[]) => void;
  onClose: () => void;
}

/**
 * Surfaces likely-duplicate cards (by question/front similarity) so the
 * user can review and decide. Manual merge only — never auto-mergers.
 *
 * Selection model: each card has a checkbox; "Mergen"-button on each
 * group sends the checked subset to the existing AI-merge flow. By
 * default *all* cards in the group are pre-checked since most groups
 * are small (2–3 cards).
 */
export default function DuplicateFinderModal({ cards, onMergeCards, onClose }: Props) {
  const [threshold, setThreshold] = useState(0.6);
  const [filterSubject, setFilterSubject] = useState('');
  const [filterExaminer, setFilterExaminer] = useState('');
  // Per-card checked state — keyed by card id, default true (i.e. all selected).
  // We DON'T persist across re-render of groups; on threshold/filter change the
  // groups reshuffle and selections are reset (intentional: user reviews fresh).
  const [checkedKey, setCheckedKey] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const allSubjects = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) for (const sj of c.subjects ?? []) s.add(sj);
    return [...s].sort();
  }, [cards]);

  const allExaminers = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) for (const e of c.examiners ?? []) s.add(e);
    return [...s].sort();
  }, [cards]);

  const groups = useMemo(() => {
    return findDuplicateGroups(cards, {
      threshold,
      subject: filterSubject || undefined,
      examiner: filterExaminer || undefined,
    });
    // checkedKey isn't used in groups themselves — it's just a forced reset signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, threshold, filterSubject, filterExaminer]);

  // Reset selection state whenever groups reshuffle. Default: all in.
  useEffect(() => {
    const next = new Set<string>();
    for (const g of groups) for (const c of g.cards) next.add(c.id);
    setChecked(next);
  }, [groups]);

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleMerge = (group: ReturnType<typeof findDuplicateGroups>[number]) => {
    const ids = group.cards.filter(c => checked.has(c.id)).map(c => c.id);
    if (ids.length < 2) return;
    onMergeCards(ids);
    // Don't close — the merge-preview modal opens on top (z-70 vs our z-60).
    // When it confirms, the source cards get removed via live-sync; our
    // `cards` prop updates → useMemo re-runs findDuplicateGroups → the
    // just-merged group disappears, user sees the next group automatically.
    // Same flow on cancel: nothing changed, duplicate finder still showing.
  };

  const totalGroups = groups.length;
  const totalCards = groups.reduce((s, g) => s + g.cards.length, 0);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#1a1d27] rounded-3xl border border-[#2d3148] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2d3148] shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">🔍 Dubletten finden</p>
            <p className="text-xs text-[#9ca3af] mt-0.5">
              {totalGroups === 0
                ? 'Keine Dubletten gefunden mit aktuellen Einstellungen'
                : `${totalGroups} Gruppe${totalGroups !== 1 ? 'n' : ''} · ${totalCards} Karten betroffen`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9ca3af] hover:text-white text-xl leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-[#2d3148] shrink-0 space-y-3">
          {/* Threshold slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wider">
                Ähnlichkeits-Schwelle
              </label>
              <span className="text-xs text-indigo-400 font-mono">
                {(threshold * 100).toFixed(0)} %
              </span>
            </div>
            <input
              type="range"
              min={0.4}
              max={0.95}
              step={0.05}
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-[#6b7280] mt-0.5">
              <span>40 % — zeigt mehr Treffer (mit False Positives)</span>
              <span>95 % — nur fast-identisch</span>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={filterSubject}
              onChange={e => setFilterSubject(e.target.value)}
              className="text-xs bg-[#252840] border border-[#2d3148] rounded-lg px-2 py-1.5 text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Alle Fächer</option>
              {allSubjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterExaminer}
              onChange={e => setFilterExaminer(e.target.value)}
              className="text-xs bg-[#252840] border border-[#2d3148] rounded-lg px-2 py-1.5 text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Alle Prüfer</option>
              {allExaminers.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        {/* Groups list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groups.length === 0 && (
            <div className="text-center py-12 text-sm text-[#6b7280]">
              <p className="text-3xl mb-2">🎉</p>
              <p>Keine Gruppen gefunden.</p>
              <p className="text-xs mt-1">Probier eine niedrigere Schwelle oder weniger Filter.</p>
            </div>
          )}

          {groups.map((group, gi) => {
            const checkedCount = group.cards.filter(c => checked.has(c.id)).length;
            return (
              <div
                key={`${gi}-${checkedKey}`}
                className={`rounded-xl border overflow-hidden ${
                  group.hasExactMatch
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-[#2d3148] bg-[#1e2130]'
                }`}
              >
                <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-[#2d3148]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {group.hasExactMatch ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Exakte Dublette
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {(group.maxSimilarity * 100).toFixed(0)} % ähnlich
                        </span>
                      )}
                      <span className="text-xs text-[#9ca3af]">{group.cards.length} Karten</span>
                    </div>
                    {group.label && (
                      <p className="text-[11px] text-[#6b7280] mt-0.5 truncate">
                        Stichworte: {group.label}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleMerge(group)}
                    disabled={checkedCount < 2}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                    title={checkedCount < 2 ? 'Mindestens 2 ausgewählte Karten zum Mergen' : `${checkedCount} mergen`}
                  >
                    Mergen ({checkedCount})
                  </button>
                </div>

                <ul className="divide-y divide-[#2d3148]">
                  {group.cards.map(c => {
                    const isChecked = checked.has(c.id);
                    const examiners = (c.examiners ?? []).join(', ') || '—';
                    const status = getSRSStatus(c);
                    return (
                      <li key={c.id} className="px-3 py-2 flex items-start gap-3 hover:bg-white/[0.02]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(c.id)}
                          className="mt-0.5 accent-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white leading-snug">{c.front}</p>
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <span className="text-[10px] text-[#9ca3af]">{examiners}</span>
                            <span className="text-[10px] text-[#6b7280]">·</span>
                            <span className="text-[10px] text-[#9ca3af]">
                              Rep {c.repetitions ?? 0} · {status}
                            </span>
                            {(c.subjects ?? []).slice(0, 2).map(s => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[#252840] text-[#9ca3af]">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-[#2d3148] bg-[#15172a] shrink-0">
          <p className="text-[11px] text-[#6b7280] leading-relaxed">
            💡 Beim "Mergen"-Klick öffnet sich der gewohnte AI-Merge-Dialog — die Auswahl ist nie automatisch.
            Karten mit hohem SRS-Stand werden in der KI-Merge-Logik bevorzugt als Quelle übernommen.
          </p>
          {/* Hidden state-reset trick */}
          <button
            onClick={() => setCheckedKey(k => k + 1)}
            className="hidden"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

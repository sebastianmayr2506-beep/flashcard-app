// Priority classification for exam-prep focus mode.
//
// Three buckets:
//   A = "Must know" — high probability classics, manually flagged cards,
//        or hard cards asked frequently. These are what you study first.
//   B = "Should know" — middle-of-the-road relevance.
//   C = "Nice to know" — low-probability tail, asked only once or never.
//
// The heuristic uses signals that already exist on every card:
//   - probabilityPercent: how often the question has been asked across
//     catalog years (the "Klassiker" score)
//   - flagged: user has manually marked it as problematic / important
//   - timesAsked: total count across all catalogs
//   - difficulty: user-set or auto-derived
//   - askedInCatalogs: list of "Year/Examiner" strings indicating recent relevance
//
// We deliberately keep this simple — fancier ML/AI ranking is overkill for
// a first pass. The user can adjust individual cards via the inline picker
// during study, and re-run classification any time from Settings.

import type { Flashcard } from '../types/card';

export type Priority = 'A' | 'B' | 'C';

export interface ClassificationCounts {
  A: number;
  B: number;
  C: number;
  /** Cards that already had a manually-set priority and were not changed. */
  preserved: number;
  total: number;
}

/**
 * Decide an A/B/C tag for a single card from its existing signals.
 * Pure function — does not mutate the card.
 */
export function classifyPriority(card: Flashcard): Priority {
  const prob = card.probabilityPercent ?? 0;
  const timesAsked = card.timesAsked ?? 0;

  // ── A bucket: high signal, must-know ──────────────────────────────────
  // 60%+ probability → "Klassiker"-Schwelle (matches Top-Klassiker definition
  // in the rest of the app)
  if (prob >= 60) return 'A';
  // User has manually flagged this card — they know it's important
  if (card.flagged) return 'A';
  // Asked many times AND user has marked it as hard → personal pain point
  if (timesAsked >= 5 && card.difficulty === 'schwer') return 'A';

  // ── C bucket: low signal, can defer ───────────────────────────────────
  // Asked once or never AND low probability → tail content
  if (prob < 25 && timesAsked <= 1) return 'C';
  // Probability under 15% regardless of count → not exam-classic
  if (prob < 15) return 'C';

  // ── B bucket: everything else (the bulk) ──────────────────────────────
  return 'B';
}

/**
 * Apply auto-classification to every card. Returns the updated priorities
 * keyed by card id PLUS the counts so the caller can show "would be A=X,
 * B=Y, C=Z" preview before committing.
 *
 * @param cards     The card list to classify.
 * @param overwrite If true, replace existing manual priorities too. Default
 *                  false — manual labels stick.
 */
export function classifyAll(cards: Flashcard[], overwrite = false): {
  byId: Map<string, Priority>;
  counts: ClassificationCounts;
} {
  const byId = new Map<string, Priority>();
  const counts: ClassificationCounts = { A: 0, B: 0, C: 0, preserved: 0, total: cards.length };
  for (const c of cards) {
    if (!overwrite && c.priority) {
      counts.preserved++;
      counts[c.priority]++;
      continue;
    }
    const p = classifyPriority(c);
    byId.set(c.id, p);
    counts[p]++;
  }
  return { byId, counts };
}

/**
 * Just the counts — for preview UI without actually computing the mapping.
 * Same logic as classifyAll, faster path for "what would happen if I classify?"
 */
export function previewClassification(cards: Flashcard[], overwrite = false): ClassificationCounts {
  const counts: ClassificationCounts = { A: 0, B: 0, C: 0, preserved: 0, total: cards.length };
  for (const c of cards) {
    if (!overwrite && c.priority) {
      counts.preserved++;
      counts[c.priority]++;
      continue;
    }
    counts[classifyPriority(c)]++;
  }
  return counts;
}

/** Filter cards by priority. Pass undefined to include all. */
export function filterByPriority(cards: Flashcard[], priority?: Priority | '' | undefined): Flashcard[] {
  if (!priority) return cards;
  return cards.filter(c => c.priority === priority);
}

/** Visual config per priority — central place so colours stay consistent. */
export const PRIORITY_META: Record<Priority, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  A: { label: 'A · Muss können',  emoji: '🅰️', color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/40' },
  B: { label: 'B · Sollte kennen', emoji: '🅱️', color: 'text-amber-300',  bg: 'bg-amber-500/15',  border: 'border-amber-500/40' },
  C: { label: 'C · Nice to know',  emoji: '🅲',  color: 'text-slate-300', bg: 'bg-slate-500/15',  border: 'border-slate-500/40' },
};

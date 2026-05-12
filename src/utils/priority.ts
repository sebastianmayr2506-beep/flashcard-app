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
 *
 * Heuristic v2 (looser, multi-signal): the first iteration was too pessimistic
 * because most imported cards don't have probabilityPercent set, defaulting
 * to 0 — which collapsed almost everything to C. We now consider multiple
 * signals (catalogs, examiners, flagged, difficulty) so a card without an
 * explicit probability can still land in A or B.
 */
export function classifyPriority(card: Flashcard): Priority {
  const prob = Number(card.probabilityPercent ?? 0) || 0;
  const timesAsked = Number(card.timesAsked ?? 0) || 0;
  const flagged = !!card.flagged;

  // Best-effort signal extraction: many imports route exam-frequency
  // data through general fields (`examiners`, `customTags` with
  // "Fragenkatalog YYYY") rather than the dedicated stats fields.
  // Fall back to general fields when stats fields are empty so we don't
  // miss frequency information that's clearly present on the card.
  const examinersFromStats = card.askedByExaminers?.length ?? 0;
  const examinerCount = examinersFromStats > 0
    ? examinersFromStats
    : (card.examiners?.length ?? 0);
  const catalogsFromStats = card.askedInCatalogs?.length ?? 0;
  const catalogsFromTags = (card.customTags ?? []).filter(t => /^fragenkatalog\s*\d{4}$/i.test(t)).length;
  const catalogCount = catalogsFromStats > 0 ? catalogsFromStats : catalogsFromTags;

  // ── A bucket: strong "must know" signal ───────────────────────────────
  if (prob >= 50) return 'A';                         // Klassiker (relaxed from 60)
  if (flagged) return 'A';                            // user-flagged → important
  if (timesAsked >= 3) return 'A';                    // asked multiple times across catalogs
  if (catalogCount >= 3) return 'A';                  // surfaced in 3+ catalog years
  if (examinerCount >= 3) return 'A';                 // 3+ examiners asked it

  // ── C bucket: truly no relevance signal at all ────────────────────────
  // Card has no data tying it to actual exam content. These are likely
  // user-created supplemental cards or low-relevance tail content.
  if (prob === 0 && timesAsked === 0 && catalogCount === 0 && examinerCount === 0 && !flagged) {
    return 'C';
  }
  // Very low probability AND barely asked → defer
  if (prob < 10 && timesAsked <= 1 && catalogCount <= 1 && examinerCount <= 1) return 'C';

  // ── B bucket: has some signal, middle relevance (the bulk) ────────────
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

/**
 * Inspect the actual signal distribution in the user's card data.
 * Useful for understanding why an auto-classification produced what it did.
 */
export interface SignalDistribution {
  /** Cards with probabilityPercent >= threshold (50, 25, 10, 1, 0) */
  byProbability: { ge50: number; ge25: number; ge10: number; ge1: number; eq0: number };
  /** Cards with any data tying them to catalogs */
  withCatalogData: number;
  /** Cards user has manually flagged */
  flaggedCount: number;
  /** Cards with no signal whatsoever (the C bucket) */
  noSignalAtAll: number;
  total: number;
}

export function inspectDistribution(cards: Flashcard[]): SignalDistribution {
  const dist: SignalDistribution = {
    byProbability: { ge50: 0, ge25: 0, ge10: 0, ge1: 0, eq0: 0 },
    withCatalogData: 0,
    flaggedCount: 0,
    noSignalAtAll: 0,
    total: cards.length,
  };
  for (const c of cards) {
    const prob = Number(c.probabilityPercent ?? 0) || 0;
    const timesAsked = Number(c.timesAsked ?? 0) || 0;
    // Best-effort: fall back to general fields if dedicated stats aren't set.
    const catalogCount = (c.askedInCatalogs?.length ?? 0) > 0
      ? (c.askedInCatalogs?.length ?? 0)
      : (c.customTags ?? []).filter(t => /^fragenkatalog\s*\d{4}$/i.test(t)).length;
    const examinerCount = (c.askedByExaminers?.length ?? 0) > 0
      ? (c.askedByExaminers?.length ?? 0)
      : (c.examiners?.length ?? 0);

    if (prob >= 50) dist.byProbability.ge50++;
    else if (prob >= 25) dist.byProbability.ge25++;
    else if (prob >= 10) dist.byProbability.ge10++;
    else if (prob >= 1) dist.byProbability.ge1++;
    else dist.byProbability.eq0++;

    if (catalogCount > 0 || timesAsked > 0 || examinerCount > 0) dist.withCatalogData++;
    if (c.flagged) dist.flaggedCount++;

    if (prob === 0 && timesAsked === 0 && catalogCount === 0 && examinerCount === 0 && !c.flagged) {
      dist.noSignalAtAll++;
    }
  }
  return dist;
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

// Priority classification for exam-prep focus mode.
//
// Three buckets:
//   A = "Must know" — high frequency classics or manually flagged cards
//   B = "Should know" — middle-of-the-road, asked a few times
//   C = "Nice to know" — one-off or never asked in catalogs
//
// Heuristik v3.1 (Single-Signal — siehe DEVELOPMENT.md Migrations #1 + #3):
//   timesAsked = die eine ehrliche Zahl wie oft die Frage in den
//   Fragenkatalogen vorkam (über alle Prüfer und Jahrgänge hinweg).
//   Daraus leiten wir A/B/C ab. flagged hebt eine Karte zusätzlich auf A.
//
//   A = times_asked >= 6  ODER flagged
//   B = times_asked 3–5
//   C = times_asked <= 2  (Default für alles ohne Exam-Daten)
//
// (v3 hatte B ab 2× — wurde auf 3× verschärft weil "nur 2 Erwähnungen"
//  in 5 Katalogjahren noch zu schwach für "sollte kennen" ist.)
//
// Vorheriges Multi-Signal-Modell (prob >= 50, oder catalogs >= 3, oder
// examiners >= 3, ...) wurde abgelöst weil die einzelnen Signale alle in
// times_asked bereits enthalten sind (siehe Merge-Logik die times_asked
// summiert). Eine Karte mit 3 Prüfern in 2 Katalogjahren hat times_asked=6
// und landet damit automatisch auf A.

import type { Flashcard } from '../types/card';

export type Priority = 'A' | 'B' | 'C';

/** Threshold für 100%-Klassiker. Auch bei der Probability-Berechnung
 *  als Bezugsgröße benutzt: probabilityPercent = min(100, times/THRESHOLD × 100). */
export const A_THRESHOLD = 6;

export interface ClassificationCounts {
  A: number;
  B: number;
  C: number;
  /** Cards that already had a manually-set priority and were not changed. */
  preserved: number;
  total: number;
}

/**
 * Decide an A/B/C tag for a single card based on times_asked + flagged.
 * Pure function — does not mutate the card.
 */
/** Mindest-times_asked für B-Kategorie. Karten mit weniger fallen in C. */
export const B_THRESHOLD = 3;

export function classifyPriority(card: Flashcard): Priority {
  const timesAsked = Number(card.timesAsked ?? 0) || 0;
  if (card.flagged || timesAsked >= A_THRESHOLD) return 'A';
  if (timesAsked >= B_THRESHOLD) return 'B';
  return 'C';
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
    // priorityLocked = User hat manuell gesetzt → IMMER schützen, auch bei overwrite=true
    // priority already set + overwrite=false → respect existing (legacy behavior)
    const lockedManual = !!c.priorityLocked;
    if (lockedManual || (!overwrite && c.priority)) {
      counts.preserved++;
      if (c.priority) counts[c.priority]++;
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
    const lockedManual = !!c.priorityLocked;
    if (lockedManual || (!overwrite && c.priority)) {
      counts.preserved++;
      if (c.priority) counts[c.priority]++;
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

/** Focus-Modus filter. Single source of truth so Dashboard, "Jetzt lernen"
 *  and any future flow that needs to respect the focus all behave identically. */
export type FocusMode = 'all' | 'A' | 'AB';

export function applyFocus(cards: Flashcard[], focus: FocusMode | undefined): Flashcard[] {
  if (!focus || focus === 'all') return cards;
  if (focus === 'A') return cards.filter(c => c.priority === 'A');
  if (focus === 'AB') return cards.filter(c => c.priority === 'A' || c.priority === 'B');
  return cards;
}

export const FOCUS_LABELS: Record<FocusMode, string> = {
  all: 'Alle Karten',
  A: 'Nur A · Muss können',
  AB: 'A + B · Muss + Sollte',
};

/** Visual config per priority — central place so colours stay consistent. */
export const PRIORITY_META: Record<Priority, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  A: { label: 'A · Muss können',  emoji: '🅰️', color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/40' },
  B: { label: 'B · Sollte kennen', emoji: '🅱️', color: 'text-amber-300',  bg: 'bg-amber-500/15',  border: 'border-amber-500/40' },
  C: { label: 'C · Nice to know',  emoji: '🅲',  color: 'text-slate-300', bg: 'bg-slate-500/15',  border: 'border-slate-500/40' },
};

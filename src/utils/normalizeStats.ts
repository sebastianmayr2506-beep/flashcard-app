// One-time normalization of card exam-frequency data.
//
// Historical mess: some imports routed catalog-year info as
// `#Fragenkatalog YYYY` tags in customTags, and asker info as plain
// `examiners` entries. The dedicated stats fields (askedInCatalogs,
// askedByExaminers, timesAsked, probabilityPercent) stayed empty,
// breaking displays + classifiers that expected them.
//
// This utility produces patches to:
//   1. Move "Fragenkatalog YYYY" tags out of customTags into askedInCatalogs
//   2. Mirror `examiners` into askedByExaminers when the latter is empty
//   3. Derive timesAsked from catalog/examiner counts when missing
//   4. Compute probabilityPercent from share of known catalog years
//      (only when current value is 0 — imported values win)
//
// Pure function: returns the patches + a summary. Caller decides whether
// to apply via bulkUpdate.

import type { Flashcard } from '../types/card';

const CATALOG_TAG_RE = /^fragenkatalog\s*(\d{4})$/i;

export interface NormalizationPatch {
  id: string;
  patch: Partial<Flashcard>;
  changes: {
    catalogTagsMoved: number;
    examinersFilled: boolean;
    timesAskedSet: number | null;
    probabilityComputed: number | null;
  };
}

export interface NormalizationSummary {
  /** Number of cards that will receive at least one patch */
  totalAffected: number;
  /** Sum of Fragenkatalog-tags moved out of customTags across all cards */
  catalogTagsMovedTotal: number;
  /** Cards where askedByExaminers got mirrored from examiners */
  cardsWithExaminersFilled: number;
  /** Cards where timesAsked was derived (was 0) */
  cardsWithTimesAskedSet: number;
  /** Cards where probabilityPercent was computed (was 0) */
  cardsWithProbabilityComputed: number;
  /** Distinct catalog years discovered across the whole set */
  globalCatalogYearCount: number;
  globalCatalogYears: string[];
  /** Number of cards that needed no changes */
  alreadyClean: number;
}

/** Scan all cards for catalog-year mentions (both in tags and in askedInCatalogs). */
export function discoverGlobalCatalogYears(cards: Flashcard[]): Set<string> {
  const years = new Set<string>();
  for (const c of cards) {
    for (const cat of c.askedInCatalogs ?? []) {
      const m = cat.match(/(\d{4})/);
      if (m) years.add(m[1]);
    }
    for (const tag of c.customTags ?? []) {
      const m = tag.match(CATALOG_TAG_RE);
      if (m) years.add(m[1]);
    }
  }
  return years;
}

/**
 * Compute the patch for a single card. Returns null if no changes needed.
 * `globalYears` is the universe of all catalog years that exist in the
 * library — used to compute probabilityPercent as a share.
 */
export function normalizeCard(card: Flashcard, globalYears: Set<string>): NormalizationPatch | null {
  // Split customTags into (catalog-year entries) + (real tags)
  const catalogTagMatches: string[] = [];
  const remainingTags: string[] = [];
  for (const tag of card.customTags ?? []) {
    const m = tag.match(CATALOG_TAG_RE);
    if (m) catalogTagMatches.push(`Fragenkatalog ${m[1]}`);
    else remainingTags.push(tag);
  }

  const patch: Partial<Flashcard> = {};
  let changed = false;
  const changes = {
    catalogTagsMoved: 0,
    examinersFilled: false,
    timesAskedSet: null as number | null,
    probabilityComputed: null as number | null,
  };

  // 1) Move Fragenkatalog tags into askedInCatalogs
  if (catalogTagMatches.length > 0) {
    const existing = new Set(card.askedInCatalogs ?? []);
    for (const cat of catalogTagMatches) existing.add(cat);
    patch.askedInCatalogs = Array.from(existing).sort();
    patch.customTags = remainingTags;
    changes.catalogTagsMoved = catalogTagMatches.length;
    changed = true;
  }

  // 2) Mirror examiners → askedByExaminers when missing
  if ((card.askedByExaminers?.length ?? 0) === 0 && (card.examiners?.length ?? 0) > 0) {
    patch.askedByExaminers = [...(card.examiners ?? [])];
    changes.examinersFilled = true;
    changed = true;
  }

  // 3) Derive timesAsked when missing (use larger of catalog/examiner counts)
  const newCatalogCount = (patch.askedInCatalogs ?? card.askedInCatalogs ?? []).length;
  const newExaminerCount = (patch.askedByExaminers ?? card.askedByExaminers ?? []).length;
  const currentTimesAsked = card.timesAsked ?? 0;
  if (currentTimesAsked === 0 && (newCatalogCount > 0 || newExaminerCount > 0)) {
    const derived = Math.max(newCatalogCount, newExaminerCount);
    patch.timesAsked = derived;
    changes.timesAskedSet = derived;
    changed = true;
  }

  // 4) Compute probabilityPercent (only if missing — imported values win)
  const currentProb = Number(card.probabilityPercent ?? 0) || 0;
  if (currentProb === 0 && newCatalogCount > 0 && globalYears.size > 0) {
    const pct = Math.min(100, Math.round((newCatalogCount / globalYears.size) * 100));
    patch.probabilityPercent = pct;
    changes.probabilityComputed = pct;
    changed = true;
  }

  if (!changed) return null;
  return { id: card.id, patch, changes };
}

/** Compute patches for all cards. Pure — caller applies via bulkUpdate. */
export function normalizeAll(cards: Flashcard[]): { patches: NormalizationPatch[]; summary: NormalizationSummary } {
  const globalYears = discoverGlobalCatalogYears(cards);
  const patches: NormalizationPatch[] = [];
  for (const c of cards) {
    const p = normalizeCard(c, globalYears);
    if (p) patches.push(p);
  }
  return {
    patches,
    summary: {
      totalAffected: patches.length,
      catalogTagsMovedTotal: patches.reduce((s, p) => s + p.changes.catalogTagsMoved, 0),
      cardsWithExaminersFilled: patches.filter(p => p.changes.examinersFilled).length,
      cardsWithTimesAskedSet: patches.filter(p => p.changes.timesAskedSet !== null).length,
      cardsWithProbabilityComputed: patches.filter(p => p.changes.probabilityComputed !== null).length,
      globalCatalogYearCount: globalYears.size,
      globalCatalogYears: Array.from(globalYears).sort(),
      alreadyClean: cards.length - patches.length,
    },
  };
}

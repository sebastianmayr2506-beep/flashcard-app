// Persistent MC question generation — stores result on the card so
// subsequent sessions reuse the cached questions instead of re-burning
// API tokens. Reuses the existing generateMCHintBundle pipeline
// (Gemini → Groq fallback) for consistency.
//
// Generation count is adaptive: short cards get 3 questions, complex
// cards get 5–7. This is a heuristic on back-text length — better
// than asking the AI to self-decide (which it does inconsistently).

import { generateMCHintBundle, type MCHintResult } from './geminiMCHint';
import type { AIKeys } from './geminiModels';
import type { Flashcard } from '../types/card';

/** Pick a question count from card content size. */
export function adaptiveCount(card: Flashcard): number {
  const len = (card.front?.length ?? 0) + (card.back?.length ?? 0);
  if (len < 500) return 3;
  if (len < 1500) return 5;
  return 7;
}

/**
 * Generate MC for a single card. Returns the question array — caller
 * is responsible for persisting it. Throws if generation fails after
 * retries.
 *
 * Retry strategy: the AI sometimes struggles to generate the adaptive
 * count for complex / dual-concept cards (e.g. "Was ist die ABC- und
 * XYZ-Analyse" combining two methods at 5-7 questions). We progressively
 * fall back to smaller counts. 3 questions almost always works.
 */
export async function generateMCForCard(card: Flashcard, keys: AIKeys): Promise<MCHintResult[]> {
  const initial = adaptiveCount(card);
  // Build the retry ladder. Each step is a (count, attempt#) — we also
  // retry the SAME count once for transient failures (rate limits, network).
  const ladder: number[] =
    initial === 3 ? [3, 3]
    : initial === 5 ? [5, 3]
    : [7, 5, 3];

  let lastErr: unknown;
  for (let i = 0; i < ladder.length; i++) {
    const c = ladder[i];
    try {
      const bundle = await generateMCHintBundle(keys, card.front, card.back, c);
      if (bundle.questions.length === 0) {
        lastErr = new Error(`Empty bundle returned at count=${c}`);
        continue;
      }
      // If we got here on a retry, log a note so the user can see in console
      if (i > 0) {
        console.info(`[MC] succeeded on retry ${i + 1} with count=${c} for "${card.front.slice(0, 60)}"`);
      }
      return bundle.questions;
    } catch (err) {
      lastErr = err;
      console.warn(`[MC] attempt ${i + 1}/${ladder.length} failed (count=${c}):`,
        err instanceof Error ? err.message : String(err));
      // Brief pause between retries to dodge transient rate limits.
      if (i < ladder.length - 1) await new Promise(r => setTimeout(r, 600));
    }
  }
  throw lastErr instanceof Error
    ? new Error(`Nach ${ladder.length} Versuchen fehlgeschlagen: ${lastErr.message}`)
    : new Error(String(lastErr));
}

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string; // front of the card currently being processed
}

export interface BatchResult {
  results: Map<string, MCHintResult[]>; // cardId → questions
  errors: Map<string, string>;          // cardId → error message
}

/**
 * Generate MC for many cards in parallel with bounded concurrency.
 * Calls onProgress after every completion so the UI can update a
 * progress bar.
 *
 * Concurrency = 5: keeps below Gemini Flash's 1500 RPM limit while
 * still being 5× faster than serial. Failed cards don't abort the
 * batch — they're collected in `errors` for the caller to surface.
 */
export async function generateMCBatch(
  cards: Flashcard[],
  keys: AIKeys,
  onProgress?: (p: BatchProgress) => void,
  concurrency = 5,
): Promise<BatchResult> {
  const results = new Map<string, MCHintResult[]>();
  const errors = new Map<string, string>();
  let completed = 0;
  let failed = 0;

  // Simple chunk-based parallel runner
  for (let i = 0; i < cards.length; i += concurrency) {
    const chunk = cards.slice(i, i + concurrency);
    await Promise.all(chunk.map(async card => {
      try {
        const qs = await generateMCForCard(card, keys);
        results.set(card.id, qs);
      } catch (err) {
        errors.set(card.id, err instanceof Error ? err.message : String(err));
        failed++;
      }
      completed++;
      onProgress?.({
        total: cards.length,
        completed,
        failed,
        current: card.front.slice(0, 80),
      });
    }));
  }

  return { results, errors };
}

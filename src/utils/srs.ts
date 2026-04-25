import type { Flashcard, RatingValue } from '../types/card';

// SM-2 Spaced Repetition Algorithm
// Based on: https://www.supermemo.com/en/archives1990-2015/english/ol/sm2

const MIN_EASE_FACTOR = 1.3;

// Exam-aware interval cap:
// - Standard: cap at daysUntilExam so no card is ever scheduled past the exam
// - Final 14 days: cap at ceil(daysUntilExam / 2) so every card appears at least twice
// - Final 3 days: cap at 1 so every card comes up daily
function capIntervalForExam(interval: number, daysUntilExam: number): number {
  if (daysUntilExam <= 3) return 1;
  if (daysUntilExam <= 14) return Math.min(interval, Math.ceil(daysUntilExam / 2));
  return Math.min(interval, daysUntilExam);
}

export function applySM2(card: Flashcard, rating: RatingValue, daysUntilExam?: number): Partial<Flashcard> {
  let { interval, repetitions, easeFactor } = card;

  // Detect the first-ever rep=0 → rep≥1 transition so we can stamp firstStudiedAt.
  // We check `!card.firstStudiedAt` so the field is set ONCE per card lifetime —
  // a future Nochmal-then-Schwer cycle won't move it. This is the signal the
  // Dashboard reconciler trusts.
  const isFirstPromotion = card.repetitions === 0 && rating >= 1 && !card.firstStudiedAt;

  if (rating >= 1) {
    // Success (Schwer / Gut / Einfach) — card is remembered, progress it.
    // Schwer grows the interval gently (*1.2); Gut/Einfach follow the ease factor.
    if (repetitions === 0) {
      // First review: Einfach 2 days, Gut/Schwer 1 day
      interval = rating === 3 ? 2 : 1;
    } else if (repetitions === 1) {
      interval = rating === 1 ? Math.max(1, Math.round(interval * 1.2)) : 6;
    } else {
      interval = rating === 1
        ? Math.max(1, Math.round(interval * 1.2))
        : Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Nochmal — full reset
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor: EF' = EF + (0.1 - (3-q)*(0.08+(3-q)*0.02))
  const q = rating;
  easeFactor = easeFactor + (0.1 - (3 - q) * (0.08 + (3 - q) * 0.02));
  easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor);

  // Apply exam-aware cap only when an exam date is active
  if (daysUntilExam !== undefined && daysUntilExam > 0) {
    interval = capIntervalForExam(interval, daysUntilExam);
  }

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);
  nextReviewDate.setHours(0, 0, 0, 0);

  const now = new Date().toISOString();
  return {
    interval,
    repetitions,
    easeFactor: Math.round(easeFactor * 100) / 100,
    nextReviewDate: nextReviewDate.toISOString(),
    updatedAt: now,
    // Stamp firstStudiedAt only on the very first promotion. Otherwise leave
    // it untouched (returning undefined would clobber an existing value via
    // the partial-update spread in rateCard, so we explicitly preserve it).
    firstStudiedAt: isFirstPromotion ? now : card.firstStudiedAt,
  };
}

export function createInitialSRS(): Pick<Flashcard, 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'> {
  return {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReviewDate: new Date().toISOString(),
  };
}

// Returns days until exam (positive = future, 0 = today, negative = past), or undefined if no exam set
export function getDaysUntilExam(examDate?: string): number | undefined {
  if (!examDate) return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = new Date(examDate);
  exam.setHours(0, 0, 0, 0);
  return Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

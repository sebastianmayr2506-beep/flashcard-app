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

  if (rating >= 2) {
    // Correct response
    if (repetitions === 0) {
      // First review: Einfach gets a head-start of 2 days, Gut/Schwer stay at 1
      interval = rating === 3 ? 2 : 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Incorrect response — reset
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

  return {
    interval,
    repetitions,
    easeFactor: Math.round(easeFactor * 100) / 100,
    nextReviewDate: nextReviewDate.toISOString(),
    updatedAt: new Date().toISOString(),
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

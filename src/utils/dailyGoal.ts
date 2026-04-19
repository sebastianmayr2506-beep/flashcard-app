import type { Flashcard, AppSettings } from '../types/card';
import { isDueToday } from '../types/card';

// SM-2 cumulative days from introduction to complete N reviews (assuming "good" each time)
// intervals: 1, 4, 10, 25, 62… → cumulative: 1, 5, 15, 40, 102
const SM2_CUM = [0, 1, 5, 15, 40, 102, 257];

export interface PaceMetrics {
  requiredNewPerDay: number;     // SM-2 aware: cards/day to reach mastery by exam
  simpleNewPerDay: number;       // naive unseen÷days (for comparison)
  effectiveDays: number;         // days available for introducing new cards
  estimatedDailyReviews: number; // avg review load/day (existing + projected new)
  masteryRateAtExam: number;     // % of all cards that will be mastered (0–100)
  peakDailyLoad: number;         // new + reviews on busiest day
}

/** Full SM-2-aware pace calculation. Pass daysUntilExam > 0. */
export function calculatePaceMetrics(cards: Flashcard[], daysUntilExam: number): PaceMetrics {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const unseenCards = cards.filter(c => c.repetitions === 0);
  const seenCards   = cards.filter(c => c.repetitions  > 0);

  // A card needs ≥3 reviews to be "mastered". That takes SM2_CUM[3]=15 cumulative days.
  const MASTERY_REVIEWS = 3;
  const daysNeededForMastery = SM2_CUM[MASTERY_REVIEWS]; // 15

  // Effective days: days where a newly-introduced card can still complete MASTERY_REVIEWS reviews
  const effectiveDays = Math.max(1, daysUntilExam - daysNeededForMastery);

  const requiredNewPerDay = unseenCards.length > 0
    ? Math.ceil(unseenCards.length / effectiveDays)
    : 0;
  const simpleNewPerDay = unseenCards.length > 0
    ? Math.ceil(unseenCards.length / daysUntilExam)
    : 0;

  // ── Simulate daily review load ──────────────────────────────────────────────
  const horizon = daysUntilExam + 1;
  const reviewsPerDay = new Float32Array(horizon);

  // Reviews from already-seen cards
  seenCards.forEach(card => {
    let daysToNext = Math.max(0, Math.round(
      (new Date(card.nextReviewDate).getTime() - today.getTime()) / 86400000
    ));
    let interval = card.interval || 1;
    let ease = card.easeFactor || 2.5;

    while (daysToNext < horizon) {
      reviewsPerDay[daysToNext]++;
      interval = Math.max(1, Math.round(interval * ease));
      ease = Math.max(1.3, ease - 0.02);
      daysToNext += interval;
    }
  });

  // Reviews from new cards to be introduced at requiredNewPerDay/day
  const newCardReviewOffsets = SM2_CUM.slice(1, MASTERY_REVIEWS + 2); // [1,5,15,40]
  for (let d = 0; d < effectiveDays; d++) {
    for (const offset of newCardReviewOffsets) {
      const rd = d + offset;
      if (rd < horizon) reviewsPerDay[rd] += requiredNewPerDay;
    }
  }

  // Average daily reviews (skip first 2 days, which are usually low)
  const slice = Array.from(reviewsPerDay.slice(2));
  const avgDailyReviews = Math.round(slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length));
  const peakDailyLoad = Math.round(Math.max(...slice)) + requiredNewPerDay;

  // ── Mastery projection ──────────────────────────────────────────────────────
  const alreadyMastered = seenCards.filter(c => c.repetitions >= MASTERY_REVIEWS).length;

  // Partially-seen cards that will complete 3 reviews before exam
  const partialMastered = seenCards
    .filter(c => c.repetitions > 0 && c.repetitions < MASTERY_REVIEWS)
    .filter(card => {
      const daysToNext = Math.max(0, Math.round(
        (new Date(card.nextReviewDate).getTime() - today.getTime()) / 86400000
      ));
      const reviewsStillNeeded = MASTERY_REVIEWS - card.repetitions;
      return daysToNext + (SM2_CUM[reviewsStillNeeded] ?? 999) <= daysUntilExam;
    }).length;

  // New cards that will be mastered (those introduced within effectiveDays)
  const newCardsMastered = Math.min(unseenCards.length, effectiveDays * requiredNewPerDay);

  const totalMastered = alreadyMastered + partialMastered + newCardsMastered;
  const masteryRateAtExam = cards.length > 0
    ? Math.min(100, Math.round((totalMastered / cards.length) * 100))
    : 0;

  return {
    requiredNewPerDay,
    simpleNewPerDay,
    effectiveDays,
    estimatedDailyReviews: avgDailyReviews,
    masteryRateAtExam,
    peakDailyLoad,
  };
}

export interface DailyPlan {
  reviewCards: Flashcard[];   // due cards (repetitions > 0, due today)
  newCards: Flashcard[];      // unseen cards to learn today
  totalToday: number;
  daysUntilExam: number | null;
  examPassed: boolean;
  allLearned: boolean;
  isAheadOfSchedule: boolean;
  newCardsPerDay: number;     // calculated target
}

export function calculateDailyPlan(cards: Flashcard[], settings: AppSettings): DailyPlan {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Due reviews: already seen at least once, review is overdue
  const reviewCards = cards.filter(c => c.repetitions > 0 && isDueToday(c));

  // Unseen cards: never reviewed yet
  const unseenCards = cards.filter(c => c.repetitions === 0);

  // Days until exam
  let daysUntilExam: number | null = null;
  let examPassed = false;

  if (settings.examDate) {
    const exam = new Date(settings.examDate);
    exam.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    daysUntilExam = diffDays;
    if (diffDays < 0) examPassed = true;
  }

  // How many new cards for today
  // With exam date: auto-calculate required pace = ceil(unseen / days), capped at user's daily max
  // Without exam date: use the fixed dailyNewCardGoal
  let newCardsPerDay = settings.dailyNewCardGoal;
  let isAheadOfSchedule = false;

  if (daysUntilExam !== null && !examPassed && daysUntilExam > 0 && unseenCards.length > 0) {
    const requiredPace = Math.ceil(unseenCards.length / daysUntilExam);
    // Use required pace, capped at user's daily maximum
    newCardsPerDay = Math.min(settings.dailyNewCardGoal, requiredPace);
    if (requiredPace < settings.dailyNewCardGoal) isAheadOfSchedule = true;
  } else if (examPassed || daysUntilExam === 0) {
    // Exam is today or past — learn everything remaining, still respect daily max
    newCardsPerDay = Math.min(settings.dailyNewCardGoal, unseenCards.length);
  }

  const newCards = unseenCards.slice(0, Math.max(0, newCardsPerDay));

  const allLearned =
    cards.length > 0 &&
    unseenCards.length === 0 &&
    reviewCards.length === 0;

  return {
    reviewCards,
    newCards,
    totalToday: reviewCards.length + newCards.length,
    daysUntilExam,
    examPassed,
    allLearned,
    isAheadOfSchedule,
    newCardsPerDay,
  };
}

// Cards rated today (for progress bar)
export function getCardsRatedToday(cards: Flashcard[]): number {
  const today = new Date().toDateString();
  return cards.filter(c => new Date(c.updatedAt).toDateString() === today).length;
}

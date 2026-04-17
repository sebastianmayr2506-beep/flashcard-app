import type { Flashcard, AppSettings } from '../types/card';
import { isDueToday } from '../types/card';

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
  // Formula: min(userDailyGoal, ceil(unseenCards / daysUntilExam))
  // As exam approaches, ceil(unseen/days) rises → catches up to userDailyGoal
  let newCardsPerDay = settings.dailyNewCardGoal;
  let isAheadOfSchedule = false;

  if (daysUntilExam !== null && !examPassed && daysUntilExam > 0 && unseenCards.length > 0) {
    const catchup = Math.ceil(unseenCards.length / daysUntilExam);
    newCardsPerDay = Math.min(settings.dailyNewCardGoal, catchup);
    if (catchup < settings.dailyNewCardGoal) isAheadOfSchedule = true;
  } else if (examPassed || daysUntilExam === 0) {
    // Exam is today or past — learn everything remaining
    newCardsPerDay = unseenCards.length;
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

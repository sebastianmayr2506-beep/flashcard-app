export type Difficulty = 'einfach' | 'mittel' | 'schwer';
export type SRSStatus = 'neu' | 'lernend' | 'wiederholen' | 'beherrscht';

export interface CardImage {
  type: 'base64' | 'url';
  data: string; // base64 string or URL
  mimeType?: string;
}

export interface CardSet {
  id: string;
  userId: string;
  name: string;
  description?: string;
  subject?: string;
  examiner?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export const SET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6',
  '#f97316', '#a855f7', '#06b6d4', '#84cc16',
];

export interface Flashcard {
  id: string;
  front: string;
  frontImage?: CardImage;
  back: string;
  backImage?: CardImage;
  subjects: string[];
  examiners: string[];
  difficulty: Difficulty;
  customTags: string[];
  setId?: string;
  flagged?: boolean;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  // SM-2 SRS fields
  interval: number;       // days until next review
  repetitions: number;    // number of successful reviews
  easeFactor: number;     // multiplier (default 2.5)
  nextReviewDate: string; // ISO date string
}

export interface AppSettings {
  subjects: string[];
  examiners: string[];
  customTags: string[];
  studyStreak: number;
  lastStudiedDate: string | null;
  // Exam countdown & daily goal
  examDate?: string;        // ISO date string (YYYY-MM-DD)
  dailyNewCardGoal: number; // default: 10
  // Daily progress snapshot (resets each day)
  dailyPlanSnapshot?: {
    date: string;       // toDateString() key
    totalCards: number; // size of plan when "Jetzt lernen" was clicked
  };
  autoUnflagEnabled: boolean;        // remove flag after 2 correct days in Prüfungsmodus
  autoUnflagNotification?: {
    date: string;      // toDateString() key
    count: number;
    dismissed: boolean;
  };
}

export interface FlagAttempt {
  id: string;
  cardId: string;
  answeredCorrectly: boolean;
  attemptedAt: string; // YYYY-MM-DD calendar date
  createdAt: string;
}

export interface CardLink {
  id: string;
  cardId: string;
  linkedCardId: string;
  linkType: 'child' | 'related';
  createdAt: string;
}

export type RatingValue = 0 | 1 | 2 | 3; // Nochmal | Schwer | Gut | Einfach

export interface StudyRating {
  label: string;
  value: RatingValue;
  color: string;
  bgColor: string;
  hoverColor: string;
}

export const STUDY_RATINGS: StudyRating[] = [
  { label: 'Nochmal', value: 0, color: '#ef4444', bgColor: 'bg-red-500/10', hoverColor: 'hover:bg-red-500/20' },
  { label: 'Schwer',  value: 1, color: '#f59e0b', bgColor: 'bg-amber-500/10', hoverColor: 'hover:bg-amber-500/20' },
  { label: 'Gut',     value: 2, color: '#22c55e', bgColor: 'bg-green-500/10', hoverColor: 'hover:bg-green-500/20' },
  { label: 'Einfach', value: 3, color: '#3b82f6', bgColor: 'bg-blue-500/10', hoverColor: 'hover:bg-blue-500/20' },
];

export const DEFAULT_SUBJECTS = [
  'BWL', 'Personalmanagement', 'Unternehmensorganisation', 'Wirtschaftsrecht',
  'Marketing', 'Finanzmanagement', 'Steuerrecht', 'Kostenrechnung', 'VWL',
  'Rechnungswesen', 'Moderne Geschäftskonzepte', 'verantwortungsvolle Unternehmensführung',
  'Wirtschaftspolitik', 'Logistik', 'Projektmanagement', 'Wissenschaftliches Arbeiten',
  'Keine Ahnung', 'E-Commerce', 'Arbeitsrecht',
];

export const DEFAULT_EXAMINERS = [
  'Ulm', 'Hermann', 'Miksche', 'Raschke', 'Jaklin', 'Batka', 'Schieber',
  'Güttel', 'Bolzer/Hollaus', 'Gneisz-Al-Ani', 'Rainsberger', 'Rotter',
  'Rührig', 'Winter', 'Kessler', 'Wrbka',
];

export const getSRSStatus = (card: Flashcard): SRSStatus => {
  if (card.repetitions === 0) return 'neu';
  if (card.interval <= 1) return 'lernend';
  if (card.interval <= 21) return 'wiederholen';
  return 'beherrscht';
};

export const isDueToday = (card: Flashcard): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reviewDate = new Date(card.nextReviewDate);
  reviewDate.setHours(0, 0, 0, 0);
  return reviewDate <= today;
};

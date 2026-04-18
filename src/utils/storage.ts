import { supabase } from '../lib/supabase';
import type { Flashcard, AppSettings, CardImage, Difficulty } from '../types/card';
import { DEFAULT_SUBJECTS, DEFAULT_EXAMINERS } from '../types/card';

// ─── DB Row Types ─────────────────────────────────────────────

interface CardRow {
  id: string;
  front: string;
  front_image: CardImage | null;
  back: string;
  back_image: CardImage | null;
  subjects: string[];
  examiners: string[];
  difficulty: Difficulty;
  custom_tags: string[];
  created_at: string;
  updated_at: string;
  interval: number;
  repetitions: number;
  ease_factor: number;
  next_review_date: string;
}

interface SettingsRow {
  user_id?: string;
  subjects: string[];
  examiners: string[];
  custom_tags: string[];
  study_streak: number;
  last_studied_date: string | null;
  exam_date: string | null;
  daily_new_card_goal: number;
  daily_plan_snapshot: { date: string; totalCards: number } | null;
}

// ─── Mappers ──────────────────────────────────────────────────

function rowToCard(row: CardRow): Flashcard {
  return {
    id: row.id,
    front: row.front,
    frontImage: row.front_image ?? undefined,
    back: row.back,
    backImage: row.back_image ?? undefined,
    subjects: row.subjects ?? [],
    examiners: row.examiners ?? [],
    difficulty: row.difficulty,
    customTags: row.custom_tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    interval: row.interval,
    repetitions: row.repetitions,
    easeFactor: row.ease_factor,
    nextReviewDate: row.next_review_date,
  };
}

function cardToRow(card: Flashcard): Omit<CardRow, 'created_at' | 'updated_at'> {
  return {
    id: card.id,
    front: card.front,
    front_image: card.frontImage ?? null,
    back: card.back,
    back_image: card.backImage ?? null,
    subjects: card.subjects,
    examiners: card.examiners,
    difficulty: card.difficulty,
    custom_tags: card.customTags,
    interval: card.interval,
    repetitions: card.repetitions,
    ease_factor: card.easeFactor,
    next_review_date: card.nextReviewDate,
  };
}

const defaultSettings: AppSettings = {
  subjects: DEFAULT_SUBJECTS,
  examiners: DEFAULT_EXAMINERS,
  customTags: [],
  studyStreak: 0,
  lastStudiedDate: null,
  dailyNewCardGoal: 10,
};

function rowToSettings(row: SettingsRow): AppSettings {
  return {
    subjects: row.subjects?.length ? row.subjects : DEFAULT_SUBJECTS,
    examiners: row.examiners?.length ? row.examiners : DEFAULT_EXAMINERS,
    customTags: row.custom_tags ?? [],
    studyStreak: row.study_streak ?? 0,
    lastStudiedDate: row.last_studied_date ?? null,
    examDate: row.exam_date ?? undefined,
    dailyNewCardGoal: row.daily_new_card_goal ?? 10,
    dailyPlanSnapshot: row.daily_plan_snapshot ?? undefined,
  };
}

function settingsToRow(settings: AppSettings, userId: string): SettingsRow {
  return {
    user_id: userId,
    subjects: settings.subjects,
    examiners: settings.examiners,
    custom_tags: settings.customTags,
    study_streak: settings.studyStreak,
    last_studied_date: settings.lastStudiedDate,
    exam_date: settings.examDate ?? null,
    daily_new_card_goal: settings.dailyNewCardGoal,
    daily_plan_snapshot: settings.dailyPlanSnapshot ?? null,
  };
}

async function getUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

// ─── Cards ────────────────────────────────────────────────────

export async function getCards(): Promise<Flashcard[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as CardRow[]).map(rowToCard);
}

export async function saveCard(card: Flashcard): Promise<void> {
  const { error } = await supabase
    .from('cards')
    .upsert(cardToRow(card));
  if (error) throw error;
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await supabase
    .from('cards')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function saveAllCards(cards: Flashcard[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('cards')
    .delete()
    .not('id', 'is', null);
  if (delErr) throw delErr;
  if (cards.length > 0) {
    const { error: insErr } = await supabase
      .from('cards')
      .insert(cards.map(cardToRow));
    if (insErr) throw insErr;
  }
}

export async function insertCards(cards: Flashcard[]): Promise<void> {
  if (cards.length === 0) return;
  const { error } = await supabase
    .from('cards')
    .insert(cards.map(cardToRow));
  if (error) throw error;
}

// ─── Settings ─────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .single();
  if (error?.code === 'PGRST116') return { ...defaultSettings };
  if (error) throw error;
  return rowToSettings(data as SettingsRow);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('user_settings')
    .upsert(settingsToRow(settings, userId), { onConflict: 'user_id' });
  if (error) throw error;
}

// ─── Streak ───────────────────────────────────────────────────

export async function updateStreak(): Promise<AppSettings> {
  const settings = await getSettings();
  const today = new Date().toDateString();
  if (settings.lastStudiedDate === today) return settings;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isConsecutive = settings.lastStudiedDate === yesterday.toDateString();

  const updated: AppSettings = {
    ...settings,
    studyStreak: isConsecutive ? settings.studyStreak + 1 : 1,
    lastStudiedDate: today,
  };
  await saveSettings(updated);
  return updated;
}

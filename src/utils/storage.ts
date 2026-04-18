// ============================================================
// Storage Layer – localStorage implementation
//
// HOW TO REPLACE WITH SUPABASE:
// 1. Replace CARDS_KEY reads/writes with Supabase table queries:
//    - getCards()    → supabase.from('cards').select('*')
//    - saveCard()    → supabase.from('cards').upsert(card)
//    - deleteCard()  → supabase.from('cards').delete().eq('id', id)
// 2. Replace SETTINGS_KEY reads/writes with a user_settings table
//    or Supabase's user metadata.
// 3. Replace SETS_KEY reads/writes with Supabase sets table queries.
// 4. Remove all JSON.parse/JSON.stringify calls.
// 5. Add auth via supabase.auth for multi-user support.
//
// SUPABASE SQL (run in Supabase SQL editor):
// -- Sets table
// create table public.sets (
//   id uuid primary key default gen_random_uuid(),
//   user_id uuid references auth.users not null,
//   name text not null,
//   description text,
//   subject text,
//   examiner text,
//   color text default '#6366f1',
//   created_at timestamptz default now(),
//   updated_at timestamptz default now()
// );
// alter table public.sets enable row level security;
// create policy "own sets" on public.sets using (auth.uid() = user_id) with check (auth.uid() = user_id);
//
// -- Add set_id to cards
// alter table public.cards add column if not exists set_id uuid references public.sets(id) on delete set null;
//
// -- Shared sets table
// create table public.shared_sets (
//   id uuid primary key default gen_random_uuid(),
//   share_code text unique not null,
//   created_by uuid references auth.users not null,
//   set_data jsonb not null,
//   created_at timestamptz default now()
// );
// alter table public.shared_sets enable row level security;
// create policy "read shared sets"  on public.shared_sets for select using (true);
// create policy "create shares"     on public.shared_sets for insert with check (auth.uid() = created_by);
// create policy "delete own shares" on public.shared_sets for delete using (auth.uid() = created_by);
// ============================================================

import type { Flashcard, AppSettings, CardSet } from '../types/card';
import { DEFAULT_SUBJECTS, DEFAULT_EXAMINERS } from '../types/card';

const CARDS_KEY = 'flashcard_app_cards';
const SETTINGS_KEY = 'flashcard_app_settings';
const SETS_KEY = 'flashcard_app_sets';

// ─── Cards ───────────────────────────────────────────────────

export function getCards(): Flashcard[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const cards = JSON.parse(raw) as (Flashcard & { examiner?: string })[];
    // Migrate old single-field strings to arrays
    return cards.map(c => {
      const card = c as Flashcard & { examiner?: string; subject?: string };
      let result = { ...card };
      if (!Array.isArray(result.examiners)) {
        result = { ...result, examiners: card.examiner ? [card.examiner] : [] };
      }
      if (!Array.isArray((result as unknown as { subjects?: unknown }).subjects)) {
        const s = (result as unknown as { subject?: string }).subject;
        result = { ...result, subjects: s ? [s] : [] } as unknown as typeof result;
      }
      return result as unknown as Flashcard;
    });
  } catch {
    return [];
  }
}

export function saveCard(card: Flashcard): void {
  const cards = getCards();
  const idx = cards.findIndex(c => c.id === card.id);
  if (idx >= 0) {
    cards[idx] = card;
  } else {
    cards.push(card);
  }
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

export function deleteCard(id: string): void {
  const cards = getCards().filter(c => c.id !== id);
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

export function saveAllCards(cards: Flashcard[]): void {
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

// ─── Sets ────────────────────────────────────────────────────

export function getSets(): CardSet[] {
  try {
    const raw = localStorage.getItem(SETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CardSet[];
  } catch {
    return [];
  }
}

export function saveSet(set: CardSet): void {
  const sets = getSets();
  const idx = sets.findIndex(s => s.id === set.id);
  if (idx >= 0) {
    sets[idx] = set;
  } else {
    sets.push(set);
  }
  localStorage.setItem(SETS_KEY, JSON.stringify(sets));
}

export function deleteSet(id: string): void {
  const sets = getSets().filter(s => s.id !== id);
  localStorage.setItem(SETS_KEY, JSON.stringify(sets));
  // Clear set_id from any cards belonging to this set
  const cards = getCards().map(c => c.setId === id ? { ...c, setId: undefined } : c);
  saveAllCards(cards);
}

export function saveAllSets(sets: CardSet[]): void {
  localStorage.setItem(SETS_KEY, JSON.stringify(sets));
}

// ─── Settings ────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  subjects: DEFAULT_SUBJECTS,
  examiners: DEFAULT_EXAMINERS,
  customTags: [],
  studyStreak: 0,
  lastStudiedDate: null,
  dailyNewCardGoal: 10,
};

const OLD_PLACEHOLDER_EXAMINERS = new Set(['Prof. Müller', 'Prof. Schmidt', 'Prof. Weber', 'Prof. Fischer']);
const OLD_PLACEHOLDER_SUBJECTS = new Set(['Mathematik', 'BWL', 'Informatik', 'Statistik', 'Wirtschaftsrecht', 'Marketing', 'Rechnungswesen', 'VWL', 'Englisch']);

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const saved = JSON.parse(raw) as Partial<AppSettings>;
    if (Array.isArray(saved.examiners) && saved.examiners.every(e => OLD_PLACEHOLDER_EXAMINERS.has(e))) {
      saved.examiners = DEFAULT_EXAMINERS;
    }
    if (Array.isArray(saved.subjects) && saved.subjects.every(s => OLD_PLACEHOLDER_SUBJECTS.has(s))) {
      saved.subjects = DEFAULT_SUBJECTS;
    }
    return { ...defaultSettings, ...saved } as AppSettings;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Streak ──────────────────────────────────────────────────

export function updateStreak(): AppSettings {
  const settings = getSettings();
  const today = new Date().toDateString();
  const last = settings.lastStudiedDate;

  if (last === today) {
    return settings; // already studied today
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isConsecutive = last === yesterday.toDateString();

  const updated: AppSettings = {
    ...settings,
    studyStreak: isConsecutive ? settings.studyStreak + 1 : 1,
    lastStudiedDate: today,
  };
  saveSettings(updated);
  return updated;
}

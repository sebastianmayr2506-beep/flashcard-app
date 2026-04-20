import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue } from '../types/card';
import { supabase } from '../lib/supabase';
import { applySM2, createInitialSRS, getDaysUntilExam } from '../utils/srs';
import { getCards as getLocalCards } from '../utils/storage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(row: Record<string, any>): Flashcard {
  return {
    id: row.id,
    front: row.front,
    back: row.back,
    frontImage: row.front_image ?? undefined,
    backImage: row.back_image ?? undefined,
    subjects: row.subjects ?? [],
    examiners: row.examiners ?? [],
    difficulty: row.difficulty,
    customTags: row.custom_tags ?? [],
    setId: row.set_id ?? undefined,
    flagged: row.flagged ?? false,
    timesAsked: row.times_asked ?? 0,
    askedByExaminers: row.asked_by_examiners ?? [],
    askedInCatalogs: row.asked_in_catalogs ?? [],
    probabilityPercent: row.probability_percent ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    interval: row.interval ?? 0,
    repetitions: row.repetitions ?? 0,
    easeFactor: row.ease_factor ?? 2.5,
    nextReviewDate: row.next_review_date,
  };
}

function toDb(card: Flashcard, userId: string) {
  return {
    id: card.id,
    user_id: userId,
    front: card.front,
    back: card.back,
    front_image: card.frontImage ?? null,
    back_image: card.backImage ?? null,
    subjects: card.subjects,
    examiners: card.examiners,
    difficulty: card.difficulty,
    custom_tags: card.customTags,
    set_id: card.setId ?? null,
    flagged: card.flagged ?? false,
    times_asked: card.timesAsked ?? 0,
    asked_by_examiners: card.askedByExaminers ?? [],
    asked_in_catalogs: card.askedInCatalogs ?? [],
    probability_percent: card.probabilityPercent ?? 0,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
    interval: card.interval,
    repetitions: card.repetitions,
    ease_factor: card.easeFactor,
    next_review_date: card.nextReviewDate,
  };
}

export function useCards(userId: string | null) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const cardsRef = useRef<Flashcard[]>([]);

  // DEV: warn whenever card count drops unexpectedly
  useEffect(() => {
    const prev = cardsRef.current.length;
    const next = cards.length;
    if (prev > 0 && next < prev) {
      console.warn(`[useCards] ⚠️ Card count dropped: ${prev} → ${next} (−${prev - next})`, new Error().stack);
    }
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (!userId) {
      setCards([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const migrationKey = `supa_migrated_cards_${userId}`;

    const load = async () => {
      setLoading(true);
      try {
        const alreadyMigrated = localStorage.getItem(migrationKey) === '1';
        if (!alreadyMigrated) {
          const { data: existing } = await supabase
            .from('cards').select('id').eq('user_id', userId).limit(1);

          if ((existing ?? []).length === 0) {
            const localCards = getLocalCards();
            if (localCards.length > 0) {
              for (let i = 0; i < localCards.length; i += 100) {
                await supabase.from('cards').insert(
                  localCards.slice(i, i + 100).map(c => toDb(c, userId))
                );
              }
            }
          }
          localStorage.setItem(migrationKey, '1');
        }

        // Fetch all cards in pages of 1000 (Supabase default max-rows is 1000)
        let allRows: Record<string, unknown>[] = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('cards').select('*').eq('user_id', userId)
            .range(from, from + PAGE - 1);
          if (error) { console.error('Failed to load cards:', error); break; }
          allRows = allRows.concat(data ?? []);
          if ((data ?? []).length < PAGE) break; // last page
          from += PAGE;
        }

        if (!cancelled) {
          setCards(allRows.map(r => fromDb(r as Record<string, unknown>)));
          setLoading(false);
        }
      } catch (err) {
        console.error('useCards load error:', err);
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    let allRows: Record<string, unknown>[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from('cards').select('*').eq('user_id', userId)
        .range(from, from + PAGE - 1);
      allRows = allRows.concat(data ?? []);
      if ((data ?? []).length < PAGE) break;
      from += PAGE;
    }
    setCards(allRows.map(r => fromDb(r as Record<string, unknown>)));
  }, [userId]);

  const addCard = useCallback((
    data: Omit<Flashcard, 'id' | 'createdAt' | 'updatedAt' | 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'>
  ) => {
    if (!userId) return {} as Flashcard;
    const now = new Date().toISOString();
    const card: Flashcard = { ...data, id: uuidv4(), createdAt: now, updatedAt: now, ...createInitialSRS() };
    setCards(prev => [...prev, card]);
    supabase.from('cards').insert(toDb(card, userId)).then(({ error }) => {
      if (error) console.error('Failed to add card:', error);
    });
    return card;
  }, [userId]);

  const updateCard = useCallback((id: string, data: Partial<Flashcard>) => {
    if (!userId) return;
    const card = cardsRef.current.find(c => c.id === id);
    if (!card) return;
    const updated: Flashcard = { ...card, ...data, updatedAt: new Date().toISOString() };
    setCards(prev => prev.map(c => c.id === id ? updated : c));
    supabase.from('cards').upsert(toDb(updated, userId)).then(({ error }) => {
      if (error) console.error('Failed to update card:', error);
    });
  }, [userId]);

  const removeCard = useCallback((id: string) => {
    if (!userId) return;
    setCards(prev => prev.filter(c => c.id !== id));
    supabase.from('cards').delete().eq('id', id).eq('user_id', userId).then(({ error }) => {
      if (error) console.error('Failed to delete card:', error);
    });
  }, [userId]);

  const rateCard = useCallback((id: string, rating: RatingValue, examDate?: string) => {
    if (!userId) return;
    const card = cardsRef.current.find(c => c.id === id);
    if (!card) return;
    const updated: Flashcard = { ...card, ...applySM2(card, rating, getDaysUntilExam(examDate)) };
    setCards(prev => prev.map(c => c.id === id ? updated : c));
    supabase.from('cards').upsert(toDb(updated, userId)).then(({ error }) => {
      if (error) console.error('Failed to rate card:', error);
    });
  }, [userId]);

  const importCards = useCallback(async (newCards: Flashcard[], merge: boolean): Promise<{ ok: boolean; saved: number; expected: number }> => {
    if (!userId) return { ok: false, saved: 0, expected: 0 };
    const base = merge ? cardsRef.current : [];
    const existingIds = new Set(base.map(c => c.id));
    const toAdd = newCards.filter(c => !existingIds.has(c.id));
    const next = [...base, ...toAdd];
    setCards(next);
    cardsRef.current = next; // update immediately so sequential imports see correct state

    const CHUNK = 100;
    let failedChunk = false;

    // Insert a chunk with up to `retries` attempts. If a chunk of N fails,
    // fall back to splitting it in half (one bad card shouldn't kill the whole import).
    const insertChunkWithRetry = async (slice: Flashcard[], depth = 0): Promise<boolean> => {
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { error } = await supabase.from('cards').insert(slice.map(c => toDb(c, userId)));
        if (!error) return true;
        console.warn(`[importCards] chunk failed (size ${slice.length}, attempt ${attempt}):`, error.message);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 300 * attempt));
      }
      // All retries failed — try splitting (unless already at single card)
      if (slice.length > 1 && depth < 4) {
        const mid = Math.floor(slice.length / 2);
        const leftOk = await insertChunkWithRetry(slice.slice(0, mid), depth + 1);
        const rightOk = await insertChunkWithRetry(slice.slice(mid), depth + 1);
        return leftOk && rightOk;
      }
      console.error('[importCards] giving up on chunk:', slice.map(c => c.id));
      return false;
    };

    if (!merge) {
      const { error: delErr } = await supabase.from('cards').delete().eq('user_id', userId);
      if (delErr) { console.error('Failed to clear cards:', delErr); return { ok: false, saved: 0, expected: next.length }; }
      for (let i = 0; i < next.length; i += CHUNK) {
        const ok = await insertChunkWithRetry(next.slice(i, i + CHUNK));
        if (!ok) failedChunk = true;
      }
    } else if (toAdd.length > 0) {
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const ok = await insertChunkWithRetry(toAdd.slice(i, i + CHUNK));
        if (!ok) failedChunk = true;
      }
    }

    // Verify actual count in Supabase matches what we tried to save
    const { count } = await supabase
      .from('cards').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    const saved = count ?? 0;
    const expected = next.length;

    if (failedChunk || saved < expected) {
      console.error(`[importCards] Mismatch: saved ${saved} / expected ${expected}`);
    }

    return { ok: !failedChunk && saved >= expected, saved, expected };
  }, [userId]);

  return { cards, loading, refresh, addCard, updateCard, removeCard, rateCard, importCards };
}

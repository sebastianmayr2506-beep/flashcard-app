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

  useEffect(() => { cardsRef.current = cards; }, [cards]);

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

        const { data, error } = await supabase
          .from('cards').select('*').eq('user_id', userId);

        if (!cancelled) {
          if (error) console.error('Failed to load cards:', error);
          else setCards((data ?? []).map(fromDb));
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

  const refresh = useCallback(() => {
    if (!userId) return;
    supabase.from('cards').select('*').eq('user_id', userId).then(({ data }) => {
      if (data) setCards(data.map(fromDb));
    });
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

  const importCards = useCallback(async (newCards: Flashcard[], merge: boolean): Promise<void> => {
    if (!userId) return;
    const base = merge ? cardsRef.current : [];
    const existingIds = new Set(base.map(c => c.id));
    const toAdd = newCards.filter(c => !existingIds.has(c.id));
    const next = [...base, ...toAdd];
    setCards(next);
    cardsRef.current = next; // update immediately so sequential imports see correct state

    if (!merge) {
      const { error: delErr } = await supabase.from('cards').delete().eq('user_id', userId);
      if (delErr) { console.error('Failed to clear cards:', delErr); return; }
      if (next.length > 0) {
        const { error } = await supabase.from('cards').insert(next.map(c => toDb(c, userId)));
        if (error) console.error('Failed to import cards:', error);
      }
    } else if (toAdd.length > 0) {
      const { error } = await supabase.from('cards').insert(toAdd.map(c => toDb(c, userId)));
      if (error) console.error('Failed to import cards:', error);
    }
  }, [userId]);

  return { cards, loading, refresh, addCard, updateCard, removeCard, rateCard, importCards };
}

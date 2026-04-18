import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue } from '../types/card';
import { getCards, saveCard, deleteCard, saveAllCards, insertCards } from '../utils/storage';
import { applySM2, createInitialSRS, getDaysUntilExam } from '../utils/srs';

export function useCards() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCards()
      .then(setCards)
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    setCards(await getCards());
  }, []);

  const addCard = useCallback(async (data: Omit<Flashcard, 'id' | 'createdAt' | 'updatedAt' | 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'>) => {
    const now = new Date().toISOString();
    const card: Flashcard = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...createInitialSRS(),
    };
    setCards(prev => [...prev, card]);
    await saveCard(card);
    return card;
  }, []);

  const updateCard = useCallback(async (id: string, data: Partial<Flashcard>) => {
    const now = new Date().toISOString();
    let toSave: Flashcard | null = null;
    setCards(prev => prev.map(c => {
      if (c.id !== id) return c;
      toSave = { ...c, ...data, updatedAt: now };
      return toSave;
    }));
    if (toSave) await saveCard(toSave);
  }, []);

  const removeCard = useCallback(async (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    await deleteCard(id);
  }, []);

  const rateCard = useCallback(async (id: string, rating: RatingValue, examDate?: string) => {
    const daysUntilExam = getDaysUntilExam(examDate);
    let toSave: Flashcard | null = null;
    setCards(prev => prev.map(c => {
      if (c.id !== id) return c;
      toSave = { ...c, ...applySM2(c, rating, daysUntilExam) };
      return toSave;
    }));
    if (toSave) await saveCard(toSave);
  }, []);

  const importCards = useCallback(async (newCards: Flashcard[], merge: boolean) => {
    if (merge) {
      setCards(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const toAdd = newCards.filter(c => !existingIds.has(c.id));
        insertCards(toAdd);
        return [...prev, ...toAdd];
      });
    } else {
      setCards(newCards);
      await saveAllCards(newCards);
    }
  }, []);

  return { cards, loading, refresh, addCard, updateCard, removeCard, rateCard, importCards };
}

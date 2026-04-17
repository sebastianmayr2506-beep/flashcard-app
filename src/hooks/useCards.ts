import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue } from '../types/card';
import { getCards, saveCard, deleteCard, saveAllCards } from '../utils/storage';
import { applySM2, createInitialSRS, getDaysUntilExam } from '../utils/srs';

export function useCards() {
  const [cards, setCards] = useState<Flashcard[]>(() => getCards());

  const refresh = useCallback(() => {
    setCards(getCards());
  }, []);

  const addCard = useCallback((data: Omit<Flashcard, 'id' | 'createdAt' | 'updatedAt' | 'interval' | 'repetitions' | 'easeFactor' | 'nextReviewDate'>) => {
    const now = new Date().toISOString();
    const card: Flashcard = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...createInitialSRS(),
    };
    saveCard(card);
    setCards(getCards());
    return card;
  }, []);

  const updateCard = useCallback((id: string, data: Partial<Flashcard>) => {
    const cards = getCards();
    const card = cards.find(c => c.id === id);
    if (!card) return;
    const updated: Flashcard = { ...card, ...data, updatedAt: new Date().toISOString() };
    saveCard(updated);
    setCards(getCards());
  }, []);

  const removeCard = useCallback((id: string) => {
    deleteCard(id);
    setCards(getCards());
  }, []);

  const rateCard = useCallback((id: string, rating: RatingValue, examDate?: string) => {
    const cards = getCards();
    const card = cards.find(c => c.id === id);
    if (!card) return;
    const daysUntilExam = getDaysUntilExam(examDate);
    const updates = applySM2(card, rating, daysUntilExam);
    const updated: Flashcard = { ...card, ...updates };
    saveCard(updated);
    setCards(getCards());
  }, []);

  const importCards = useCallback((newCards: Flashcard[], merge: boolean) => {
    if (merge) {
      const existing = getCards();
      const existingIds = new Set(existing.map(c => c.id));
      const toAdd = newCards.filter(c => !existingIds.has(c.id));
      saveAllCards([...existing, ...toAdd]);
    } else {
      saveAllCards(newCards);
    }
    setCards(getCards());
  }, []);

  return { cards, refresh, addCard, updateCard, removeCard, rateCard, importCards };
}

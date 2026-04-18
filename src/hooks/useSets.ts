import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardSet } from '../types/card';
import { getSets, saveSet, deleteSet as storageDeleteSet, saveAllCards, getCards } from '../utils/storage';

export function useSets() {
  const [sets, setSets] = useState<CardSet[]>(() => getSets());

  const refresh = useCallback(() => {
    setSets(getSets());
  }, []);

  const addSet = useCallback((
    data: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>,
    userId: string
  ): CardSet => {
    const now = new Date().toISOString();
    const set: CardSet = { ...data, id: uuidv4(), userId, createdAt: now, updatedAt: now };
    saveSet(set);
    setSets(getSets());
    return set;
  }, []);

  const updateSet = useCallback((id: string, data: Partial<Omit<CardSet, 'id' | 'userId' | 'createdAt'>>) => {
    const current = getSets().find(s => s.id === id);
    if (!current) return;
    const updated: CardSet = { ...current, ...data, updatedAt: new Date().toISOString() };
    saveSet(updated);
    setSets(getSets());
  }, []);

  const removeSet = useCallback((id: string) => {
    storageDeleteSet(id);
    setSets(getSets());
  }, []);

  // Assign or unassign a card to a set
  const assignCardToSet = useCallback((cardId: string, setId: string | undefined) => {
    const cards = getCards().map(c => c.id === cardId ? { ...c, setId } : c);
    saveAllCards(cards);
  }, []);

  return { sets, refresh, addSet, updateSet, removeSet, assignCardToSet };
}

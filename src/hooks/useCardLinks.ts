import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardLink } from '../types/card';
import { getLinks, saveLink, deleteLink, saveAllLinks } from '../utils/storage';

export function useCardLinks() {
  const [links, setLinks] = useState<CardLink[]>(() => getLinks());

  const refresh = useCallback(() => setLinks(getLinks()), []);

  const addLink = useCallback((
    cardId: string,
    linkedCardId: string,
    linkType: 'child' | 'related' = 'related'
  ) => {
    const existing = getLinks();
    const alreadyExists = existing.some(l =>
      (l.cardId === cardId && l.linkedCardId === linkedCardId) ||
      (l.cardId === linkedCardId && l.linkedCardId === cardId)
    );
    if (alreadyExists) return;
    const link: CardLink = {
      id: uuidv4(),
      cardId,
      linkedCardId,
      linkType,
      createdAt: new Date().toISOString(),
    };
    saveLink(link);
    setLinks(getLinks());
  }, []);

  const removeLink = useCallback((id: string) => {
    deleteLink(id);
    setLinks(getLinks());
  }, []);

  const importLinks = useCallback((newLinks: CardLink[]) => {
    const existing = getLinks();
    const existingPairs = new Set(existing.map(l => `${l.cardId}:${l.linkedCardId}`));
    const toAdd = newLinks.filter(l =>
      !existingPairs.has(`${l.cardId}:${l.linkedCardId}`) &&
      !existingPairs.has(`${l.linkedCardId}:${l.cardId}`)
    );
    saveAllLinks([...existing, ...toAdd]);
    setLinks(getLinks());
  }, []);

  return { links, refresh, addLink, removeLink, importLinks };
}

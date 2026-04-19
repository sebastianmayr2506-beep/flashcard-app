import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardLink } from '../types/card';
import { supabase } from '../lib/supabase';
import { getLinks as getLocalLinks } from '../utils/storage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(row: Record<string, any>): CardLink {
  return {
    id: row.id,
    cardId: row.card_id,
    linkedCardId: row.linked_card_id,
    linkType: row.link_type,
    createdAt: row.created_at,
  };
}

function toDb(link: CardLink, userId: string) {
  return {
    id: link.id,
    user_id: userId,
    card_id: link.cardId,
    linked_card_id: link.linkedCardId,
    link_type: link.linkType,
    created_at: link.createdAt,
  };
}

export function useCardLinks(userId: string | null) {
  const [links, setLinks] = useState<CardLink[]>([]);
  const linksRef = useRef<CardLink[]>([]);

  useEffect(() => { linksRef.current = links; }, [links]);

  useEffect(() => {
    if (!userId) {
      setLinks([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const { data: existing } = await supabase
          .from('card_links').select('id').eq('user_id', userId).limit(1);

        if ((existing ?? []).length === 0) {
          const localLinks = getLocalLinks();
          if (localLinks.length > 0) {
            // Ignore FK errors — cards may not be migrated yet
            await supabase.from('card_links').insert(localLinks.map(l => toDb(l, userId)));
          }
        }

        const { data } = await supabase.from('card_links').select('*').eq('user_id', userId);
        if (!cancelled) setLinks((data ?? []).map(fromDb));
      } catch (err) {
        console.error('useCardLinks load error:', err);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const refresh = useCallback(() => {
    if (!userId) return;
    supabase.from('card_links').select('*').eq('user_id', userId).then(({ data }) => {
      if (data) setLinks(data.map(fromDb));
    });
  }, [userId]);

  const addLink = useCallback((
    cardId: string,
    linkedCardId: string,
    linkType: 'child' | 'related' = 'related'
  ) => {
    if (!userId) return;
    const alreadyExists = linksRef.current.some(l =>
      (l.cardId === cardId && l.linkedCardId === linkedCardId) ||
      (l.cardId === linkedCardId && l.linkedCardId === cardId)
    );
    if (alreadyExists) return;

    const link: CardLink = { id: uuidv4(), cardId, linkedCardId, linkType, createdAt: new Date().toISOString() };
    setLinks(prev => [...prev, link]);
    supabase.from('card_links').insert(toDb(link, userId)).then(({ error }) => {
      if (error && !error.message.includes('duplicate')) {
        console.error('Failed to add link:', error);
        setLinks(prev => prev.filter(l => l.id !== link.id));
      }
    });
  }, [userId]);

  const removeLink = useCallback((id: string) => {
    if (!userId) return;
    setLinks(prev => prev.filter(l => l.id !== id));
    supabase.from('card_links').delete().eq('id', id).eq('user_id', userId).then(({ error }) => {
      if (error) console.error('Failed to delete link:', error);
    });
  }, [userId]);

  const importLinks = useCallback((newLinks: CardLink[]) => {
    if (!userId) return;
    const existingPairs = new Set(linksRef.current.map(l => `${l.cardId}:${l.linkedCardId}`));
    const toAdd = newLinks.filter(l =>
      !existingPairs.has(`${l.cardId}:${l.linkedCardId}`) &&
      !existingPairs.has(`${l.linkedCardId}:${l.cardId}`)
    );
    if (toAdd.length === 0) return;
    setLinks(prev => [...prev, ...toAdd]);
    supabase.from('card_links').insert(toAdd.map(l => toDb(l, userId))).then(({ error }) => {
      if (error) console.error('Failed to import links:', error);
    });
  }, [userId]);

  return { links, refresh, addLink, removeLink, importLinks };
}

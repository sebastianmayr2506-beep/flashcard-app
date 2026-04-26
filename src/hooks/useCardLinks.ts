import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardLink } from '../types/card';
import { supabase } from '../lib/supabase';
import { getLinks as getLocalLinks } from '../utils/storage';
import { isExistingAccount } from '../utils/accountState';

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

    const migrationKey = `supa_migrated_links_${userId}`;

    const load = async () => {
      try {
        const alreadyMigrated = localStorage.getItem(migrationKey) === '1';
        if (!alreadyMigrated) {
          const { data: existing, error: existErr } = await supabase
            .from('card_links').select('id').eq('user_id', userId).limit(1);

          if (!existErr && (existing ?? []).length === 0) {
            // Resurrection guard — see useCards.ts for full explanation.
            const accountExists = await isExistingAccount(userId);
            if (accountExists === true) {
              localStorage.setItem(migrationKey, '1');
            } else if (accountExists === false) {
              const localLinks = getLocalLinks();
              if (localLinks.length > 0) {
                await supabase.from('card_links').insert(localLinks.map(l => toDb(l, userId)));
              }
              localStorage.setItem(migrationKey, '1');
            }
          } else if (!existErr) {
            localStorage.setItem(migrationKey, '1');
          }
        }

        const { data } = await supabase.from('card_links').select('*').eq('user_id', userId);
        if (!cancelled) setLinks((data ?? []).map(fromDb));
      } catch (err) {
        console.error('useCardLinks load error:', err);
      }
    };

    load();

    // Live-sync — links don't have an updated_at column, so INSERT/DELETE
    // are the meaningful events. We still handle UPDATE defensively (no-op
    // if id matches an existing link).
    const channel = supabase
      .channel(`card_links:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'card_links', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Record<string, unknown> | undefined;
            const id = oldRow && typeof oldRow.id === 'string' ? oldRow.id : null;
            if (!id) return;
            setLinks(prev => prev.filter(l => l.id !== id));
            return;
          }
          const newRow = payload.new as Record<string, unknown> | undefined;
          if (!newRow || typeof newRow !== 'object') return;
          const incoming = fromDb(newRow);
          setLinks(prev => {
            if (prev.some(l => l.id === incoming.id)) return prev; // already have it
            return [...prev, incoming];
          });
        },
      )
      .subscribe();

    const onFocus = () => { if (!cancelled) load(); };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
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

  // Force-replace ALL links in both state and Supabase.
  // Used after a non-merge card import — Supabase cascade-deletes links,
  // but React state still has them, so a plain `importLinks` would be a no-op.
  const replaceLinks = useCallback(async (newLinks: CardLink[]) => {
    if (!userId) return;
    await supabase.from('card_links').delete().eq('user_id', userId);
    setLinks(newLinks);
    linksRef.current = newLinks;
    if (newLinks.length === 0) return;
    const CHUNK = 100;
    for (let i = 0; i < newLinks.length; i += CHUNK) {
      const { error } = await supabase
        .from('card_links').insert(newLinks.slice(i, i + CHUNK).map(l => toDb(l, userId)));
      if (error) console.error('Failed to replace links chunk:', error);
    }
  }, [userId]);

  return { links, refresh, addLink, removeLink, importLinks, replaceLinks };
}

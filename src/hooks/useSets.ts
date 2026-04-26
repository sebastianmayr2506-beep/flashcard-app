import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardSet } from '../types/card';
import { supabase } from '../lib/supabase';
import { getSets as getLocalSets } from '../utils/storage';
import { isExistingAccount } from '../utils/accountState';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(row: Record<string, any>): CardSet {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    subject: row.subject ?? undefined,
    examiner: row.examiner ?? undefined,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDb(set: CardSet) {
  return {
    id: set.id,
    user_id: set.userId,
    name: set.name,
    description: set.description ?? null,
    subject: set.subject ?? null,
    examiner: set.examiner ?? null,
    color: set.color,
    created_at: set.createdAt,
    updated_at: set.updatedAt,
  };
}

export function useSets(userId: string | null) {
  const [sets, setSets] = useState<CardSet[]>([]);
  const setsRef = useRef<CardSet[]>([]);

  useEffect(() => { setsRef.current = sets; }, [sets]);

  useEffect(() => {
    if (!userId) {
      setSets([]);
      return;
    }
    let cancelled = false;

    const migrationKey = `supa_migrated_sets_${userId}`;

    const load = async () => {
      try {
        const alreadyMigrated = localStorage.getItem(migrationKey) === '1';
        if (!alreadyMigrated) {
          const { data: existing, error: existErr } = await supabase
            .from('sets').select('id').eq('user_id', userId).limit(1);

          if (!existErr && (existing ?? []).length === 0) {
            // Resurrection guard — see useCards.ts for full explanation.
            const accountExists = await isExistingAccount(userId);
            if (accountExists === true) {
              localStorage.setItem(migrationKey, '1');
            } else if (accountExists === false) {
              const localSets = getLocalSets();
              if (localSets.length > 0) {
                await supabase.from('sets').insert(localSets.map(toDb));
              }
              localStorage.setItem(migrationKey, '1');
            }
          } else if (!existErr) {
            localStorage.setItem(migrationKey, '1');
          }
        }

        const { data } = await supabase.from('sets').select('*').eq('user_id', userId);
        if (!cancelled) setSets((data ?? []).map(fromDb));
      } catch (err) {
        console.error('useSets load error:', err);
      }
    };

    load();

    // Live-sync — INSERT/UPDATE/DELETE from other devices.
    const channel = supabase
      .channel(`sets:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sets', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Record<string, unknown> | undefined;
            const id = oldRow && typeof oldRow.id === 'string' ? oldRow.id : null;
            if (!id) return;
            setSets(prev => prev.filter(s => s.id !== id));
            return;
          }
          const newRow = payload.new as Record<string, unknown> | undefined;
          if (!newRow || typeof newRow !== 'object') return;
          const incoming = fromDb(newRow);
          setSets(prev => {
            const idx = prev.findIndex(s => s.id === incoming.id);
            if (idx === -1) return [...prev, incoming];
            const local = prev[idx];
            if (local.updatedAt && incoming.updatedAt && incoming.updatedAt <= local.updatedAt) return prev;
            const next = prev.slice();
            next[idx] = incoming;
            return next;
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
    supabase.from('sets').select('*').eq('user_id', userId).then(({ data }) => {
      if (data) setSets(data.map(fromDb));
    });
  }, [userId]);

  const addSet = useCallback((
    data: Omit<CardSet, 'id' | 'createdAt' | 'updatedAt' | 'userId'>,
    ownerId: string
  ): CardSet => {
    const now = new Date().toISOString();
    const set: CardSet = { ...data, id: uuidv4(), userId: ownerId, createdAt: now, updatedAt: now };
    setSets(prev => [...prev, set]);
    supabase.from('sets').insert(toDb(set)).then(({ error }) => {
      if (error) console.error('Failed to add set:', error);
    });
    return set;
  }, []);

  const updateSet = useCallback((id: string, data: Partial<Omit<CardSet, 'id' | 'userId' | 'createdAt'>>) => {
    const current = setsRef.current.find(s => s.id === id);
    if (!current) return;
    const updated: CardSet = { ...current, ...data, updatedAt: new Date().toISOString() };
    setSets(prev => prev.map(s => s.id === id ? updated : s));
    supabase.from('sets').upsert(toDb(updated)).then(({ error }) => {
      if (error) console.error('Failed to update set:', error);
    });
  }, []);

  const removeSet = useCallback((id: string) => {
    if (!userId) return;
    setSets(prev => prev.filter(s => s.id !== id));
    supabase.from('sets').delete().eq('id', id).eq('user_id', userId).then(({ error }) => {
      if (error) console.error('Failed to delete set:', error);
    });
  }, [userId]);

  return { sets, refresh, addSet, updateSet, removeSet };
}

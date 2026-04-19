import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { CardSet } from '../types/card';
import { supabase } from '../lib/supabase';
import { getSets as getLocalSets } from '../utils/storage';

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

    const load = async () => {
      try {
        const { data: existing } = await supabase
          .from('sets').select('id').eq('user_id', userId).limit(1);

        if ((existing ?? []).length === 0) {
          const localSets = getLocalSets();
          if (localSets.length > 0) {
            await supabase.from('sets').insert(localSets.map(toDb));
          }
        }

        const { data } = await supabase.from('sets').select('*').eq('user_id', userId);
        if (!cancelled) setSets((data ?? []).map(fromDb));
      } catch (err) {
        console.error('useSets load error:', err);
      }
    };

    load();
    return () => { cancelled = true; };
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

import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { FlagAttempt } from '../types/card';
import { supabase } from '../lib/supabase';
import { getFlagAttempts as getLocalAttempts } from '../utils/storage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(row: Record<string, any>): FlagAttempt {
  return {
    id: row.id,
    cardId: row.card_id,
    answeredCorrectly: row.answered_correctly,
    attemptedAt: row.attempted_at,
    createdAt: row.created_at,
  };
}

export function useFlagAttempts(userId: string | null) {
  const [flagAttempts, setFlagAttempts] = useState<FlagAttempt[]>([]);

  useEffect(() => {
    if (!userId) {
      setFlagAttempts([]);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const { data: existing } = await supabase
          .from('flag_attempts').select('id').eq('user_id', userId).limit(1);

        if ((existing ?? []).length === 0) {
          const local = getLocalAttempts();
          if (local.length > 0) {
            await supabase.from('flag_attempts').insert(local.map(a => ({
              id: a.id,
              user_id: userId,
              card_id: a.cardId,
              answered_correctly: a.answeredCorrectly,
              attempted_at: a.attemptedAt,
              created_at: a.createdAt,
            })));
          }
        }

        const { data } = await supabase.from('flag_attempts').select('*').eq('user_id', userId);
        if (!cancelled) setFlagAttempts((data ?? []).map(fromDb));
      } catch (err) {
        console.error('useFlagAttempts load error:', err);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const addAttempt = useCallback((cardId: string, answeredCorrectly: boolean) => {
    if (!userId) return;
    const today = new Date().toISOString().split('T')[0];
    const attempt: FlagAttempt = {
      id: uuidv4(),
      cardId,
      answeredCorrectly,
      attemptedAt: today,
      createdAt: new Date().toISOString(),
    };
    setFlagAttempts(prev => [...prev, attempt]);
    supabase.from('flag_attempts').insert({
      id: attempt.id,
      user_id: userId,
      card_id: attempt.cardId,
      answered_correctly: attempt.answeredCorrectly,
      attempted_at: attempt.attemptedAt,
      created_at: attempt.createdAt,
    }).then(({ error }) => {
      if (error) console.error('Failed to save flag attempt:', error);
    });
  }, [userId]);

  const getDistinctCorrectDays = useCallback((cardId: string, extraAttempts: FlagAttempt[] = []): number => {
    const all = [...flagAttempts, ...extraAttempts];
    const days = new Set(
      all.filter(a => a.cardId === cardId && a.answeredCorrectly).map(a => a.attemptedAt)
    );
    return days.size;
  }, [flagAttempts]);

  return { flagAttempts, addAttempt, getDistinctCorrectDays };
}

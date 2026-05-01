import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue } from '../types/card';
import { supabase } from '../lib/supabase';
import { applySM2, createInitialSRS, getDaysUntilExam } from '../utils/srs';
import { getCards as getLocalCards } from '../utils/storage';
import { isExistingAccount } from '../utils/accountState';

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
    firstStudiedAt: row.first_studied_at ?? undefined,
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
    first_studied_at: card.firstStudiedAt ?? null,
  };
}

export function useCards(userId: string | null) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cardsRef = useRef<Flashcard[]>([]);

  // DEV: warn whenever card count drops unexpectedly
  useEffect(() => {
    const prev = cardsRef.current.length;
    const next = cards.length;
    if (prev > 0 && next < prev) {
      console.warn(`[useCards] ⚠️ Card count dropped: ${prev} → ${next} (−${prev - next})`, new Error().stack);
    }
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (!userId) {
      setCards([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const migrationKey = `supa_migrated_cards_${userId}`;

    // Safe fetch with retry — returns { rows, ok } where ok=false means we
    // cannot trust the result (DO NOT overwrite card state).
    const fetchAllCardsWithRetry = async (): Promise<{ rows: Record<string, unknown>[]; ok: boolean }> => {
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let allRows: Record<string, unknown>[] = [];
        let from = 0;
        const PAGE = 1000;
        let hadError = false;
        while (true) {
          const { data, error } = await supabase
            .from('cards').select('*').eq('user_id', userId)
            .range(from, from + PAGE - 1);
          if (error) {
            console.error(`[useCards] load attempt ${attempt} failed:`, error);
            hadError = true;
            break;
          }
          allRows = allRows.concat(data ?? []);
          if ((data ?? []).length < PAGE) break;
          from += PAGE;
        }
        if (!hadError) return { rows: allRows, ok: true };
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
      return { rows: [], ok: false };
    };

    // Re-fetch cards from Supabase WITHOUT toggling the loading flag.
    // Used for window-focus refetches and live-sync recovery so the user
    // doesn't get bumped to the App.tsx "Laden…" screen mid-operation
    // (which unmounts the entire UI tree — including any open import or
    // edit modal — and silently kills the file picker / pending edit).
    const refetch = async () => {
      const { rows, ok } = await fetchAllCardsWithRetry();
      if (cancelled || !ok) return;
      setCards(rows.map(r => fromDb(r as Record<string, unknown>)));
    };

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const alreadyMigrated = localStorage.getItem(migrationKey) === '1';
        if (!alreadyMigrated) {
          const { data: existing, error: existErr } = await supabase
            .from('cards').select('id').eq('user_id', userId).limit(1);

          // SAFETY: only migrate localStorage → Supabase if we can verify
          // Supabase is truly empty. A failed query must NOT trigger migration
          // (could duplicate existing data or corrupt state).
          if (!existErr && (existing ?? []).length === 0) {
            // RESURRECTION GUARD: an empty `cards` table can mean two things:
            //   (a) brand-new user → migration is correct
            //   (b) existing user who deleted everything → migration would
            //       resurrect zombie cards from this device's stale localStorage,
            //       wiping out the user's intentional deletion (cross-device).
            // We disambiguate by checking if the user has a `user_settings` row
            // (created by useSettings on first-ever app open). Existence ⇒ not
            // brand-new ⇒ skip migration. (Network error ⇒ skip too, fail-safe.)
            const accountExists = await isExistingAccount(userId);
            if (accountExists === true) {
              console.info('[useCards] existing account with empty cards — skipping migration (deletion respected)');
              localStorage.setItem(migrationKey, '1');
            } else if (accountExists === false) {
              const localCards = getLocalCards();
              if (localCards.length > 0) {
                for (let i = 0; i < localCards.length; i += 100) {
                  await supabase.from('cards').insert(
                    localCards.slice(i, i + 100).map(c => toDb(c, userId))
                  );
                }
              }
              localStorage.setItem(migrationKey, '1');
            }
            // accountExists === null (network error) → don't set flag, retry next load
          } else if (!existErr) {
            // Supabase has data — migration not needed, mark as done
            localStorage.setItem(migrationKey, '1');
          }
          // If existErr: do NOT set migration flag, retry next load
        }

        const { rows, ok } = await fetchAllCardsWithRetry();
        if (cancelled) return;

        if (!ok) {
          // CRITICAL: fetch failed after retries — do NOT clear card state.
          // Surface an error so the UI can show a reload banner.
          console.error('[useCards] All load attempts failed — keeping previous state');
          setLoadError('Karten konnten nicht geladen werden. Bitte Seite neu laden.');
          setLoading(false);
          return;
        }

        setCards(rows.map(r => fromDb(r as Record<string, unknown>)));
        setLoading(false);
      } catch (err) {
        console.error('useCards load error:', err);
        if (!cancelled) {
          setLoadError('Karten konnten nicht geladen werden. Bitte Seite neu laden.');
          setLoading(false);
        }
      }
    };

    load();

    // Live-sync: pick up cards changes from other devices in real time.
    // INSERT  → add to state (idempotent: skip if id already present)
    // UPDATE  → replace by id, but only if incoming updated_at > local
    //          (prevents an own-echo from overwriting fresher optimistic state)
    // DELETE  → remove by id from state
    //
    // Plus a window.focus refetch as a safety net: mobile Safari often
    // suspends the realtime channel when the tab goes to background.
    const channel = supabase
      .channel(`cards:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cards', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Record<string, unknown> | undefined;
            const id = oldRow && typeof oldRow.id === 'string' ? oldRow.id : null;
            if (!id) return;
            setCards(prev => prev.filter(c => c.id !== id));
            return;
          }
          const newRow = payload.new as Record<string, unknown> | undefined;
          if (!newRow || typeof newRow !== 'object') return;
          const incoming = fromDb(newRow);
          setCards(prev => {
            const idx = prev.findIndex(c => c.id === incoming.id);
            if (idx === -1) return [...prev, incoming]; // INSERT or unseen id
            // UPDATE — only apply if strictly newer than what we have
            const local = prev[idx];
            if (local.updatedAt && incoming.updatedAt && incoming.updatedAt <= local.updatedAt) return prev;
            const next = prev.slice();
            next[idx] = incoming;
            return next;
          });
        },
      )
      .subscribe();

    const onFocus = () => {
      // Re-fetch on tab focus (channel may have been suspended). Use refetch,
      // NOT load() — load() flips setLoading(true) which forces App.tsx into
      // the "Laden…" screen, unmounting any open file picker / edit modal
      // and silently killing in-progress imports or image uploads. The fast
      // refetch only swaps cards state in place, leaving the UI tree intact.
      if (!cancelled) refetch();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    let allRows: Record<string, unknown>[] = [];
    let from = 0;
    const PAGE = 1000;
    let hadError = false;
    while (true) {
      const { data, error } = await supabase
        .from('cards').select('*').eq('user_id', userId)
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[useCards] refresh failed:', error);
        hadError = true;
        break;
      }
      allRows = allRows.concat(data ?? []);
      if ((data ?? []).length < PAGE) break;
      from += PAGE;
    }
    // SAFETY: only overwrite state if the refresh succeeded end-to-end
    if (!hadError) {
      setCards(allRows.map(r => fromDb(r as Record<string, unknown>)));
    }
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

  const importCards = useCallback(async (newCards: Flashcard[], merge: boolean): Promise<{ ok: boolean; saved: number; expected: number }> => {
    if (!userId) return { ok: false, saved: 0, expected: 0 };
    const base = merge ? cardsRef.current : [];
    const existingIds = new Set(base.map(c => c.id));
    const toAdd = newCards.filter(c => !existingIds.has(c.id));
    const next = [...base, ...toAdd];
    setCards(next);
    cardsRef.current = next; // update immediately so sequential imports see correct state

    const CHUNK = 100;
    let failedChunk = false;

    // Insert a chunk with up to `retries` attempts. If a chunk of N fails,
    // fall back to splitting it in half (one bad card shouldn't kill the whole import).
    const insertChunkWithRetry = async (slice: Flashcard[], depth = 0): Promise<boolean> => {
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { error } = await supabase.from('cards').insert(slice.map(c => toDb(c, userId)));
        if (!error) return true;
        console.warn(`[importCards] chunk failed (size ${slice.length}, attempt ${attempt}):`, error.message);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 300 * attempt));
      }
      // All retries failed — try splitting (unless already at single card)
      if (slice.length > 1 && depth < 4) {
        const mid = Math.floor(slice.length / 2);
        const leftOk = await insertChunkWithRetry(slice.slice(0, mid), depth + 1);
        const rightOk = await insertChunkWithRetry(slice.slice(mid), depth + 1);
        return leftOk && rightOk;
      }
      console.error('[importCards] giving up on chunk:', slice.map(c => c.id));
      return false;
    };

    if (!merge) {
      const { error: delErr } = await supabase.from('cards').delete().eq('user_id', userId);
      if (delErr) { console.error('Failed to clear cards:', delErr); return { ok: false, saved: 0, expected: next.length }; }
      for (let i = 0; i < next.length; i += CHUNK) {
        const ok = await insertChunkWithRetry(next.slice(i, i + CHUNK));
        if (!ok) failedChunk = true;
      }
    } else if (toAdd.length > 0) {
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const ok = await insertChunkWithRetry(toAdd.slice(i, i + CHUNK));
        if (!ok) failedChunk = true;
      }
    }

    // Verify actual count in Supabase matches what we tried to save
    const { count } = await supabase
      .from('cards').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    const saved = count ?? 0;
    const expected = next.length;

    if (failedChunk || saved < expected) {
      console.error(`[importCards] Mismatch: saved ${saved} / expected ${expected}`);
    }

    return { ok: !failedChunk && saved >= expected, saved, expected };
  }, [userId]);

  return { cards, loading, loadError, refresh, addCard, updateCard, removeCard, rateCard, importCards };
}

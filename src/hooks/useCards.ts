import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, RatingValue } from '../types/card';
import { supabase } from '../lib/supabase';
import { applySM2, createInitialSRS, getDaysUntilExam } from '../utils/srs';
import { getCards as getLocalCards } from '../utils/storage';
import { isExistingAccount } from '../utils/accountState';

// Spalten ohne `front_image` und `back_image` — base64-Bilder sind 10-100x
// schwerer als der Rest. Wird in load(), refetch() und refresh() benutzt um
// den Initial-/Refresh-Payload klein zu halten. Bilder kommen separat im
// Hintergrund via fetchImages*().
const META_COLUMNS =
  'id, user_id, front, back, subjects, examiners, difficulty, custom_tags, ' +
  'set_ids, flagged, times_asked, asked_by_examiners, asked_in_catalogs, ' +
  'probability_percent, created_at, updated_at, interval, repetitions, ' +
  'ease_factor, next_review_date, first_studied_at, priority, mc_questions, ' +
  'mc_questions_generated_at, blacklisted, card_number, gaps';

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
    // Backward-compat: nimm set_ids wenn vorhanden, sonst aus altem set_id ableiten
    setIds: Array.isArray(row.set_ids)
      ? (row.set_ids as string[])
      : (row.set_id ? [row.set_id as string] : []),
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
    priority: (row.priority === 'A' || row.priority === 'B' || row.priority === 'C') ? row.priority : undefined,
    priorityLocked: !!row.priority_locked,
    mcQuestions: Array.isArray(row.mc_questions) ? row.mc_questions as Flashcard['mcQuestions'] : undefined,
    mcQuestionsGeneratedAt: typeof row.mc_questions_generated_at === 'string' ? row.mc_questions_generated_at : undefined,
    blacklisted: !!row.blacklisted,
    cardNumber: typeof row.card_number === 'number' ? row.card_number : undefined,
    gaps: Array.isArray(row.gaps) ? (row.gaps as string[]) : undefined,
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
    set_ids: card.setIds ?? [],
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
    priority: card.priority ?? null,
    priority_locked: card.priorityLocked ?? false,
    mc_questions: card.mcQuestions ?? null,
    mc_questions_generated_at: card.mcQuestionsGeneratedAt ?? null,
    blacklisted: card.blacklisted ?? false,
    gaps: card.gaps ?? null,
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
    //
    // Two-stage fetch (Performance):
    //   Stage 1: metadata only (no base64 images) → small payload, fast.
    //            UI rendert sofort sobald das durch ist.
    //   Stage 2: front_image + back_image im Hintergrund nachladen → wird
    //            mergebar in den schon-gesetzten State.
    //
    // Grund: bei mehreren parallelen Usern saturiert `select('*')` mit allen
    // base64-Images den Postgres-Connection-Pool. Image-Daten sind 10-100x
    // schwerer pro Karte als der Rest. Mit Stage 1 dauert eine 1037-Karten-
    // Antwort ~500 KB statt 50 MB → Pool dreht sich schneller.
    //
    // Retry-Ladder mit JITTER: 5 Versuche × exponentielles Backoff
    // (1s/2s/4s/8s/12s) + ±50% Zufall, damit gleichzeitig-failing User nicht
    // synchron retryen (retry-storm würde den Pool gleich wieder killen).
    const jitter = (ms: number) => Math.round(ms * (0.5 + Math.random())); // ±50%

    const fetchAllCardsWithRetry = async (): Promise<{ rows: Record<string, unknown>[]; ok: boolean }> => {
      const MAX_ATTEMPTS = 5;
      const BASE_BACKOFFS_MS = [1000, 2000, 4000, 8000, 12000];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let allRows: Record<string, unknown>[] = [];
        let from = 0;
        const PAGE = 1000;
        let hadError = false;
        while (true) {
          const { data, error } = await supabase
            .from('cards').select(META_COLUMNS).eq('user_id', userId)
            .range(from, from + PAGE - 1);
          if (error) {
            console.warn(`[useCards] load attempt ${attempt}/${MAX_ATTEMPTS} failed:`, error.message);
            hadError = true;
            break;
          }
          // Cast to plain records — Supabase types the result based on the
          // column-list string, but fromDb just needs a generic object lookup.
          const rows = (data ?? []) as unknown as Record<string, unknown>[];
          allRows = allRows.concat(rows);
          if (rows.length < PAGE) break;
          from += PAGE;
        }
        if (!hadError) {
          if (attempt > 1) console.info(`[useCards] load succeeded on attempt ${attempt}`);
          return { rows: allRows, ok: true };
        }
        if (attempt < MAX_ATTEMPTS) {
          const wait = jitter(BASE_BACKOFFS_MS[attempt - 1] ?? 8000);
          await new Promise(r => setTimeout(r, wait));
        }
      }
      console.error('[useCards] all load attempts exhausted');
      return { rows: [], ok: false };
    };

    // Background-Fetch der Bilder NACH dem ersten Render. Best-effort:
    // wenn's failed bleiben die Bilder einfach undefined und die UI zeigt
    // die Karten ohne Bild — beim nächsten Tab-Focus probiert's automatisch
    // wieder über den normalen refetch-Pfad.
    const fetchImagesInBackground = async (knownIds: string[]) => {
      if (knownIds.length === 0) return;
      try {
        let from = 0;
        const PAGE = 500; // kleiner als Stage 1 weil Bilder schwerer
        while (true) {
          const { data, error } = await supabase
            .from('cards').select('id, front_image, back_image')
            .eq('user_id', userId)
            .range(from, from + PAGE - 1);
          if (error || !data) {
            console.warn('[useCards] image background fetch failed:', error?.message);
            return;
          }
          if (cancelled) return;
          setCards(prev => prev.map(c => {
            const img = data.find(d => (d as { id: string }).id === c.id) as { id: string; front_image?: unknown; back_image?: unknown } | undefined;
            if (!img) return c;
            return {
              ...c,
              frontImage: (img.front_image as typeof c.frontImage) ?? c.frontImage,
              backImage: (img.back_image as typeof c.backImage) ?? c.backImage,
            };
          }));
          if (data.length < PAGE) break;
          from += PAGE;
        }
      } catch (err) {
        console.warn('[useCards] image background fetch crashed:', err);
      }
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
      // Background-Refresh der Bilder — sonst würden Bilder die der User in
      // einem anderen Gerät bearbeitet hat nicht mitkommen.
      void fetchImagesInBackground(rows.map(r => (r as { id: string }).id));
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
        // Stage 2: Bilder im Hintergrund nachladen. UI ist schon interaktiv,
        // Bilder ploppen rein wenn sie da sind. Bei Lastspitzen wartet das
        // ein paar Sekunden — egal, der User kann schon klicken.
        void fetchImagesInBackground(rows.map(r => (r as { id: string }).id));
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

    // Re-fetch on tab focus (channel may have been suspended). Throttled
    // to once per 10s to avoid thunder-herding the DB when a multi-tab user
    // rapidly switches between windows. The Realtime channel handles
    // intermediate updates anyway — focus-refetch is just a safety net for
    // missed events.
    let lastFocusFetch = 0;
    const onFocus = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFocusFetch < 10_000) return;
      lastFocusFetch = now;
      refetch();
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
    // Stage 1: meta-only fetch (same slim pattern as load()/refetch()).
    let allRows: Record<string, unknown>[] = [];
    let from = 0;
    const PAGE = 1000;
    let hadError = false;
    while (true) {
      const { data, error } = await supabase
        .from('cards').select(META_COLUMNS).eq('user_id', userId)
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[useCards] refresh failed:', error);
        hadError = true;
        break;
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      allRows = allRows.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    // SAFETY: only overwrite state if the refresh succeeded end-to-end
    if (hadError) return;
    setCards(allRows.map(r => fromDb(r as Record<string, unknown>)));

    // Stage 2: backfill images in the background. Best-effort.
    try {
      let imgFrom = 0;
      const IMG_PAGE = 500;
      while (true) {
        const { data, error } = await supabase
          .from('cards').select('id, front_image, back_image')
          .eq('user_id', userId).range(imgFrom, imgFrom + IMG_PAGE - 1);
        if (error || !data) {
          console.warn('[useCards] refresh image-stage failed:', error?.message);
          return;
        }
        setCards(prev => prev.map(c => {
          const img = data.find(d => (d as { id: string }).id === c.id) as { id: string; front_image?: unknown; back_image?: unknown } | undefined;
          if (!img) return c;
          return {
            ...c,
            frontImage: (img.front_image as typeof c.frontImage) ?? c.frontImage,
            backImage: (img.back_image as typeof c.backImage) ?? c.backImage,
          };
        }));
        if (data.length < IMG_PAGE) break;
        imgFrom += IMG_PAGE;
      }
    } catch (err) {
      console.warn('[useCards] refresh image-stage crashed:', err);
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
      if (error) console.error('[useCards] Failed to update card:', error);
    });
  }, [userId]);

  // Bulk update — for operations like auto-classify-priority that touch many
  // cards at once. Single React render + chunked Supabase upserts instead of
  // 1000+ individual updateCard calls. Returns the count of cards actually
  // changed (entries with id not found in current state are skipped).
  const bulkUpdate = useCallback(async (updates: Array<{ id: string; patch: Partial<Flashcard> }>): Promise<number> => {
    if (!userId || updates.length === 0) return 0;
    const now = new Date().toISOString();
    const byId = new Map(updates.map(u => [u.id, u.patch]));

    // Build a single new state slice with all patches applied
    let touched = 0;
    const next = cardsRef.current.map(c => {
      const patch = byId.get(c.id);
      if (!patch) return c;
      touched++;
      return { ...c, ...patch, updatedAt: now };
    });
    setCards(next);
    cardsRef.current = next;

    // Chunked Supabase upserts (Postgres has a row limit per upsert call)
    const CHUNK = 200;
    const rows = next.filter(c => byId.has(c.id)).map(c => toDb(c, userId));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from('cards').upsert(rows.slice(i, i + CHUNK));
      if (error) console.error('[useCards] bulkUpdate chunk failed:', error);
    }
    return touched;
  }, [userId]);

  const removeCard = useCallback((id: string) => {
    if (!userId) return;
    setCards(prev => prev.filter(c => c.id !== id));
    supabase.from('cards').delete().eq('id', id).eq('user_id', userId).then(({ error }) => {
      if (error) console.error('Failed to delete card:', error);
    });
  }, [userId]);

  // Bulk-delete with chunked .in() queries. Replaces the previous pattern of
  // firing N individual removeCard() calls — at scale (>500) Supabase would
  // rate-limit/drop some of the parallel requests silently, leaving "phantom"
  // cards that reappeared on reload. Now: one query per chunk, awaited, with
  // an actual server-side count check at the end so callers can react to
  // partial failures.
  const bulkRemove = useCallback(async (cardIds: string[]): Promise<{ ok: boolean; deleted: number; expected: number }> => {
    if (!userId || cardIds.length === 0) return { ok: true, deleted: 0, expected: 0 };
    const ids = Array.from(new Set(cardIds));
    // Optimistic local removal so the UI feels instant.
    setCards(prev => prev.filter(c => !ids.includes(c.id)));

    const CHUNK = 100;
    const MAX_ATTEMPTS = 3;
    let allOk = true;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      let chunkOk = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { error } = await supabase
          .from('cards').delete().in('id', slice).eq('user_id', userId);
        if (!error) { chunkOk = true; break; }
        console.warn(`[bulkRemove] chunk failed (size ${slice.length}, attempt ${attempt}):`, error.message);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 300 * attempt));
      }
      if (!chunkOk) allOk = false;
    }

    // Verify — query the count of any remaining rows in the set we tried to delete.
    // If anything is left, restore them locally so state ↔ DB stay consistent.
    let stillPresent = 0;
    {
      // Supabase's PostgREST .in() has a URL length limit (~1KB). Verify in chunks too.
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { count } = await supabase
          .from('cards').select('id', { count: 'exact', head: true })
          .in('id', slice).eq('user_id', userId);
        stillPresent += count ?? 0;
      }
    }
    if (stillPresent > 0) {
      console.error(`[bulkRemove] ${stillPresent}/${ids.length} cards still present after delete`);
      // Re-fetch full list so phantom rows show up in the UI again rather than
      // creating a false "looks deleted" state.
      await refresh();
      allOk = false;
    }

    return { ok: allOk, deleted: ids.length - stillPresent, expected: ids.length };
  }, [userId]);

  const rateCard = useCallback((id: string, rating: RatingValue, examDate?: string) => {
    if (!userId) return;
    const card = cardsRef.current.find(c => c.id === id);
    if (!card) return;
    const updated: Flashcard = { ...card, ...applySM2(card, rating, getDaysUntilExam(examDate)) };
    setCards(prev => prev.map(c => c.id === id ? updated : c));
    supabase.from('cards').upsert(toDb(updated, userId)).then(({ error }) => {
      if (error) console.error('[useCards] Failed to rate card:', error);
    });
  }, [userId]);

  const importCards = useCallback(async (newCards: Flashcard[], merge: boolean): Promise<{ ok: boolean; saved: number; expected: number }> => {
    if (!userId) return { ok: false, saved: 0, expected: 0 };
    const base = merge ? cardsRef.current : [];
    const existingContent = new Set(base.map(c => `${c.front}\0${c.back}`));
    const toAdd = newCards
      .filter(c => !existingContent.has(`${c.front}\0${c.back}`))
      .map(c => ({ ...c, id: uuidv4() }));
    const next = [...base, ...toAdd];
    setCards(next);
    cardsRef.current = next; // update immediately so sequential imports see correct state

    const CHUNK = 100;
    // Inter-chunk-Atempause. Verhindert dass ein User mit großem Import (1000+
    // Karten = 10+ Chunks) den DB-Pool für andere User blockiert. 150ms pro
    // 100-Karten-Chunk = ~1.5s zusätzliche Latenz auf 1000-Karten-Import, dafür
    // bleibt die DB für gleichzeitige Reads anderer User responsive.
    const CHUNK_BREATHER_MS = 150;
    let failedChunk = false;

    // Insert a chunk with retries. Erhöht von 3 → 5 Versuchen mit längerem
    // Backoff (300 → 600 → 1200 → 2000ms) — Lastspitzen brauchen Geduld.
    const insertChunkWithRetry = async (slice: Flashcard[], depth = 0): Promise<boolean> => {
      const MAX_ATTEMPTS = 5;
      const BACKOFFS_MS = [300, 600, 1200, 2000];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const { error } = await supabase.from('cards').insert(slice.map(c => toDb(c, userId)));
        if (!error) return true;
        console.warn(`[importCards] chunk failed (size ${slice.length}, attempt ${attempt}):`, error.message);
        if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, BACKOFFS_MS[attempt - 1] ?? 2000));
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
        if (i + CHUNK < next.length) await new Promise(r => setTimeout(r, CHUNK_BREATHER_MS));
      }
    } else if (toAdd.length > 0) {
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const ok = await insertChunkWithRetry(toAdd.slice(i, i + CHUNK));
        if (!ok) failedChunk = true;
        if (i + CHUNK < toAdd.length) await new Promise(r => setTimeout(r, CHUNK_BREATHER_MS));
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

  return { cards, loading, loadError, refresh, addCard, updateCard, bulkUpdate, removeCard, bulkRemove, rateCard, importCards };
}

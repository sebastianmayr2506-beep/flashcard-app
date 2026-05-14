-- Migration: Index auf cards(user_id, next_review_date).
--
-- Aktuell läuft die "due today"-Filterung clientseitig (StudySession.tsx
-- + Dashboard.tsx), und die Library lädt die User-Karten komplett. Solange
-- ein User <10.000 Karten hat ist das fine. Bei wachsendem Datenbestand
-- oder zukünftigen server-side-Queries (z.B. server-driven Daily-Plan,
-- Cron-basierte Reminders, etc.) wird ein Index nötig.
--
-- Composite-Index — Postgres kann auch nur den `user_id`-Prefix nutzen
-- für reine Per-User-Queries. Performant für "Karten eines Users sortiert
-- nach Fälligkeit" und auch für "ist diese Karte heute fällig"-Lookups.
--
-- Anwenden: Supabase SQL Editor → run.

CREATE INDEX IF NOT EXISTS cards_user_next_review_idx
  ON public.cards (user_id, next_review_date);

-- After applying: tell PostgREST to refresh its schema cache.
-- NOTIFY pgrst, 'reload schema';

-- Migration: Add paused_session column to user_settings.
--
-- Stores a JSON snapshot of an in-progress (or paused-after-Beenden) study
-- session so the user can resume on a different device. The client also
-- keeps a localStorage copy for instant restore; on load it picks whichever
-- side has the newer `pausedAt` timestamp.
--
-- See src/types/card.ts for the PausedSession shape and
-- src/pages/StudySession.tsx for the save/restore flow.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS paused_session jsonb;

-- After applying: tell PostgREST to refresh its schema cache.
-- NOTIFY pgrst, 'reload schema';

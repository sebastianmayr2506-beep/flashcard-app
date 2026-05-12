-- Migration: Add focus_mode column to user_settings.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS).
--
-- Values: 'all' | 'A' | 'AB' | NULL
--   all = no focus filter, see everything (default behaviour)
--   A   = only A-priority cards count toward Dashboard / Jetzt-lernen
--   AB  = A and B together — for slightly broader focus
--   NULL = treat as 'all'

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS focus_mode text NULL;

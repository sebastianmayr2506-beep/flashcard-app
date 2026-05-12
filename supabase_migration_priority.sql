-- Migration: Add priority column to cards table.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS).
--
-- Values: 'A' | 'B' | 'C' | NULL
--   A = must know (focus on these first)
--   B = should know
--   C = nice to know
--   NULL = not yet classified
--
-- See src/utils/priority.ts for the auto-classification heuristic.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS priority text NULL;

-- Optional sanity check constraint — uncomment if you want to enforce A/B/C only.
-- ALTER TABLE public.cards ADD CONSTRAINT cards_priority_valid
--   CHECK (priority IS NULL OR priority IN ('A', 'B', 'C'));

-- Migration: Add persistent MC question storage on cards.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS).
--
-- mc_questions: jsonb array of { question, type, options[], explanation, topic }
-- mc_questions_generated_at: ISO timestamp, used to detect stale MC after edits

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS mc_questions jsonb NULL,
  ADD COLUMN IF NOT EXISTS mc_questions_generated_at timestamptz NULL;

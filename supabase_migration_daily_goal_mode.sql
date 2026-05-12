-- Migration: Add daily_new_card_goal_mode column to user_settings.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS).
--
-- Values: 'manual' | 'auto' | NULL
--   manual = use the user-set dailyNewCardGoal as-is (legacy default)
--   auto   = derive from unseen-in-focus / (daysUntilExam × 0.5)
--   NULL = treat as 'manual'

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS daily_new_card_goal_mode text NULL;

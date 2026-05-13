-- Migration: Add `blacklisted` column to cards.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS).
--
-- Cards with blacklisted=true are hidden from all study-pool selectors:
-- daily plan, "Jetzt lernen", Prüfungsmodus, MC-Session. They remain
-- visible in the Library with a "🚫 Parkiert"-badge so the user can
-- review or unparken them anytime.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS blacklisted boolean DEFAULT false;

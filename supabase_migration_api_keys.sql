-- Migration: Add API key columns to user_settings so they sync across devices.
-- Run this in the Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS).
--
-- Trade-off: keys leave the client and are stored in Supabase. For a
-- single-user-per-account app this is a reasonable trade for cross-device
-- convenience. Keys are user's own (Gemini/Claude/Groq) so a Supabase
-- breach exposes their API quota, not the app itself.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS anthropic_api_key text NULL,
  ADD COLUMN IF NOT EXISTS gemini_api_key text NULL,
  ADD COLUMN IF NOT EXISTS groq_api_key text NULL;

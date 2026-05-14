-- Migration: card_chats table.
--
-- Stores per-card AI chat history so the user can resume / review what was
-- previously asked about a card. Lazy-loaded — only fetched when the chat
-- drawer is opened for a specific card. Capped at 30 messages per chat
-- (enforced client-side). Rows are auto-deleted after 90 days of inactivity
-- (see card_chats_cleanup() function below).
--
-- See:
--   src/types/card.ts            → CardChat / ChatMessage types
--   src/hooks/useCardChat.ts     → fetch / save logic
--   src/components/CardChatDrawer.tsx → UI
--
-- ── Apply with: `psql ...` or via Supabase SQL editor.
-- After applying: `NOTIFY pgrst, 'reload schema';`

CREATE TABLE IF NOT EXISTS public.card_chats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id    uuid        NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  messages   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- one chat per (user, card) — upsert simplifies the client logic
  UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS card_chats_user_card_idx
  ON public.card_chats (user_id, card_id);

CREATE INDEX IF NOT EXISTS card_chats_updated_at_idx
  ON public.card_chats (updated_at);

-- RLS — each user only sees / edits their own chats.
ALTER TABLE public.card_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users select own card_chats"  ON public.card_chats;
DROP POLICY IF EXISTS "users insert own card_chats"  ON public.card_chats;
DROP POLICY IF EXISTS "users update own card_chats"  ON public.card_chats;
DROP POLICY IF EXISTS "users delete own card_chats"  ON public.card_chats;

CREATE POLICY "users select own card_chats"
  ON public.card_chats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own card_chats"
  ON public.card_chats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own card_chats"
  ON public.card_chats FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own card_chats"
  ON public.card_chats FOR DELETE
  USING (auth.uid() = user_id);

-- 90-day cleanup: invoke periodically via Supabase Cron / pg_cron.
-- Manual call: SELECT public.card_chats_cleanup();
CREATE OR REPLACE FUNCTION public.card_chats_cleanup() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.card_chats
   WHERE updated_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$func$;

-- Trigger to keep updated_at fresh on every change.
CREATE OR REPLACE FUNCTION public.card_chats_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS card_chats_touch_updated_at_trg ON public.card_chats;
CREATE TRIGGER card_chats_touch_updated_at_trg
  BEFORE UPDATE ON public.card_chats
  FOR EACH ROW EXECUTE FUNCTION public.card_chats_touch_updated_at();

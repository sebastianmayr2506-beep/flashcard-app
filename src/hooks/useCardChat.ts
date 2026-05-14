// Lazy-loaded chat history for a single card. Fetches on-demand only when
// the drawer is opened — keeps the initial app-load light.
//
// We don't subscribe to Realtime for chat updates: chats are user-private and
// rarely edited from another device while one is active. The drawer fetches
// once on open, and we update local state optimistically on append/clear.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { ChatMessage } from '../types/card';

const MAX_MESSAGES = 30;

interface RowShape {
  id: string;
  user_id: string;
  card_id: string;
  messages: ChatMessage[] | null;
  created_at: string;
  updated_at: string;
}

export function useCardChat(userId: string | null, cardId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the loaded chat had any messages on first fetch — used by the UI
  // to decide whether to show "Letzter Chat vor X Tagen" or a fresh prompt.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Track which card's chat we last loaded — guards against race when the
  // user flips to next card while a fetch is still in flight.
  const loadedForRef = useRef<string | null>(null);

  // Load on cardId change
  useEffect(() => {
    if (!userId || !cardId) {
      setMessages([]);
      setUpdatedAt(null);
      loadedForRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadedForRef.current = cardId;

    (async () => {
      const { data, error: err } = await supabase
        .from('card_chats')
        .select('*')
        .eq('user_id', userId)
        .eq('card_id', cardId)
        .maybeSingle();
      if (cancelled || loadedForRef.current !== cardId) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const row = data as RowShape | null;
      setMessages(Array.isArray(row?.messages) ? row!.messages : []);
      setUpdatedAt(row?.updated_at ?? null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId, cardId]);

  /** Append a new message and persist. Returns the full new array. */
  const appendMessage = useCallback(async (msg: ChatMessage): Promise<ChatMessage[]> => {
    if (!userId || !cardId) return messages;
    const next = [...messages, msg].slice(-MAX_MESSAGES);
    setMessages(next);
    setUpdatedAt(new Date().toISOString());
    const { error: err } = await supabase
      .from('card_chats')
      .upsert(
        { user_id: userId, card_id: cardId, messages: next },
        { onConflict: 'user_id,card_id' },
      );
    if (err) {
      console.warn('[useCardChat] persist failed:', err);
      setError(err.message);
    }
    return next;
  }, [userId, cardId, messages]);

  /** Wipe the chat for this card. */
  const clearChat = useCallback(async () => {
    if (!userId || !cardId) return;
    setMessages([]);
    setUpdatedAt(null);
    await supabase
      .from('card_chats')
      .delete()
      .eq('user_id', userId)
      .eq('card_id', cardId);
  }, [userId, cardId]);

  return { messages, updatedAt, loading, error, appendMessage, clearChat };
}

/** Light-weight existence check used by the Library preview badge.
 *  Returns the set of card IDs that have a chat. Cached locally with a
 *  TTL — the badge doesn't need to be 100% up-to-the-second accurate. */
export function useChatExistsSet(userId: string | null) {
  const [set, setSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) { setSet(new Set()); return; }
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('card_chats')
        .select('card_id')
        .eq('user_id', userId);
      if (cancelled || !data) return;
      setSet(new Set((data as { card_id: string }[]).map(r => r.card_id)));
    })();

    // Re-poll when focus returns — cheap (one column query)
    const onFocus = () => {
      if (cancelled) return;
      supabase
        .from('card_chats')
        .select('card_id')
        .eq('user_id', userId)
        .then(({ data }) => {
          if (cancelled || !data) return;
          setSet(new Set((data as { card_id: string }[]).map(r => r.card_id)));
        });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [userId]);

  return set;
}

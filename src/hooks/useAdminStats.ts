// Admin-Stats Hook — lädt aggregierte Nutzungsdaten ALLER User.
//
// Bewusst KEIN Direkt-Zugriff auf die cards-Tabelle. Stattdessen ruft
// dieser Hook ausschließlich die `admin_user_stats()` RPC auf, die
// SQL-seitig aggregiert und nur Zahlen zurückgibt (nie Karten-Inhalte).
// Dadurch ist die Daten-Bahn vollständig getrennt von useCards() —
// hier kann sich nichts mit dem eigenen Lernfortschritt vermischen.
//
// Lädt lazy: erst bei explizitem Aufruf von `load()`, nicht automatisch
// beim Mount. So bezahlt der Admin den Query-Roundtrip nur wenn er das
// Panel tatsächlich aufklappt.

import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AdminUserStat {
  user_id: string;
  email: string;
  total_cards: number;
  studied_cards: number;
  mature_cards: number;
  last_sign_in_at: string | null;
  created_at: string;
}

interface State {
  stats: AdminUserStat[] | null;
  loading: boolean;
  error: string | null;
}

export function useAdminStats() {
  const [state, setState] = useState<State>({ stats: null, loading: false, error: null });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await supabase.rpc('admin_user_stats');
      if (error) throw error;
      // Defensive Sortierung client-side, falls der Server doch mal anders sortiert
      const sorted = ((data ?? []) as AdminUserStat[]).slice().sort((a, b) => {
        const la = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
        const lb = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
        return lb - la; // neueste zuerst
      });
      setState({ stats: sorted, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ stats: null, loading: false, error: msg });
    }
  }, []);

  return { ...state, load };
}

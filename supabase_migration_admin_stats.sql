-- Admin-Stats RPC für das versteckte Admin-Dashboard in den Settings.
--
-- WICHTIG: Diese Migration ändert KEINE RLS-Policies. Die normale
-- App-Logik (useCards, useSettings) sieht weiterhin nur Daten des
-- eingeloggten Users — daran ändert sich nichts.
--
-- Stattdessen liefert die RPC nur AGGREGIERTE Zahlen pro User, niemals
-- einzelne Karten-Inhalte (Front/Back/Tags/etc.). Damit kann sich der
-- Admin-Lernfortschritt nicht mit dem anderer User vermischen — die
-- RPC ist die einzige Daten-Quelle, sie geht nicht durch dieselbe
-- Code-Bahn wie useCards.
--
-- Sicherheit:
--  • SECURITY DEFINER → die Function läuft mit den Rechten des
--    Owners (= postgres-Role), kann also auf auth.users + alle
--    cards-Rows zugreifen.
--  • Hard-Gate im WHERE: wenn die aufrufende JWT nicht die Admin-Email
--    enthält, gibt die Function ein leeres Result zurück. Selbst wenn
--    jemand die RPC aus DevTools aufruft, kommt nichts raus.
--  • search_path explizit gesetzt (search_path injection prevention).
--
-- Ausführung: In Supabase SQL-Editor laufen lassen. Idempotent (CREATE
-- OR REPLACE) — kann beliebig oft wiederholt werden ohne Schaden.

create or replace function public.admin_user_stats()
returns table (
  user_id uuid,
  email text,
  total_cards int,
  studied_cards int,
  mature_cards int,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
security definer
set search_path = public, auth
language sql
stable
as $$
  select
    u.id                                                                 as user_id,
    u.email                                                              as email,
    coalesce(count(c.id), 0)::int                                        as total_cards,
    -- "studied" = mind. einmal positiv bewertet (Karte ist aus dem "Neu"-Pool raus)
    coalesce(count(c.id) filter (
      where c.repetitions > 0 or c.interval > 0
    ), 0)::int                                                            as studied_cards,
    -- "mature" = mind. 3 erfolgreiche Wiederholungen, gilt als fest
    coalesce(count(c.id) filter (where c.repetitions >= 3), 0)::int      as mature_cards,
    u.last_sign_in_at,
    u.created_at
  from auth.users u
  left join public.cards c on c.user_id = u.id
  where coalesce(auth.jwt() ->> 'email', '') = 'bastimayr@gmx.at'
  group by u.id, u.email, u.last_sign_in_at, u.created_at
  order by u.last_sign_in_at desc nulls last;
$$;

-- Function-Ownership beim postgres-Superuser belassen, damit SECURITY
-- DEFINER die nötigen Rechte hat.
alter function public.admin_user_stats() owner to postgres;

-- Authenticated Users dürfen die RPC aufrufen — der Hard-Gate im WHERE
-- sorgt dafür, dass nicht-Admins ein leeres Result bekommen.
grant execute on function public.admin_user_stats() to authenticated;

-- anon (nicht eingeloggte) darf gar nicht aufrufen
revoke execute on function public.admin_user_stats() from anon, public;

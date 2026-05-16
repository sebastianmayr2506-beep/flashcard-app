-- Migration #3: B-Threshold von 2 auf 3 verschärft
--
-- Heuristik-Update: Karten mit `times_asked = 2` werden nicht mehr als
-- "Sollte kennen" (B) eingestuft sondern als "Nice to know" (C).
-- "Nur 2 Erwähnungen" in 5 Katalogjahren ist zu schwach für B —
-- gehört eher zum Tail.
--
-- Neue Bands:
--   A = times_asked >= 6  ODER flagged  (unverändert)
--   B = times_asked 3-5                  (vorher: 2-5)
--   C = times_asked <= 2                 (vorher: <= 1)
--
-- BERÜHRT: priority (nur wo priority_locked = false)
-- BERÜHRT NICHT: SRS, content, times_asked, flagged, locks, alles andere
--
-- Idempotent. Mehrfach ausführen ist sicher.

UPDATE public.cards
SET priority = CASE
  WHEN flagged = true OR times_asked >= 6 THEN 'A'
  WHEN times_asked >= 3 THEN 'B'
  ELSE 'C'
END
WHERE priority_locked = false;

NOTIFY pgrst, 'reload schema';

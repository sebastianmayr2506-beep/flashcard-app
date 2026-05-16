-- Migration #2: Reparatur der alten Merge-Karten
--
-- Hintergrund: Der Merge-Code hatte zwei Bugs (gefixt in commit f304356):
--   1) priority wurde gar nicht gesetzt → merged Karten landeten mit
--      priority = NULL in der DB
--   2) probability_percent nahm MAX der Quellkarten statt aus dem
--      summierten times_asked neu zu berechnen → falsche % auf der
--      merged Karte (z.B. 17% bei times_asked=7)
--
-- Diese Migration repariert beide Probleme für ALLE bereits existierenden
-- merged Karten, ohne andere Karten zu beeinträchtigen.
--
-- BERÜHRT: priority (nur wenn NULL und unlocked), probability_percent
-- BERÜHRT NICHT: SRS, content, times_asked, flagged, locks
--
-- Idempotent. Mehrfach laufen lassen ist safe.

-- ── Step 1: priority setzen für Karten ohne priority ─────────────────────
-- Nur für unlocked Karten. Manuell-gelockte werden in Ruhe gelassen.
UPDATE public.cards
SET priority = CASE
  WHEN flagged = true OR times_asked >= 6 THEN 'A'
  WHEN times_asked >= 2 THEN 'B'
  ELSE 'C'
END
WHERE priority IS NULL
  AND priority_locked = false;

-- ── Step 2: probability_percent global neu berechnen ─────────────────────
-- Re-derive aus times_asked. Catcht alle Karten wo der Merge-Bug eine
-- stale MAX-of-sources-Probability hinterlassen hat. Für unveränderte
-- Karten (die schon nach Migration #1 korrekt sind) ist's ein No-Op.
UPDATE public.cards
SET probability_percent = LEAST(100, ROUND(times_asked * 100.0 / 6))
WHERE times_asked > 0;

UPDATE public.cards
SET probability_percent = 0
WHERE times_asked = 0 OR times_asked IS NULL;

NOTIFY pgrst, 'reload schema';

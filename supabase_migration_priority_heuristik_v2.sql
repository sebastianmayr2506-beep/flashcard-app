-- Migration: Heuristik v2 für Priority + Klassiker-Score
--
-- Diese Migration räumt zwei Inkonsistenzen auf die seit dem ersten Roll-Out
-- der A/B/C-Klassifizierung im Datenbestand existieren:
--
-- 1) `probabilityPercent` wurde zu unterschiedlichen Zeitpunkten / mit
--    unterschiedlichen Formeln gefüllt (manche Karten haben ihn vom Import,
--    manche von normalizeStats berechnet, manche manuell). Resultat: zwei
--    Karten mit ähnlichen Mention-Counts haben oft sehr unterschiedliche %.
--    → Neue konsistente Formel: probability = min(100, times_asked / 6 * 100)
--    Heißt: 6 Mentions = 100 % Klassiker, alles drunter linear skaliert.
--
-- 2) Die A/B/C-Heuristik nutzte fünf Signale mit Or-Verknüpfung. Sauberer
--    und für den User intuitiver: ein Signal (times_asked) + flagged als
--    Override.
--    → A = times_asked >= 6  ODER flagged
--    → B = times_asked 2-5
--    → C = times_asked <= 1 (Default für Karten ohne Exam-Daten)
--
-- Zusätzlich: neue Spalte `priority_locked`. Der Inline-Picker setzt das
-- zukünftig auf true wenn der User A/B/C manuell ändert. Damit respektieren
-- alle zukünftigen globalen Re-Runs die manuellen Überschreibungen.
-- Aktuell wird nichts gelockt — wir vertrauen darauf dass noch niemand
-- manuell geändert hat (siehe DEVELOPMENT.md, Migration #1).
--
-- BERÜHRT: priority, priority_locked (neu), probability_percent
-- BERÜHRT NICHT: SRS-State, times_asked, flagged, content, alle anderen Felder
--
-- Anwendung: Supabase SQL Editor → Run.

-- ── Step 1: neue Spalte ──────────────────────────────────────────────────
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS priority_locked boolean DEFAULT false;

-- ── Step 2: A/B/C global neu klassifizieren ──────────────────────────────
-- Respektiert priority_locked (aktuell überall false — alle werden neu).
UPDATE public.cards
SET priority = CASE
  WHEN flagged = true OR times_asked >= 6 THEN 'A'
  WHEN times_asked >= 2 THEN 'B'
  ELSE 'C'
END
WHERE priority_locked = false;

-- ── Step 3: Klassiker-Score konsistent neu berechnen ─────────────────────
-- Formel: min(100, times_asked / 6 * 100). 6× = 100% (Klassiker-Decke).
UPDATE public.cards
SET probability_percent = LEAST(100, ROUND(times_asked * 100.0 / 6))
WHERE times_asked > 0;

-- Karten ganz ohne mentions auf 0 setzen (clean slate)
UPDATE public.cards
SET probability_percent = 0
WHERE times_asked = 0 OR times_asked IS NULL;

-- ── Step 4: PostgREST Schema-Cache reload ────────────────────────────────
NOTIFY pgrst, 'reload schema';

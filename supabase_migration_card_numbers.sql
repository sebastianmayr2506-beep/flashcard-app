-- ───────────────────────────────────────────────────────────────────────────
-- Stabile Kartennummern (#1, #2, #3 …)
-- ───────────────────────────────────────────────────────────────────────────
-- Jede Karte bekommt eine stabile, aufsteigende Nummer pro User.
-- Einmal vergeben, nie geändert — auch wenn andere Karten gelöscht werden.
-- Zweck: User können "#42" in externen Notizen notieren und die Karte
-- über die Nummer suchen.
--
-- Trigger: SECURITY DEFINER + SET search_path = public damit er ohne
-- Auth-Kontext (keine JWT-Session) laufen kann und RLS umgeht.
-- ───────────────────────────────────────────────────────────────────────────

-- Schritt 1: Spalte hinzufügen
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS card_number BIGINT;

-- Schritt 2: Bestehende Karten nummerieren (aufsteigend nach created_at, pro User)
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
    FROM cards
   WHERE card_number IS NULL
)
UPDATE cards
   SET card_number = numbered.rn
  FROM numbered
 WHERE cards.id = numbered.id;

-- Schritt 3: Trigger-Funktion — weist neuen Karten die nächste Nummer zu
CREATE OR REPLACE FUNCTION assign_card_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.card_number IS NULL THEN
    SELECT COALESCE(MAX(card_number), 0) + 1
      INTO NEW.card_number
      FROM cards
     WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Schritt 4: Trigger registrieren
DROP TRIGGER IF EXISTS trg_assign_card_number ON cards;
CREATE TRIGGER trg_assign_card_number
  BEFORE INSERT ON cards
  FOR EACH ROW
  EXECUTE FUNCTION assign_card_number();

-- Schritt 5: Index für schnelle Suche (#42 → WHERE card_number = 42)
CREATE INDEX IF NOT EXISTS cards_card_number_idx
  ON cards (user_id, card_number);

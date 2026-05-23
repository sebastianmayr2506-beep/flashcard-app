-- ───────────────────────────────────────────────────────────────────────────
-- Multi-Set-Membership für Karten
-- ───────────────────────────────────────────────────────────────────────────
-- Bisher: cards.set_id TEXT → 1 Karte gehört zu max. 1 Set
-- Neu:    cards.set_ids TEXT[] → 1 Karte kann zu beliebig vielen Sets gehören
--
-- Diese Migration:
--   1. Fügt die neue Spalte set_ids hinzu (default leeres Array)
--   2. Migriert bestehende set_id-Werte in set_ids (set_id IS NOT NULL → [set_id])
--   3. Lässt set_id ZUNÄCHST stehen — so kann ein alter App-Build noch laufen.
--      Erst nach Deployment der neuen App-Version droppen wir set_id manuell.
--   4. Trigger: Beim Löschen eines Sets wird seine ID aus allen set_ids
--      automatisch entfernt (Ersatz für die FK-Cascade auf set_id).
-- ───────────────────────────────────────────────────────────────────────────

-- Schritt 1: Spalte hinzufügen (idempotent)
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS set_ids TEXT[] NOT NULL DEFAULT '{}';

-- Schritt 2: Bestandsdaten migrieren — nur wo set_ids noch leer ist und set_id gesetzt
UPDATE cards
   SET set_ids = ARRAY[set_id]
 WHERE set_id IS NOT NULL
   AND (set_ids IS NULL OR array_length(set_ids, 1) IS NULL);

-- Schritt 3: Index für schnelle Suche (set_ids @> '{x}')
CREATE INDEX IF NOT EXISTS cards_set_ids_gin
  ON cards USING GIN (set_ids);

-- Schritt 4: Trigger — beim Löschen eines Sets dessen ID aus allen
-- set_ids-Arrays entfernen. Ersatz für die alte ON DELETE SET NULL
-- auf set_id (jetzt mit array_remove).
CREATE OR REPLACE FUNCTION remove_set_from_cards()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE cards
     SET set_ids = array_remove(set_ids, OLD.id)
   WHERE OLD.id = ANY(set_ids);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_remove_set_from_cards ON sets;
CREATE TRIGGER trg_remove_set_from_cards
  BEFORE DELETE ON sets
  FOR EACH ROW
  EXECUTE FUNCTION remove_set_from_cards();

-- ───────────────────────────────────────────────────────────────────────────
-- WICHTIG: set_id wird NICHT in dieser Migration gedroppt!
-- Erst nachdem die neue App-Version deployed UND lauffähig ist, kann man
-- folgenden Befehl manuell ausführen, um Platz zu sparen:
--
--   ALTER TABLE cards DROP COLUMN set_id;
--
-- Bis dahin bleibt die Spalte als Fallback liegen. Die App-Logik schreibt
-- nur noch in set_ids; set_id wird ignoriert.
-- ───────────────────────────────────────────────────────────────────────────

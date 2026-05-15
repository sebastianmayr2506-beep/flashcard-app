# Development Notes

Interne Doku für Bug-Fix-Vorgehen, Datenschutz-Garantien und Migration-Protokoll.

## Bug-Fix-Regelwerk

Seit die App mehrere parallele User hat, ist „einfach Code pushen" nicht mehr alles. Manche Bugs erfordern Datenkorrektur **für alle User gleichzeitig**, ohne dass jeder einzelne den Settings-Knopf zum Fixen klicken muss. Hier die Kategorien:

### Kategorie 1 — Reine UI/UX-Bugs

**Was:** Darstellung, Layout, Mobile-Optimierung, Farbe, Animation.
**Vorgehen:** Code ändern, pushen, Vercel deployt. Fertig.
**Berührt User-Daten:** Nein.

### Kategorie 2 — Berechnungsfehler in abgeleiteten Werten

**Was:** Ein Feld wird falsch berechnet — z.B. `probabilityPercent`.
**Vorgehen:**
1. SQL-Migration schreiben die den Wert für alle User neu berechnet
2. Code anpassen damit zukünftige Berechnungen die gleiche Logik nutzen
3. SQL einmal im Supabase Editor laufen lassen
4. Code pushen, Migrationsdatei in Repo committen, Eintrag im Migrations-Log unten

**Beispiel:** Migration #1 (siehe unten) — `probability_percent` aus `times_asked` neu berechnet.

### Kategorie 3 — Schema-Erweiterungen

**Was:** Neue Spalte, neue Tabelle, neuer Index.
**Vorgehen:** SQL-Migration mit `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. Idempotent halten — Migration darf mehrfach gefahrlos laufen.
**Beispiele:** `blacklisted`, `paused_session`, `card_chats`-Tabelle, `priority_locked`.

### Kategorie 4 — Heuristik-Änderungen

**Was:** Die Logik die A/B/C / Klassifizierung / Score-Berechnung macht ändert sich.
**Risiko:** Kann manuell vom User gesetzte Werte überschreiben.
**Schutz:** Lock-Spalten einsetzen (z.B. `priority_locked`). Manuelle User-Setzungen markieren, Migrations respektieren das Flag.

**Beispiel:** Migration #1 — A/B/C v3-Heuristik (`times_asked >= 6 → A`). Lock-Spalte neu eingeführt, alle existierenden Werte als „unlocked" behandelt (siehe Migration-Notiz).

### Kategorie 5 — Strukturelle Bugs / Datenkorruption

**Was:** Karten mit falscher user_id, Duplikate aus kaputtem Import, etc.
**Vorgehen:** ZUERST Backup ziehen, dann SQL UPDATE, dann verifizieren.

---

## Geschützte Felder — **niemals** durch globale Migrationen ändern

Diese Felder gehören dem User. Auch wenn eine Migration sie technisch ändern könnte: tut sie nicht.

| Feld | Warum |
|---|---|
| `interval`, `repetitions`, `ease_factor`, `next_review_date` | SRS-Lernfortschritt |
| `first_studied_at` | Lernhistorie |
| `times_asked` | Source-of-Truth-Counter — kommt aus Import oder Merge, niemand sonst |
| `flagged` | User-Markierung |
| `front`, `back`, `front_image`, `back_image` | Karteninhalt |
| `custom_tags` (User-erstellte) | User-Daten |
| `priority` **wenn `priority_locked = true`** | Vom User manuell gesetzt |
| `blacklisted` | User-Auswahl |
| MC-Antworten in laufenden Sessions | Aktiver Lernstand |
| Flag-Attempts-Historie | Audit-Trail |

## Felder die OK zu berühren sind (mit Begründung)

| Feld | Wann OK |
|---|---|
| `priority` (wenn `priority_locked = false`) | Globale Re-Klassifizierung, neue Heuristik |
| `priority_locked` | Nur Neuanlage (false). User-Aktion setzt true. |
| `probability_percent` | Reine Ableitung aus `times_asked` |
| `asked_by_examiners`, `asked_in_catalogs` | Aus Tags / Examiner-Listen abgeleitet |
| `mc_questions` | Reset für Re-Generierung — User verliert nur AI-Tokens |

---

## Migrations-Log

Dokumentation jeder globalen Datenmigration. Format: Datum · Datei · Was getan · Welche Felder berührt.

### Migration #1 — Klassiker-Score + A/B/C Heuristik v3 (Mai 2026)

**Datei:** `supabase_migration_priority_heuristik_v2.sql`

**Was getan:**
- Neue Spalte `priority_locked boolean DEFAULT false` eingeführt
- Alle Karten neu klassifiziert nach v3-Heuristik:
  - A wenn `times_asked >= 6` ODER `flagged`
  - B wenn `times_asked 2-5`
  - C wenn `times_asked <= 1`
- `probability_percent` für alle Karten neu berechnet: `min(100, times_asked / 6 × 100)`

**Berührt:** `priority`, `priority_locked` (neu), `probability_percent`
**Berührt nicht:** alles andere

**Annahme/Risiko:** Bei dieser ersten Migration vertrauen wir darauf dass noch keine User-Manuelle A/B/C-Setzung existiert (laut Admin-Einschätzung 99 % sicher). Daher wurde `priority_locked` für alle als `false` initialisiert und alle Werte überschrieben. **Ab jetzt** schützt der Inline-Picker manuell-gesetzte Werte via `priority_locked: true`.

---

## Migration-Workflow (Checkliste)

Wenn du eine globale Migration schreibst:

1. **Admin-Backup vorher** (`npm run backup:admin`) — siehe Abschnitt unten
2. **SQL-Datei** im Root anlegen: `supabase_migration_XX_kurzname.sql`
3. **Kommentar-Header** mit:
   - Was die Migration tut
   - Welche Felder berührt sind
   - Welche Felder GARANTIERT nicht berührt werden
   - Annahmen / Risiken
4. **Idempotent halten** (`IF NOT EXISTS`, `WHERE locked = false`, etc.) — muss mehrfach lauffähig sein ohne Schaden
5. **NOTIFY pgrst, 'reload schema'** am Ende (sonst sieht der Client die neue Spalte nicht)
6. **Code-Änderungen** parallel (neue Logik soll zur Migration passen)
7. **Lokal builden** + testen
8. **Im Supabase Editor laufen lassen** — Output prüfen
9. **Im Repo committen** (sowohl SQL-Datei als auch Code-Änderungen)
10. **Hier im Migration-Log Eintrag** mit Datum / Was / Berührte Felder
11. **Eintrag in `CHANGELOG.md`** für die User-sichtbare Side

---

## Admin-Backup (alle User in einem Rutsch)

Über die Web-App nicht möglich (Service-Role-Key gehört nie ins Frontend).
Stattdessen lokales Node-Script:

### Einmaliges Setup

1. `.env.local` im Repo-Root anlegen (ist via `.gitignore` geschützt):
   ```
   VITE_SUPABASE_URL=https://<projekt>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```
   Den Service-Role-Key findest du in:
   **Supabase Dashboard → Project Settings → API → service_role secret**.
   **Nicht** den anon-Key — der hat keine Admin-Rechte.

### Ausführen

```bash
npm run backup:admin
```

Output: `backups/YYYY-MM-DD_HH-MM/<email>.json` — eine Datei pro User mit
Karten, SRS-Stand, Settings, Sets, Card-Links, Flag-Attempts und Card-Chats.
Plus `_summary.json` mit Übersicht aller User.

### Wann ausführen

- **VOR jeder geplanten globalen Migration** (Kategorie 4 oder 5)
- **Wenn ein User Datenverlust meldet** — du hast dann den letzten Stand
- **Wöchentliche Routine** als zusätzliches Sicherheits-Netz neben Supabase's
  automatischen Daily Backups (die nur 7 Tage zurückreichen)

### Supabase's eigene Backups (zur Erinnerung)

Pro-Tier hat **automatische daily backups**, 7 Tage Retention. Findest du
unter **Database → Backups**. Wiederherstellung ist *destruktiv* (überschreibt
aktuelle DB) — daher: für Einzel-User-Wiederherstellung lieber das Admin-
Backup-JSON nehmen und gezielt per SQL einspielen.

### Wiederherstellung aus Admin-Backup

Format der JSON-Datei ist DB-shaped (snake_case-Felder pro Tabelle). Im
Notfall:
1. JSON öffnen, betroffene Sektion finden (z.B. `cards`)
2. SQL `INSERT INTO ... VALUES (...)` daraus bauen
3. Im Supabase SQL Editor laufen lassen

Für komplette User-Wiederherstellung: Service-Role-Key Script erweitern
mit Restore-Modus (nicht implementiert — bei Bedarf bauen).

---

## Schnell-Referenz: was tue ich wenn …

- **„Ein Feld zeigt falsche Werte für alle User"** → Kategorie 2. SQL UPDATE auf das abgeleitete Feld + Code-Fix.
- **„Ich brauche ein neues Feld"** → Kategorie 3. SQL `ADD COLUMN IF NOT EXISTS`.
- **„Die A/B/C-Verteilung ist schief"** → Kategorie 4. Heuristik anpassen + SQL UPDATE mit `WHERE priority_locked = false`.
- **„Karten haben Duplikate"** → Kategorie 5. Backup, dann manuelles SQL.
- **„Layout ist kaputt"** → Kategorie 1. Nur Code.

---

## Bei Unsicherheit

Frage zu klären bevor irgendwas läuft:

- **Welche User sind betroffen?** (Alle, eine Untergruppe, nur Admin?)
- **Was passiert wenn die Migration zweimal läuft?** (Sollte idempotent sein)
- **Was passiert wenn ein User mitten im Lernen ist?** (Realtime-Refetch sollte's mitkriegen)
- **Welche Felder werden wirklich berührt?** (Niemals SRS!)
- **Hab ich ein Backup?** (Bei strukturellen Sachen JA)

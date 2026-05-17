# Exercise Guide

Konventionen für interaktive Übungen unter `src/pages/exercises/`.

Zielgruppe: Claude (oder andere Code-Generatoren) und Sebi selbst, wenn
eine neue Übung dazu kommt. Wenn du diesem Guide folgst, fügt sich die
neue Übung optisch und strukturell nahtlos in den Rest der App ein.

---

## Big Picture

Eine Übung ist eine eigenständige React-Komponente, die:

1. **Selbständig** ihren State hält (kein Supabase, kein localStorage —
   wer abbricht, fängt beim nächsten Mal neu an. Das ist Absicht: Übungen
   sind Trainings-Durchläufe, keine Karteikarten mit SRS-Tracking.)
2. **Eine einzige Prop** akzeptiert: `{ onClose: () => void }`.
3. **Shared Components** aus `_shared.tsx` benutzt — nicht eigene UI bauen.
4. **Lazy-geladen** wird via `lazy(() => import('./<slug>'))` im Manifest.

---

## Dateistruktur

```
src/pages/exercises/
  _shared.tsx           ← UI-Bausteine (Shell, ProgressBar, NumIn, ...)
  index.ts              ← Manifest: EXERCISES[]
  <slug>.tsx            ← Eine Datei pro Übung
src/pages/Exercises.tsx ← Listing-Page (auto-zieht aus Manifest)
```

Sichtbarkeit: aktuell admin-only (Sidebar-Filter via `isAdmin(userEmail)`).
Wer die Übungen öffentlich machen will, entfernt `adminOnly: true` aus dem
Sidebar-Eintrag.

---

## Neue Übung anlegen — Workflow

### 1. Datei erstellen

`src/pages/exercises/mein-thema.tsx` (kebab-case slug = Dateiname):

```tsx
import { useState } from 'react';
import {
  ExerciseShell, ProgressBar, StepHeader, InfoBox, FeedbackBox, HintBox,
  NumIn, ToggleBtn, PrimaryBtn, Card, fmtEur, numFromInput,
} from './_shared';

const PHASES = ['intro', 'aufgabe', 'ergebnis'] as const;
type Phase = typeof PHASES[number];

export default function MeinThema({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);
  // ... weiteres State

  return (
    <ExerciseShell title="Mein Thema" subtitle="Untertitel" onClose={onClose}>
      <ProgressBar phases={PHASES as readonly string[] as string[]} current={PHASES.indexOf(phase)} />

      {phase === 'intro' && (
        <div>
          <StepHeader step="1" title="Einleitung" sub="Worum geht's." />
          <InfoBox>Hier steht der Kontext.</InfoBox>
          <PrimaryBtn label="Los geht's" onClick={() => setPhase('aufgabe')} color="emerald" />
        </div>
      )}
      {/* weitere Phasen ... */}
    </ExerciseShell>
  );
}
```

### 2. Im Manifest registrieren

`src/pages/exercises/index.ts`:

```ts
{
  slug: 'mein-thema',                  // muss exakt zum Dateinamen passen
  title: 'Mein Thema',
  description: 'Was die Übung macht, in 1–2 Sätzen.',
  subject: 'Kostenrechnung',           // optional
  difficulty: 'mittel',                // 'einfach' | 'mittel' | 'schwer'
  icon: '📊',                          // Emoji
  estimatedMinutes: 15,                // optional
  component: lazy(() => import('./mein-thema')),
},
```

Mehr ist nicht nötig. Die Listing-Page rendert automatisch eine Karte,
das Routing klappt automatisch.

### 3. Build prüfen

```sh
npm run build
```

Wenn der Build durchläuft, bist du fertig.

---

## UI-Bausteine — Cheatsheet

Alle aus `_shared.tsx`. **Niemals selbst styling-mäßig nachbauen** — sonst
driften Übungen optisch auseinander.

| Komponente       | Wofür                                                      |
|------------------|-------------------------------------------------------------|
| `ExerciseShell`  | Outer wrapper, Header mit Close-X, max-w-3xl dark bg.       |
| `ProgressBar`    | Schritt-Anzeige; optional `groupLabel` für 2-Phasen-Split. |
| `StepHeader`     | "Schritt N", Titel, Untertitel.                            |
| `InfoBox`        | Neutrale Kontext-Box (Aufgabenstellung, Zusatzinfos).      |
| `FeedbackBox`    | ✅/❌ nach Überprüfen, schließt automatisch bei `null`.    |
| `HintBox`        | Aufklappbarer Tipp (default-collapsed).                    |
| `NumIn`          | Number-Input, font-mono, rechtsbündig.                     |
| `ToggleBtn`      | Multiple-Choice / Klassifizierungs-Button.                 |
| `PrimaryBtn`     | "Überprüfen" / "Weiter" — `color="indigo"` oder `"emerald"`.|
| `Card`           | Container für gruppierte Inhalte.                          |
| `fmtEur(n)`      | "1.234 €" mit de-AT Locale.                                |
| `numFromInput`   | String/Number → Number, akzeptiert Komma als Dezimaltrenner.|

### Farben für ToggleBtn

`'indigo'` | `'red'` | `'amber'` | `'purple'` | `'blue'` | `'emerald'`

Konvention: rot = Negativ/Aufwand, emerald = Positiv/Korrekt, amber = Achtung,
blue = Methode/Variante A, purple = Methode/Variante B.

---

## State-Pattern (bewährt)

Aus `bueb-bab-trainer.tsx`:

```tsx
const [phase, setPhase] = useState<Phase>('start');
const [done, setDone] = useState<Record<string, boolean>>({});    // p1, p2, ...
const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);

const go = (p: Phase) => { setPhase(p); setFb(null); };
const ok = (k: string) => setDone(p => ({ ...p, [k]: true }));
const clr = () => setFb(null);
const err = (m: string) => setFb({ ok: false, msg: m });
const suc = (m: string) => setFb({ ok: true, msg: m });
```

**Warum?** Eine Phase = ein Check (`chk1`, `chk2`, ...). Nach erfolgreichem
Check → `ok('pN')` setzt das done-Flag, der "Überprüfen"-Button wird durch
"Weiter →" ersetzt. Bei `setPhase` immer Feedback clearen, sonst hängt
alte ❌-Meldung aus der vorigen Phase über.

Bei jedem User-Input `clr()` aufrufen, damit das Feedback verschwindet
sobald der User korrigiert.

---

## Don'ts

- ❌ **Keine inline styles**. Nur Tailwind. Wenn etwas fehlt, lieber in
  `_shared.tsx` ergänzen statt zur Inline-Style-Falle zurückkehren.
- ❌ **Kein eigener `<link>` zu Google Fonts**. Die App nutzt System-Fonts
  + die globale Font-Stack aus `index.css`.
- ❌ **Keine `bg-white` / `text-gray-900`**. Dark-Theme is the way. Wenn
  du eine Color nicht hast, schau dir `_shared.tsx` Palette an.
- ❌ **Keine fix verdrahteten Width-Pixel-Werte** (`style={{ width: 90 }}`).
  Tailwind-Utilities (`w-24`, `w-32`) oder responsive Klassen verwenden,
  damit's mobile passt.
- ❌ **Keine Supabase / localStorage / globaler Settings-Zugriff**. Übungen
  sind self-contained.

---

## Mobile

Minimum: 393px breit (iPhone 14 Pro). Tabellen kriegen `overflow-x-auto`
auf einem Wrapper. Button-Reihen `flex-wrap`. Inputs schmal halten
(`w-20` bis `w-32`). Wer das beachtet, hat keine Sorge.

---

## Workflow mit Claude (für AI-generierte Übungen)

Wenn dir Claude eine fertige JSX-Datei liefert (wie damals `bueb-bab-trainer-v2.jsx`):

1. **Daten extrahieren** — Arrays, Konstanten, Check-Funktionen bleiben 1:1.
2. **UI ersetzen** — alle inline-styled Komponenten durch `_shared.tsx`-
   Bausteine. `SelectBtn → ToggleBtn`, `Btn → PrimaryBtn`, `Box → InfoBox`,
   `Fb → FeedbackBox`, `Head → StepHeader`, `Hint → HintBox`, `Progress
   → ProgressBar`.
3. **Tabellen** — eigenes Light-Theme-Styling raus, `thCls` / `tdCls`-
   Helper aus dem BÜB-Trainer kopieren oder analog bauen.
4. **TypeScript** — Props/State typisieren, `any` vermeiden.
5. **Build** — `npm run build`. Wenn grün → fertig.

Als Prompt-Tipp für künftige Claude-Generations: "Mach mir eine Übung
zu Thema XY, Output-Format wie bueb-bab-trainer-v2.jsx (FIBU + Phases +
check-Funktionen)." Dann ist die Konvertierung mechanisch.

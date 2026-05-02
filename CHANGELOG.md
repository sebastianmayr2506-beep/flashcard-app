# Changelog

A running log of meaningful behavior changes and bug fixes. Append new entries
at the top. Each entry: date, short title, one-line root cause, one-line fix,
and the files touched. Goal is that future-Claude (and future-Sebi) can see
*why* a piece of code looks the way it does without trawling git history.

---

## 2026-05-02 — getCardsRatedToday over-counted merges/edits as ratings

**Symptom:** Dashboard "12 von 122 erledigt" with 10% progress despite the
user not having rated a single card today. The user had merged ~12
duplicates earlier (via the new Duplicate Finder), and those got counted
as "rated today" → progress bar said "12 done", denominator inflated to
ratedToday + plan.totalToday = 12 + 110 = 122.

**Root cause:** `getCardsRatedToday(cards)` used the brittle pattern
`c.repetitions > 0 && c.updatedAt-day === today`. But `updatedAt` is
bumped by ANY card change — merges, edits, set-assignments, sync events,
tag changes. The merged cards have donor.repetitions > 0 (carry-over)
and updatedAt = today (just created via updateCard), so they all matched.

This is the *exact same bug class* we already fixed for new-card counting
in late April (see "Reconciler over-counting" CHANGELOG entry) — the
same brittle heuristic was just left intact in another function.

**Fix:** Apply the same disambiguation heuristic used by
`getNewCardsDoneToday`:
`(nextReviewDate-day - updatedAt-day) === interval`. `applySM2` sets both
fields together (interval is the literal day-distance to nextReviewDate),
while edits/merges touch updatedAt but leave interval and nextReviewDate
untouched. The equation only holds for a fresh rating.

**Why this can't break SRS counting (ironic given context):** Pure
read-only filter on existing card state. No writes. Affects only the
display value `ratedToday` on the Dashboard, which feeds the progress
bar denominator (`progressTotal = ratedToday + plan.totalToday`) and
numerator. With this fix, both sides drop the over-counted merge cards
together, so the bar stays consistent.

**Files:** `src/utils/dailyGoal.ts`

---

## 2026-05-02 — KI Prüfung im Prüfungsmodus (binary mode)

**What:** Die KI-Prüfung-Funktion gibt's jetzt auch im Prüfungsmodus, mit
binärer Bewertung (gewusst / nicht gewusst) statt SRS 4-Button. Threshold:
**Score ≥ 60 / 100 → Empfehlung "Gewusst"**, sonst "Nicht gewusst".

**Why 60:** in der Realität erreichen User die 100% kaum (immer fehlt ein
Beispiel oder Detail), aber bei 60% ist der Kern + die wichtigsten
Aspekte erfasst — der Klassiker-Schwellwert für eine "ja, hat verstanden"-
Bewertung in einer mündlichen Prüfung.

**Default:** Nachbohren-Modus an. In einer simulierten mündlichen Prüfung
besonders wertvoll, weil's das Verhalten echter Prüfer spiegelt — bei
Lücken wird nachgehakt, bevor final bewertet wird. User kann auf "Streng"
umschalten falls erwünscht.

**Implementation:**
- `src/components/AICheckPanel.tsx` (new) — selbständiges Widget mit
  vollständiger State-Machine (input/loading/probing/finalizing/result),
  eigenem Mic-Recognizer-Lifecycle. Outcome-Modus prop: `'srs'` (4 buttons,
  legacy für StudySession) oder `'binary'` (2 buttons, ExamMode). Keys
  als Props übergeben statt hardcoded — re-usable von beliebiger Page.
- `src/pages/ExamMode.tsx` — Button "🎓 KI Prüfung — Antwort selbst
  erklären" über den Gewusst/Nicht-Gewusst-Buttons. Klick öffnet das
  Panel inline; nach Submit klickt User die Empfehlung selbst (`onPickBinary`)
  und das normale `handleAnswer` läuft → keine doppelte Verbuchung.
- StudySession bleibt unverändert (eigene inline-Implementation läuft
  weiter, kann später auf das Panel umziehen wenn Stabilität bewährt).

**Why this can't break exam scoring:** Der AI-Pick ruft das gleiche
`handleAnswer(boolean)` wie die manuellen Buttons auf — also identische
Pipeline (correct/wrong-Listen, `onRecordAttempts`, Auto-Unflag). KI ist
rein advisory, User tippt die Empfehlung weiterhin selber. Score-
Berechnung am Ende der Prüfung unverändert.

**Files:** `src/components/AICheckPanel.tsx` (new), `src/pages/ExamMode.tsx`

---

## 2026-05-01 — Google Drive auto-backup (Variant A: on-app-open)

**What:** New "☁️ Google Drive Backup" section in Settings. User connects
their Google account once; thereafter, every time they open the app and
≥18 hours have passed since the last backup, the full library JSON
(cards + SRS state) is silently uploaded to a "Sebi AI Flashcard Backups"
folder in their Drive. Manual "Jetzt sichern" button + "Trennen" + auto-
toggle. Old backups (>30 days) are auto-cleaned to keep the folder tidy.

**Architecture:** Variant A from the prior architectural discussion —
browser-only OAuth via Google Identity Services (GIS). No server, no
refresh-token storage, no Supabase Edge Function. Tradeoff: needs the
app to be opened ≥1× per ~18h cycle for daily-ish backups. Acceptable
for a study app users open daily anyway.

**Scopes:** `drive.file` (only files this app creates — not the user's
whole Drive) + `email` (so we can show "verbunden als foo@bar.com").

**Files:**
- `src/utils/googleDrive.ts` (new) — GIS loading, token client,
  multipart upload, folder management, cleanup
- `src/hooks/useGoogleDrive.ts` (new) — React state for connect/
  disconnect/last-backup-at, persisted to localStorage; auto-backup
  gate + re-entrancy guard
- `src/utils/export.ts` — added `exportBackupString()` returning the
  same JSON used by the manual download (no indent for upload size)
- `src/pages/Settings.tsx` — new section, hidden if env not configured
- `src/App.tsx` — wires the hook + triggers `maybeAutoBackup()` once
  cards finish loading

**Setup required (sysadmin / first deploy):**
1. Google Cloud Console → new project → enable Drive API
2. OAuth consent screen with `drive.file` + `email` scopes
3. OAuth Client ID (Web app) with origin = deployment URL
4. Set `VITE_GOOGLE_CLIENT_ID` env var (locally + Vercel)

**Why this can't break SRS counting:** Pure read of `cards` →
JSON.stringify → upload. No writes, no state mutations. Auto-backup is
silent (no toast spam) but errors get logged to console; manual backup
surfaces errors loudly.

**Files:** `src/utils/googleDrive.ts` (new), `src/hooks/useGoogleDrive.ts`
(new), `src/pages/Settings.tsx`, `src/App.tsx`, `src/utils/export.ts`,
`.env.example`

---

## 2026-05-01 — Duplicate finder (manual review, no auto-merge)

**What:** New "🔍 Dubletten"-button on the Library page. Opens a modal
that scans all card fronts and groups likely-duplicate cards based on:
- Exact match of the normalized front text → "Exakte Dublette"-bucket
- Jaccard token similarity ≥ adjustable threshold (default 60%) → "ähnlich"-bucket

**Why:** With 1000+ cards accumulated over months, manually finding
duplicates by scrolling library is impossible. This surfaces them
grouped so the user can review and decide. The existing AI-merge flow
is invoked manually per group (never auto-merge — context matters).

**Implementation:**
- `src/utils/duplicateDetect.ts` (new) — token normalization with German
  stop-word filter (Was/Wie/ist/eine/die/etc.), umlaut folding (ä→ae),
  splits on non-alphanumeric (so "PESTEL-Analyse" → ["pestel","analyse"]).
  Pairs scored via Jaccard, transitively grouped via union-find. O(n²)
  comparisons but ~200ms for 1000 cards.
- `src/components/DuplicateFinderModal.tsx` (new) — modal with threshold
  slider, subject/examiner filters, expandable groups with per-card
  checkboxes, "Mergen"-button per group that hands selected IDs to the
  existing `onMergeCards` flow.
- `src/pages/Library.tsx` — button + modal wired up via portal.

**Why this can't break SRS counting:** Pure read-only operation. The
finder never writes to cards, never calls applySM2, never touches
counters. Merging is delegated to the existing flow which is unchanged.

**Files:** `src/utils/duplicateDetect.ts` (new),
`src/components/DuplicateFinderModal.tsx` (new), `src/pages/Library.tsx`

---

## 2026-05-01 — Focus-refetch loading-flag bug + paste-text import

**Symptom (Mac AND mobile):** Importing a JSON file or attaching an image
in the edit modal made the page show "Laden…" screen and silently lose
the in-progress action — no console errors. User saw the screen rendered
the loading spinner right after picking a file, then after a couple
seconds returned to the page with the import never having happened.

**Root cause:** The cross-device live-sync commit added a `window.focus`
re-fetch as a safety net for suspended realtime channels. But the
re-fetch called `load()`, which calls `setLoading(true)` as its first
step. App.tsx gates the entire UI behind `cardsLoading === true` and
renders a global loading screen — unmounting *every* page including any
open file picker or edit modal. The file input lost its event handler
binding and the picked file was discarded.

This affected ANY workflow that briefly blurred the window: file pickers
(both image upload and JSON import), tab switching, alt-tabbing — all
triggered the focus event, all triggered the loading screen.

**Fix:**
1. `useCards.ts` — extracted a `refetch()` helper that fetches + applies
   rows WITHOUT toggling the loading flag. The `onFocus` handler now
   calls `refetch()` instead of `load()`. The UI tree stays mounted
   during the refetch; cards just swap in place when the data returns.
2. `load()` (with the loading toggle) is now used only for the initial
   mount where the global loading screen is the correct UX.

**Plus:** `src/pages/ImportExport.tsx` — added a paste-text JSON import
alternative as a defensive workflow (also useful when receiving JSON via
WhatsApp/Email and not wanting to save to a file first). Reuses the
existing `processFiles` pipeline by wrapping pasted text in a synthetic
File.

**Why this can't break SRS counting:** `refetch()` uses the same
`fromDb` mapper as `load()`. State writes are identical. Only the
loading boolean isn't toggled — purely a UI rendering concern. Setting
state during a refetch may briefly conflict with optimistic local
writes if a card was rated in the same window, but the live-sync
update-by-id+timestamp guard already handles that.

**Files:** `src/hooks/useCards.ts`, `src/pages/ImportExport.tsx`

---

## 2026-04-26 — Mobile image upload no longer reloads & loses edit

**Symptom (real user, mobile):** Editing a card during a study session,
attaching a photo from camera/gallery → after picking and confirming the
image, the page reloaded and the edit was lost. Repeatable on Android.

**Root cause:** `ImageInput.tsx` used a plain `FileReader.readAsDataURL`
on the raw file. Phone-camera photos (5–15 MP, 5–10 MB JPEG) became
~10 MB base64 strings held simultaneously alongside the original
ArrayBuffer and the Data-URL string — a 25–30 MB peak — then got pushed
into React state forcing a re-render with the huge string. Mobile Safari
(and Android Chrome under memory pressure) reload the tab when memory
gets tight, especially right after returning from the native file picker
where the tab was already backgrounded. With the tab reloaded, all
QuickEditModal state was gone.

**Fix:** New `src/utils/imageCompress.ts` resizes any incoming image to
max 1600 px on the long edge and re-encodes as JPEG (quality 0.85) via
canvas. Typical phone photo: 8 MB → <300 KB. Memory peak essentially
disappears, mobile no longer reloads the tab, and Supabase storage gets
massively lighter as a free bonus.

Implementation details:
- Files <500 KB AND of a "safe" mime type (jpeg/png/webp/gif) skip
  compression (the fast path — pasted screenshots, small uploads).
- Canvas decode failure (e.g. HEIC on Chrome) falls back to raw base64
  via the original FileReader path so the user gets *something*.
- `ImageInput` shows a small "Bild wird verarbeitet…" spinner during
  compression (~200–800 ms typically; can be longer on slow devices).
- Reload resilience from the prior commit still applies as a safety
  net — even if a reload happens for unrelated reasons, the study
  session resumes correctly. The unsaved modal edit itself is still
  lost on reload, but the trigger we know about (image picking) no
  longer causes one.

**Why this can't break SRS counting:** Image data is only used for
display + AI prompts. No write paths to SRS fields. Existing cards with
already-stored larger base64 strings continue to work — the threshold
check skips re-processing on load.

**Files:** `src/utils/imageCompress.ts` (new), `src/components/ImageInput.tsx`

---

## 2026-04-26 — Reload-resilience + mic transcript duplication fix

**Symptom 1 (foldable phone reload):** User unfolds Galaxy Z Fold mid study
session → Chrome reloads on config change → app dumps user on dashboard,
losing the current card and all rating progress. Same thing happens for any
manual refresh.

**Symptom 2 (mic duplication):** During the AI Prüfung mic recording, after
a few seconds of speaking the transcript balloons into the same phrase
repeated dozens of times ("…strategische Krise dann erfolgskrise und deine
Liquiditätskrise" × 30+).

**Root cause 1:** Nothing persisted UI navigation or active session state.
`page` in `App.tsx` and the `studying`/`currentIdx`/`sessionCards`/`ratings`
state in `StudySession.tsx` lived purely in React state — every reload
started fresh from the default dashboard.

**Root cause 2:** `createRecognizer`'s keepAlive logic restarted the *same*
SpeechRecognition instance after silence-induced auto-end (`rec.start()` on
the same `rec`). On Samsung Internet (and other mobile browsers), the
`e.results` buffer is preserved across `start()` cycles, so every previously-
finalised chunk is re-emitted on each restart. The caller (`StudySession`)
appends every isFinal chunk to `micFinalRef.current` → duplicates compound
exponentially with each silence pause.

**Fix 1 (reload resilience):**
- `App.tsx`: persist `page` to `sessionStorage` and rehydrate on init.
  `edit-card`/`set-detail` fall back to their parent (`library`/`sets`)
  because their transient state (`editingCard`, `viewingSet`) isn't persisted.
- `StudySession.tsx`: persist `{ sessionState, cardIds, currentIdx, ratings }`
  to `sessionStorage` whenever in `studying` phase; clear on `setup`/`summary`.
  On mount, restore via lazy useState initialisers — card IDs are re-resolved
  against the live `cards` prop, so post-restore edits / live-sync updates
  are reflected. Deleted-mid-session cards are silently dropped.

**Fix 2 (mic duplication):** `createRecognizer` now builds a *fresh*
`SpeechRecognition` instance on every keepAlive restart instead of reusing
the same one. Guarantees a clean results buffer per session. The
`manualStop` flag and restart-attempt throttle remain at closure scope so
behavior is otherwise unchanged.

**Why neither can break SRS counting:** No write paths touched. Persistence
is read-only on init (lazy state) and write-only to sessionStorage on
change. Mic fix only affects local transcript text. `handleRate` →
`applySM2` → counters pipeline is identical.

**Files:** `src/App.tsx`, `src/pages/StudySession.tsx`, `src/utils/speechRecognition.ts`

---

## 2026-04-26 — Cross-device live sync + resurrection-bug fix

**Symptom (real user, "Verena"):** She deleted all cards on laptop and
re-imported a smaller JSON (1074 cards). On laptop everything looked
correct, but on iPad and phone she still saw ~3000 old cards. Reload didn't
help — every reload of iPad just brought the cards "back from the dead".
Only manual delete-and-import on each device individually got things in sync.

**Two compounding root causes:**

**1. No live sync for cards/sets/links.** Only `user_settings` had a
`postgres_changes` subscription (added earlier). Cards/sets/links were
loaded once on mount and then never refreshed automatically. Cross-device
deletes/edits never propagated; the only way to "see" them was a hard
remount, which mobile Safari rarely does.

**2. The resurrection bug in the localStorage→Supabase migration.** The
migration logic in `useCards.ts`, `useSets.ts`, `useCardLinks.ts` ran whenever:
\`migrationFlag not set on this device\` AND \`Supabase table empty for this user\`.
That second condition cannot distinguish "brand-new user" from "existing user
who deleted everything". So on a device whose migration flag wasn't set yet,
opening the app post-deletion would silently re-upload that device's stale
localStorage cards to Supabase — undoing the user's deletion across all devices.

**Fix:**

1. **`src/utils/accountState.ts` (new)** — `isExistingAccount(userId)` checks
   the `user_settings` table. Existence ⇒ user has used the app before
   ⇒ never brand-new ⇒ migration must NOT run on empty tables (it would
   resurrect deletions). Network errors return `null` → migration is also
   skipped (fail-safe; better to skip than to resurrect).
2. **All three migration hooks** (`useCards`, `useSets`, `useCardLinks`)
   now gate the migration behind `isExistingAccount`. If the account exists
   in `user_settings` but the data table is empty → mark migration done,
   don't upload.
3. **Live-sync subscriptions** added to all three hooks, mirroring the
   `useSettings` pattern: postgres_changes channel + `window.focus` refetch.
   - INSERT → add by id (idempotent if already present)
   - UPDATE → replace by id, but only if `incoming.updatedAt > local.updatedAt`
     (skips own-echoes; prevents stale events from clobbering newer optimistic state)
   - DELETE → remove by id
   - Card_links has no updated_at → INSERT/DELETE only.

**Why this can't break SRS counting:** Live-sync is a strict superset of
the existing one-shot load. The same `fromDb` mapper is used for incoming
events; `firstStudiedAt`, `repetitions`, `interval` etc. flow through
unchanged. Optimistic local writes are unchanged. The own-echo guard via
`updatedAt` comparison ensures a Supabase round-trip doesn't overwrite a
fresher local state.

**Edge case:** During a brand-new user's very first login on a device with
legacy localStorage data, there is a sub-second race where `useSettings`
seeds the `user_settings` row in parallel with `useCards` checking
`isExistingAccount`. If the seed completes first, migration is skipped on
that device — recoverable via manual re-import. Acceptable trade-off for
preventing silent resurrection across all subsequent multi-device scenarios.

**Files:** `src/utils/accountState.ts` (new), `src/hooks/useCards.ts`,
`src/hooks/useSets.ts`, `src/hooks/useCardLinks.ts`

---

## 2026-04-26 — KI Prüfung: Nachbohren-Modus (examiner-style follow-ups)

**Symptom:** Strict one-shot grading penalised the learner for not volunteering
every aspect at once, even when they actually *knew* the missing point and
would have answered it correctly if asked. A real oral examiner would just
ask a follow-up — the AI didn't.

**Fix — two-phase grading pipeline:**
1. New `probeAnswerForGaps()` in `aiAnswerCheck.ts`: AI either grades directly
   (if the first answer covers the core + important aspects, ≥80%) or returns
   1–3 targeted, examiner-style follow-up questions ("Und gibt es da eine
   Ausnahme bei …?"). Hard-capped at 3 follow-ups, prompt forbids revealing
   the keyword itself.
2. New `finalGradeWithProbes()`: takes original answer + all probe Q&As and
   produces the final `AnswerCheckResult`. Prompt explicitly tells the model
   that knowledge surfaced via follow-ups counts fully — but unanswered/
   skipped probes still count as gaps.
3. StudySession `AICheckState` extended with `probing` and `finalizing`
   phases. Mic recognizer refactored to update either `text` (input) or
   `currentText` (probing) via state-aware writers, so users can speak their
   follow-up answers exactly like the original.
4. UI: small toggle "🔍 Nachbohren / 🎯 Streng" in the input phase
   (default: Nachbohren). Probing phase shows step indicator (n/N + dots),
   the question, mic/text input, "Überspringen" and "Weiter" buttons.
   Result view shows probe Q&A history collapsibly above captured/missing.

**Why this can't break SRS:** The pipeline is identical from `handleRate`'s
perspective — same `onPickRating` callback, same rating values. The only
change is *what number the AI suggests*; the user still taps the rating
themselves (KI Prüfung has always been advisory). Zero touch on `applySM2`,
`updateSettingsFn`, counters, or any write path.

**Files:** `src/utils/aiAnswerCheck.ts`, `src/pages/StudySession.tsx`

---

## 2026-04-26 — Nested bullet/numbered lists in MarkdownText

**Symptom:** AI answers (e.g. KI Prüfung explanations) often use indented
sub-bullets, but the renderer flattened them — every bullet rendered at the
same `pl-4` regardless of source indent.

**Root cause:** `MarkdownText.tsx` called `trimStart()` *before* matching the
bullet/numbered regex, so leading whitespace (= the nesting signal) was gone
by the time the level could be detected.

**Fix:** New `getIndentLevel(rawLine)` helper counts leading whitespace before
trimming (tab = 4 spaces, every 2 spaces = 1 level, capped at 4). Both bullet
and numbered-list branches now use inline-style padding `paddingLeft: 16 +
level*20px` (Tailwind can't generate dynamic class names). Bullet marker
varies per level: `• ◦ ▪ ▫`. Pure-visual change — no other renderer paths or
data flows touched.

**Files:** `src/components/MarkdownText.tsx`

---

## 2026-04-25 — KI Prüfung: mic auto-stop on mobile fixed

**Symptom:** On Android Chrome / iOS Safari the mic recording would end on
its own as soon as the user paused speaking, even if they wanted to continue.

**Root cause:** Web Speech API on mobile ends the session after a short silence
window even with `continuous=true` — that's a platform-level behavior, not a
config we can disable.

**Fix:** Added `keepAlive` option to `createRecognizer`. When set, the wrapper
silently restarts the recognizer on `onend` / `no-speech` / `aborted`, unless
the user explicitly tapped the stop button (tracked via `manualStop` flag).
Throttled to max 5 restarts per 5s window so a permission-revoke can't loop.
StudySession passes `keepAlive: true` for the KI-Prüfung mic.

**Files:** `src/utils/speechRecognition.ts`, `src/pages/StudySession.tsx`

---

## 2026-04-25 — StudySession: multi-select examiners + daily-limit honoring

**Symptom 1:** "Lern-Session" filter only let you pick ONE examiner. Inflexible
when studying for multiple examiners at once.

**Symptom 2:** With "Nur fällige Karten" on, the preview showed absurd counts
like "1008 Neu" because all unseen cards have `nextReviewDate <= today` (their
default), so `isDueToday` returned true for all of them. The preview was
honest in a useless way — there's no way you'd do 1008 new cards.

**Fix 1:** Examiners is now a `string[]` with chip-style multi-select (same
pattern as CardEditor). Filter logic: card matches if ANY of its examiners is
in the selected set. "Alle abwählen" button + count badge for clarity.

**Fix 2:** When `onlyDue && !endlessMode`, cap unseen cards (rep=0 AND
interval=0) to `dailyNewCardGoal − getNewCardsDoneToday()` — same quota as
calculateDailyPlan applies. Reviews are unaffected.

**Bonus consistency cleanup:** Aligned StudySession's "new vs review" split
with calculateDailyPlan's definition: `rep=0 && interval=0` = new (truly
unseen). Previously StudySession used just `rep=0` which incorrectly
classified Nochmal'd cards as "new". Now they correctly land in the review
bucket. Affects: `availableCards` cap, `startSession` queue split,
`previewNew`/`previewReview` counts.

**Why this can't break new-card counting:** `availableCards` is a read-only
selection filter. The `firstStudiedAt` field, snapshot increments via
`updateSettingsFn`, and `getNewCardsDoneToday` are untouched. Cards filtered
out → never rated → no counter changes. Cards filtered in → rated via the
normal `handleRate` pipeline → counter increments correctly. The cap shrinks
naturally on next render as `getNewCardsDoneToday` grows.

**Files:** `src/pages/StudySession.tsx`

---

## 2026-04-25 — Dedicated `firstStudiedAt` field — true "Neu heute" count

**Symptom:** After removing the over-counting reconciler, Dashboard showed the
honest snapshot value — but the snapshot itself was unreliable because earlier
race-eaten increments (pre-stale-closure-fix) had under-counted real ratings.
User had genuinely rated ~15 new cards but snapshot said 3, and we had no
reliable way to recover the truth from card state because no field
distinguished "rated today" from "edited today".

**Fix — dedicated, rating-only timestamp:**
1. New optional field `firstStudiedAt` on `Flashcard` — set ONCE inside
   `applySM2` on the first rep=0→rep≥1 transition per card lifetime.
   Cannot be moved by edits, merges, sync, or any path other than a real
   rating, because applySM2 is the only place that produces it.
2. Supabase: new column `cards.first_studied_at timestamptz NULL`. Migration
   SQL: `ALTER TABLE cards ADD COLUMN first_studied_at timestamptz;` —
   must be run BEFORE deploying or upserts will 400.
3. New helper `getNewCardsDoneToday(cards, settings)` reconciles
   `max(snapshot, cards-with-firstStudiedAt-today)`. For pre-migration cards
   rated today (no field yet), a tighter fallback heuristic is used:
   `nextReviewDate - updatedAt-day === interval` distinguishes ratings from
   edits since edits don't touch nextReviewDate or interval.
4. Dashboard and `handleStartDailySession` (Tagesplan modal) both call this
   helper — single source of truth, no possibility of disagreement.
5. `handleRate` bootstrap branch reconciles via the same helper.

**Files:** `src/types/card.ts`, `src/utils/srs.ts`, `src/hooks/useCards.ts`,
`src/utils/dailyGoal.ts`, `src/pages/Dashboard.tsx`, `src/App.tsx`

**Migration:** SQL above must be run on Supabase before deploy.

---

## 2026-04-25 — Dashboard reconciler removed (was over-counting)

**Symptom:** Right after the stale-closure fix landed, Dashboard showed
"0 Neu heute" while the Tagesplan modal (same plan computation, different
caller) correctly showed "12 Neu" — i.e. Dashboard claimed all new cards were
already done when 12 were still pending.

**Root cause:** The defensive reconciler I added counted cards with
`repetitions===1 && interval>=1 && updatedAt===today` as a lower bound for
"new cards done today". But `updatedAt` is bumped by ANY card change — edits,
merges, set-assignments, sync. So a routine card edit on a card that had ever
been in "lernend" state inflated `newCardsDone` past the daily quota,
zeroing out remaining-new.

**Fix:** Removed the reconciler. The functional-updater fix in handleRate
(updateSettingsFn) already addresses the actual race; the reconciler was
unnecessary and net-negative. If snapshot drift ever returns we'll add a
dedicated `lastReviewedAt` field set only inside `applySM2` — that's the only
signal that's truly rating-only.

**Files:** `src/pages/Dashboard.tsx`

---

## 2026-04-25 — Dashboard "Neu heute" stale-closure fix

**Symptom:** Dashboard kept showing nearly the full daily new-card quota (e.g.
"14 neue Karten" remaining) even after the user had rated many new cards in a
single session. The progress bar lagged reality by several cards.

**Root cause:** `handleRate` in `App.tsx` read `settings.dailyPlanSnapshot`
from a captured React closure, computed the increment, then passed the
already-stale value to `updateSettings`. When the user tapped rating buttons
in rapid succession, multiple `handleRate` invocations all saw the same `prev`
snapshot from the closure and overwrote each other's increments. Net result:
only the last rating in a burst stuck.

**Fix (3 layers):**
1. New `updateSettingsFn(updater)` in `useSettings.ts` — functional updater that
   reads `prev` from `settingsRef.current` at apply-time, not from the caller's
   closure.
2. `handleRate` in `App.tsx` rewritten to use `updateSettingsFn`. Each rating
   now sees the freshest snapshot regardless of how fast the user is tapping.
3. Defensive reconciler in `Dashboard.tsx`: `newDoneToday = max(snapshot,
   countOfCardsWithRep=1+intervalToday)`. If the snapshot ever drifts behind
   (cross-device, lost write, etc.), the card-derived count covers for it.

**Files:** `src/hooks/useSettings.ts`, `src/App.tsx`, `src/pages/Dashboard.tsx`

---

## 2026-04 — KI Prüfung (AI answer-check feature)

Per-card "KI Prüfung" button: learner explains the back of the card in their
own words via mic (Web Speech API, browser-local — no audio leaves the device)
or text (for U-Bahn / quiet contexts). AI grades conceptually, lists
captured/missing points, and suggests an SM-2 rating. The suggestion is
advisory — the user always taps the rating themselves.

**Files:** `src/utils/aiAnswerCheck.ts` (new), `src/utils/speechRecognition.ts`
(new), `src/pages/StudySession.tsx`

---

## 2026-04 — Card-merge SRS carry-over

**Before:** Merging two cards reset SRS state — losing weeks of progress on the
"furthest along" source card. **After:** Donor selection picks the source with
the highest `repetitions` (tiebreak: highest `interval`); its SRS fields are
carried into the merged card. Also added a manual SRS-status toggle in the
card edit modal (4-button grid: neu / lernend / wiederholen / beherrscht).

**Files:** `src/App.tsx`, `src/pages/CardEditor.tsx`

---

## 2026-04 — Share-import 409 (cards vanishing on refresh)

**Symptom:** User shared cards via "Karten teilen", recipient imported and saw
the cards briefly, then they vanished on refresh.

**Root cause:** `exportShareJSON` kept the original `id` and `setId` via
`...rest` spread. The recipient's import landed in optimistic local state,
but the Supabase insert hit a 409 on `cards_pkey` (id is globally unique
across users, not composite with user_id). On refresh, only Supabase rows
loaded → cards disappeared.

**Fix:** Explicitly strip `id` and `setId` in `exportShareJSON` and reset SRS
fields, so importers always get fresh ids.

**Files:** `src/utils/export.ts`

---

## 2026-04 — Progress bar "61 Bug"

**Symptom:** Progress bar denominator ratcheted up over the day (e.g. "36 von
61") and never shrank when "Schwer"-rated cards got pushed to tomorrow.

**Root cause:** Snapshot's `totalCards` was reused as the denominator and
combined with `Math.max` against new plans — only grew, never shrank.

**Fix:** Always derive denominator at render time as
`ratedToday + plan.totalToday`. Snapshot is used for `totalDone` (numerator)
only.

**Files:** `src/pages/Dashboard.tsx`

---

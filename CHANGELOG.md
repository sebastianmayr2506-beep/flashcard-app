# Changelog

A running log of meaningful behavior changes and bug fixes. Append new entries
at the top. Each entry: date, short title, one-line root cause, one-line fix,
and the files touched. Goal is that future-Claude (and future-Sebi) can see
*why* a piece of code looks the way it does without trawling git history.

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

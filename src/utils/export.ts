import type { Flashcard, CardSet } from '../types/card';

export function exportJSON(cards: Flashcard[], filename = 'karteikarten_export.json'): void {
  const json = JSON.stringify(cards, null, 2);
  downloadFile(json, filename, 'application/json');
}

/** Full backup — includes all SRS state so the user can restore their exact progress. */
export function exportBackupJSON(cards: Flashcard[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `sebi_ai_backup_${date}.json`;
  downloadFile(exportBackupString(cards), filename, 'application/json');
}

/** Same payload as exportBackupJSON but returned as a string instead of triggering a download.
 *  Used by Google-Drive auto-backup. Compact (no indent) to keep upload size small. */
export function exportBackupString(cards: Flashcard[]): string {
  // No indent — backups can be ~10MB indented; compact halves that.
  return JSON.stringify(cards);
}

/**
 * Share export — strips personal SRS progress so recipients start fresh.
 * Keeps all content & exam-metadata (timesAsked, probabilityPercent, etc.)
 * but resets interval/repetitions/easeFactor/nextReviewDate to initial values.
 *
 * IMPORTANT: also strips `id` and `setId`. Card IDs are globally unique in
 * Supabase (cards_pkey on id only), so reusing the exporter's IDs causes
 * 409 conflicts on the recipient — their import appears to succeed locally
 * but vanishes on refresh because the DB inserts silently fail. setId
 * points to a CardSet on the exporter's account that doesn't exist for
 * the recipient, so it would orphan the card.
 */
export function exportShareJSON(cards: Flashcard[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `karteikarten_teilen_${date}.json`;
  const freshCards = cards.map(({
    id: _id,
    setId: _setId,
    interval: _i,
    repetitions: _r,
    easeFactor: _e,
    nextReviewDate: _n,
    flagged: _f,
    ...rest
  }) => ({
    ...rest,
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReviewDate: new Date().toISOString(),
    flagged: false,
  }));
  downloadFile(JSON.stringify(freshCards, null, 2), filename, 'application/json');
}

export function exportCSV(cards: Flashcard[]): void {
  const csv = buildCSV(cards);
  downloadFile('\uFEFF' + csv, 'karteikarten_export.csv', 'text/csv;charset=utf-8');
}

export function exportSetJSON(set: CardSet, cards: Flashcard[]): void {
  const payload = { set, cards };
  const filename = `set_${set.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

export function exportSetCSV(set: CardSet, cards: Flashcard[]): void {
  const csv = buildCSV(cards);
  const filename = `set_${set.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
  downloadFile('\uFEFF' + csv, filename, 'text/csv;charset=utf-8');
}

function buildCSV(cards: Flashcard[]): string {
  const headers = ['front_text', 'back_text', 'subjects', 'examiners', 'difficulty', 'customTags'];
  const rows = cards.map(card => [
    escapeCsv(card.front),
    escapeCsv(card.back),
    escapeCsv(card.subjects.join(';')),
    escapeCsv(card.examiners.join(';')),
    escapeCsv(card.difficulty),
    escapeCsv(card.customTags.join(';')),
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

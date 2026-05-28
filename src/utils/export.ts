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
 * IMPORTANT: also strips `id` and `setIds`. Card IDs are globally unique in
 * Supabase (cards_pkey on id only), so reusing the exporter's IDs causes
 * 409 conflicts on the recipient — their import appears to succeed locally
 * but vanishes on refresh because the DB inserts silently fail. setIds
 * point to CardSets on the exporter's account that don't exist for the
 * recipient, so they would orphan the card.
 */
export function exportShareJSON(cards: Flashcard[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `karteikarten_teilen_${date}.json`;
  const freshCards = cards.map(({
    id: _id,
    setIds: _setIds,
    interval: _i,
    repetitions: _r,
    easeFactor: _e,
    nextReviewDate: _n,
    flagged: _f,
    // Persönliche Felder die der Empfänger nicht erben soll:
    firstStudiedAt: _fsa,    // Timestamp deines ersten Lernens
    blacklisted: _bl,        // deine persönliche „Parkiert"-Auswahl
    gaps: _gaps,             // persönliche Lücken-Markierungen
    ...rest
  }) => ({
    ...rest,
    setIds: [] as string[],
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReviewDate: new Date().toISOString(),
    flagged: false,
    blacklisted: false,
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

// ── NotebookLM / Plain-Text Export ───────────────────────────────────────────
// Renders cards as readable Q&A text — ideal for NotebookLM "Kopierter Text"
// or "PDF/TXT"-Import. No metadata noise, just Frage + Antwort + Kontext.

/** Strip common Markdown syntax so NotebookLM sees clean plain text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **bold**
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/__(.+?)__/g, '$1')         // __bold__
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/~~(.+?)~~/g, '$1')         // ~~strikethrough~~
    .replace(/`(.+?)`/g, '$1')           // `code`
    .replace(/```[\s\S]*?```/g, '')      // ```code blocks```
    // Tables: remove separator rows (|---|---|), then strip pipes from data rows
    .replace(/^\|[\s\-:|]+\|[\s\-:|]*$/gm, '')   // | --- | --- | separator lines
    .replace(/^\|(.*)\|$/gm, (_, inner) =>        // | cell | cell | → "cell  cell"
      inner.split('|').map((c: string) => c.trim()).filter(Boolean).join('  '))
    .replace(/^\s*[-*+]\s+/gm, '• ')    // unordered lists → bullet
    .replace(/^\s*\d+\.\s+/gm, '')      // ordered lists (remove number)
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link text](url) → text
    .replace(/!\[.*?\]\(.+?\)/g, '')     // images → remove
    .replace(/^>\s+/gm, '')              // blockquotes
    .replace(/\n{3,}/g, '\n\n')          // collapse excess blank lines
    .trim();
}

export function buildNotebookLMText(cards: Flashcard[]): string {
  return cards.map((card, i) => {
    const lines: string[] = [];
    const num = card.cardNumber != null ? `#${card.cardNumber}` : `${i + 1}`;
    const tags: string[] = [];
    if (card.difficulty) tags.push(card.difficulty);
    if (card.flagged) tags.push('🚩 Flagged');
    if (card.subjects?.length) tags.push(card.subjects.join(', '));
    if (card.examiners?.length) tags.push(card.examiners.join(', '));
    lines.push(`--- Karte ${num}${tags.length ? ' · ' + tags.join(' · ') : ''} ---`);
    lines.push(`Frage: ${stripMarkdown(card.front)}`);
    lines.push(`Antwort: ${stripMarkdown(card.back)}`);
    return lines.join('\n');
  }).join('\n\n');
}

/** Download as .txt — NotebookLM accepts this as a source document */
export function exportNotebookLMText(cards: Flashcard[], filename?: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const name = filename ?? `karteikarten_notebooklm_${date}.txt`;
  downloadFile(buildNotebookLMText(cards), name, 'text/plain;charset=utf-8');
}

/** Copy to clipboard — for small selections, paste directly into NotebookLM */
export async function copyNotebookLMText(cards: Flashcard[]): Promise<void> {
  await navigator.clipboard.writeText(buildNotebookLMText(cards));
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

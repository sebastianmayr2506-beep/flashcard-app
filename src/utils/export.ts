import type { Flashcard, CardSet } from '../types/card';

export function exportJSON(cards: Flashcard[], filename = 'karteikarten_export.json'): void {
  const json = JSON.stringify(cards, null, 2);
  downloadFile(json, filename, 'application/json');
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

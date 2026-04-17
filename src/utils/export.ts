import type { Flashcard } from '../types/card';

export function exportJSON(cards: Flashcard[]): void {
  const json = JSON.stringify(cards, null, 2);
  downloadFile(json, 'karteikarten_export.json', 'application/json');
}

export function exportCSV(cards: Flashcard[]): void {
  const headers = ['front_text', 'back_text', 'subjects', 'examiners', 'difficulty', 'customTags'];
  const rows = cards.map(card => [
    escapeCsv(card.front),
    escapeCsv(card.back),
    escapeCsv(card.subjects.join(';')),
    escapeCsv(card.examiners.join(';')),
    escapeCsv(card.difficulty),
    escapeCsv(card.customTags.join(';')),
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile('\uFEFF' + csv, 'karteikarten_export.csv', 'text/csv;charset=utf-8');
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

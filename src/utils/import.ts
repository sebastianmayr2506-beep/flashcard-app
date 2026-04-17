import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, Difficulty } from '../types/card';
import { createInitialSRS } from './srs';

export function importFromJSON(jsonText: string): Flashcard[] {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) throw new Error('Ungültiges JSON-Format: Array erwartet');
  return data.map(validateCard);
}

function validateCard(raw: unknown): Flashcard {
  if (typeof raw !== 'object' || raw === null) throw new Error('Ungültige Karte');
  const c = raw as Record<string, unknown>;
  const srs = createInitialSRS();
  return {
    id: typeof c.id === 'string' ? c.id : uuidv4(),
    front: String(c.front ?? ''),
    frontImage: c.frontImage as Flashcard['frontImage'],
    back: String(c.back ?? ''),
    backImage: c.backImage as Flashcard['backImage'],
    subjects: Array.isArray(c.subjects) ? c.subjects.map(String)
      : c.subject ? [String(c.subject)] : [],
    examiners: Array.isArray(c.examiners) ? c.examiners.map(String)
      : c.examiner ? [String(c.examiner)] : [],
    difficulty: (['einfach', 'mittel', 'schwer'].includes(c.difficulty as string)
      ? c.difficulty : 'mittel') as Difficulty,
    customTags: Array.isArray(c.customTags) ? c.customTags.map(String) : [],
    createdAt: String(c.createdAt ?? new Date().toISOString()),
    updatedAt: String(c.updatedAt ?? new Date().toISOString()),
    interval: typeof c.interval === 'number' ? c.interval : srs.interval,
    repetitions: typeof c.repetitions === 'number' ? c.repetitions : srs.repetitions,
    easeFactor: typeof c.easeFactor === 'number' ? c.easeFactor : srs.easeFactor,
    nextReviewDate: typeof c.nextReviewDate === 'string' ? c.nextReviewDate : srs.nextReviewDate,
  };
}

export function importFromCSV(csvText: string): Flashcard[] {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV ist leer oder hat keine Daten');

  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().trim());
  const requiredHeaders = ['front_text', 'back_text'];
  for (const h of requiredHeaders) {
    if (!headers.includes(h)) throw new Error(`Pflichtfeld fehlt: ${h}`);
  }

  const idx = {
    front: headers.indexOf('front_text'),
    back: headers.indexOf('back_text'),
    subjects: headers.indexOf('subjects'),
    examiners: headers.indexOf('examiners'),
    difficulty: headers.indexOf('difficulty'),
    tags: headers.indexOf('customtags'),
  };

  const now = new Date().toISOString();
  const srs = createInitialSRS();

  return lines.slice(1).map(line => {
    const cols = parseCSVRow(line);
    const difficulty = (['einfach', 'mittel', 'schwer'].includes(cols[idx.difficulty] ?? '')
      ? cols[idx.difficulty] : 'mittel') as Difficulty;

    return {
      id: uuidv4(),
      front: cols[idx.front] ?? '',
      back: cols[idx.back] ?? '',
      subjects: idx.subjects >= 0 && cols[idx.subjects]
        ? cols[idx.subjects].split(';').map(s => s.trim()).filter(Boolean)
        : [],
      examiners: idx.examiners >= 0 && cols[idx.examiners]
        ? cols[idx.examiners].split(';').map(e => e.trim()).filter(Boolean)
        : [],
      difficulty,
      customTags: idx.tags >= 0 && cols[idx.tags]
        ? cols[idx.tags].split(';').map(t => t.trim()).filter(Boolean)
        : [],
      createdAt: now,
      updatedAt: now,
      ...srs,
    };
  });
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

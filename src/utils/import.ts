import { v4 as uuidv4 } from 'uuid';
import type { Flashcard, Difficulty } from '../types/card';
import { createInitialSRS } from './srs';
import { normalizeAll } from './normalizeStats';

function mergeCatalogs(asked: unknown, year: unknown): string[] | undefined {
  const out: string[] = [];
  if (Array.isArray(asked)) {
    for (const v of asked) {
      const s = String(v).trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  if (typeof year === 'string' || typeof year === 'number') {
    const s = String(year).trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

export function importFromJSON(jsonText: string): Flashcard[] {
  const data = JSON.parse(jsonText);
  if (!Array.isArray(data)) throw new Error('Ungültiges JSON-Format: Array erwartet');
  const cards = data.map(validateCard);
  // Auto-normalize on import so old backups (with Fragenkatalog-tags in
  // customTags, missing askedByExaminers, etc.) come in cleanly. Imported
  // probabilityPercent values WIN — normalizeAll only computes them when
  // missing. The user can re-run the manual normalize button in Settings
  // afterwards to recompute against the now-merged library.
  const { patches } = normalizeAll(cards);
  if (patches.length === 0) return cards;
  const byId = new Map(patches.map(p => [p.id, p.patch]));
  return cards.map(c => {
    const patch = byId.get(c.id);
    return patch ? { ...c, ...patch } : c;
  });
}

// Read a field from either camelCase (modern export from this app) or
// snake_case (legacy / direct-DB-shape imports). Modern exports use camelCase
// throughout, but old backups and some external sources use snake_case.
function pick<T = unknown>(c: Record<string, unknown>, camel: string, snake?: string): T | undefined {
  const v = c[camel];
  if (v !== undefined && v !== null) return v as T;
  if (snake) {
    const s = c[snake];
    if (s !== undefined && s !== null) return s as T;
  }
  return undefined;
}

function validateCard(raw: unknown): Flashcard {
  if (typeof raw !== 'object' || raw === null) throw new Error('Ungültige Karte');
  const c = raw as Record<string, unknown>;
  const srs = createInitialSRS();

  // Numeric/string fields with snake_case legacy fallback
  const timesAsked = pick<number>(c, 'timesAsked', 'times_asked');
  const askedByExaminers = pick<unknown[]>(c, 'askedByExaminers', 'asked_by_examiners');
  const askedInCatalogsRaw = pick<unknown>(c, 'askedInCatalogs', 'asked_in_catalogs');
  const probabilityPercent = pick<number>(c, 'probabilityPercent', 'probability_percent');
  const firstStudiedAt = pick<string>(c, 'firstStudiedAt', 'first_studied_at');
  const mcQuestions = pick<unknown>(c, 'mcQuestions', 'mc_questions');
  const mcQuestionsGeneratedAt = pick<string>(c, 'mcQuestionsGeneratedAt', 'mc_questions_generated_at');
  const blacklisted = pick<unknown>(c, 'blacklisted');
  const flagged = pick<unknown>(c, 'flagged');
  // Backward-compat: alte Exports hatten setId (single), neue haben setIds (array)
  const setIdLegacy = pick<string>(c, 'setId', 'set_id');
  const setIdsRaw = pick<unknown>(c, 'setIds', 'set_ids');
  const setIds: string[] = Array.isArray(setIdsRaw)
    ? setIdsRaw.filter(v => typeof v === 'string') as string[]
    : (typeof setIdLegacy === 'string' && setIdLegacy ? [setIdLegacy] : []);
  const priorityRaw = pick<unknown>(c, 'priority');

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
    setIds,
    flagged: typeof flagged === 'boolean' ? flagged : false,
    createdAt: String(c.createdAt ?? new Date().toISOString()),
    updatedAt: String(c.updatedAt ?? new Date().toISOString()),
    interval: typeof c.interval === 'number' ? c.interval : srs.interval,
    repetitions: typeof c.repetitions === 'number' ? c.repetitions : srs.repetitions,
    easeFactor: typeof c.easeFactor === 'number' ? c.easeFactor : srs.easeFactor,
    nextReviewDate: typeof c.nextReviewDate === 'string' ? c.nextReviewDate : srs.nextReviewDate,
    firstStudiedAt: typeof firstStudiedAt === 'string' ? firstStudiedAt : undefined,
    timesAsked: typeof timesAsked === 'number' ? timesAsked : undefined,
    askedByExaminers: Array.isArray(askedByExaminers) ? askedByExaminers.map(String) : undefined,
    askedInCatalogs: mergeCatalogs(askedInCatalogsRaw, c.catalog_year),
    probabilityPercent: typeof probabilityPercent === 'number' ? probabilityPercent : undefined,
    // A/B/C-Priority — preserve manual + auto-classified labels across exports.
    priority: (priorityRaw === 'A' || priorityRaw === 'B' || priorityRaw === 'C')
      ? priorityRaw : undefined,
    // Persistent MC questions — drop only if it's not a non-empty array.
    mcQuestions: Array.isArray(mcQuestions) && mcQuestions.length > 0
      ? (mcQuestions as Flashcard['mcQuestions']) : undefined,
    mcQuestionsGeneratedAt: typeof mcQuestionsGeneratedAt === 'string' ? mcQuestionsGeneratedAt : undefined,
    // Parkiert-Flag.
    blacklisted: typeof blacklisted === 'boolean' ? blacklisted : false,
  };
}

export interface ParentLinkHint {
  childFront: string;
  parentFront: string;
}

export function extractParentLinks(jsonText: string): ParentLinkHint[] {
  try {
    const data = JSON.parse(jsonText);
    if (!Array.isArray(data)) return [];
    const hints: ParentLinkHint[] = [];
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const c = item as Record<string, unknown>;
        if (typeof c.parent_question === 'string' && c.parent_question.trim() && typeof c.front === 'string') {
          hints.push({ childFront: String(c.front), parentFront: String(c.parent_question) });
        }
      }
    }
    return hints;
  } catch {
    return [];
  }
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

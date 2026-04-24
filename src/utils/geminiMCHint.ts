// Gemini-powered MC hint — generates a scaffolded multiple/single-choice
// question from a flashcard's front+back to help the learner recall.
// This NEVER feeds into SRS — it's a pure learning aid.

import { callAIWithFallback } from './geminiModels';
import type { AIKeys } from './geminiModels';

export interface MCOption {
  id: string;    // 'a' | 'b' | 'c' | 'd'
  text: string;
  correct: boolean;
}

export interface MCHintResult {
  question: string;
  /** 'single' = exactly 1 correct answer; 'multiple' = 2–3 correct answers */
  type: 'single' | 'multiple';
  options: MCOption[];
  /** Short German explanation shown after the learner submits. */
  explanation: string;
}

// ─── Normalizer ──────────────────────────────────────────────────────────────
// Handles all field-name variants that different AI providers return:
//   - English (standard):  question / type / options / explanation
//   - German (Groq/Llama): frage / typ / optionen / erklärung / antworten
//   - Object-style options: { a: "text", b: "text", ... }  →  array
//   - Correct answers from antworten: ["b"]  array
//   - Wrapped objects: { mc_question: {...} }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMCHint(raw: any): MCHintResult | null {
  if (!raw || typeof raw !== 'object') return null;

  // Unwrap common wrapper keys
  const wrappers = ['mc_question', 'quiz', 'question', 'result', 'data', 'hint'];
  for (const w of wrappers) {
    if (raw[w] && typeof raw[w] === 'object' && !Array.isArray(raw[w])) {
      // Only unwrap if the nested object looks like our target (has question/frage/options/optionen)
      const inner = raw[w];
      if (inner.question || inner.frage || inner.options || inner.optionen) {
        raw = inner;
        break;
      }
    }
  }

  // Resolve question string
  const question: string =
    raw.question ?? raw.frage ?? raw.Question ?? raw.Frage ?? '';
  if (!question) return null;

  // Resolve type
  const rawType = (raw.type ?? raw.typ ?? raw.Type ?? raw.Typ ?? 'single')
    .toString()
    .toLowerCase();
  const type: 'single' | 'multiple' = rawType === 'multiple' ? 'multiple' : 'single';

  // Resolve explanation
  const explanation: string =
    raw.explanation ??
    raw.erklärung ??
    raw.erklaerung ??
    raw.Erklärung ??
    raw.Explanation ??
    '';

  // Collect correct answer ids from antworten / answers / correct_answers arrays
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answerIds: Set<string> = new Set<string>();
  const answerSource =
    raw.antworten ?? raw.answers ?? raw.correct_answers ?? raw.correctAnswers ?? null;
  if (Array.isArray(answerSource)) {
    for (const a of answerSource) {
      if (typeof a === 'string') answerIds.add(a.toLowerCase().trim());
    }
  }

  // Resolve options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawOptions: any = raw.options ?? raw.optionen ?? raw.Options ?? raw.Optionen ?? null;
  const options: MCOption[] = [];

  if (Array.isArray(rawOptions)) {
    // Standard array format: [{id,text,correct}] or [{id,text}] (correct from antworten)
    for (const o of rawOptions) {
      if (!o || typeof o !== 'object') continue;
      const id = String(o.id ?? o.Id ?? '').toLowerCase().trim();
      const text = String(o.text ?? o.Text ?? o.label ?? o.Label ?? '');
      if (!id || !text) continue;
      // Prefer explicit correct field; fall back to answerIds lookup
      const correct: boolean =
        typeof o.correct === 'boolean'
          ? o.correct
          : typeof o.correct === 'string'
          ? o.correct === 'true'
          : answerIds.size > 0
          ? answerIds.has(id)
          : false;
      options.push({ id, text, correct });
    }
  } else if (rawOptions && typeof rawOptions === 'object') {
    // Object format: { a: "text", b: "text", ... }
    for (const [k, v] of Object.entries(rawOptions)) {
      const id = k.toLowerCase().trim();
      const text = typeof v === 'string' ? v : String(v);
      if (!text) continue;
      const correct = answerIds.size > 0 ? answerIds.has(id) : false;
      options.push({ id, text, correct });
    }
    // Sort by id so a,b,c,d are in order
    options.sort((a, b) => a.id.localeCompare(b.id));
  }

  if (options.length < 2) return null;

  // Guarantee at least one correct answer is marked
  const hasCorrect = options.some(o => o.correct);
  if (!hasCorrect) {
    // If we still have answerIds, try marking again (ids may not have matched perfectly)
    // Otherwise fall back: mark first option as correct so UI doesn't break
    if (answerIds.size > 0) {
      for (const o of options) {
        if (answerIds.has(o.id)) o.correct = true;
      }
    }
    if (!options.some(o => o.correct)) {
      options[0].correct = true;
    }
  }

  return { question, type, options, explanation };
}

export async function generateMCHint(
  keys: AIKeys,
  front: string,
  back: string,
): Promise<MCHintResult> {
  if (!keys.gemini?.trim() && !keys.anthropic?.trim() && !keys.groq?.trim()) {
    throw new Error('Kein AI-Schlüssel konfiguriert. Bitte Gemini, Claude oder Groq in den Einstellungen hinterlegen.');
  }

  const prompt = `You are a learning assistant. Generate a multiple-choice hint question from the flashcard below.

### Card – Question:
${front}

### Card – Answer:
${back}

TASK: Create a MC question that helps the learner recall the answer without revealing it directly.

RULES:
1. Choose "single" if there is exactly ONE correct answer, "multiple" if 2–3 answers are correct.
2. Always exactly 4 options with ids "a", "b", "c", "d".
3. Mark each option with correct: true or correct: false.
4. Write question, options and explanation in GERMAN.

REQUIRED JSON FORMAT (use EXACTLY these English field names):
{
  "question": "Die Frage auf Deutsch",
  "type": "single",
  "options": [
    {"id": "a", "text": "Option A", "correct": true},
    {"id": "b", "text": "Option B", "correct": false},
    {"id": "c", "text": "Option C", "correct": false},
    {"id": "d", "text": "Option D", "correct": false}
  ],
  "explanation": "Kurze Erklärung auf Deutsch"
}

Return ONLY the JSON object, no other text.`;

  // No responseSchema — just JSON mode. Schemas are inconsistently supported
  // across Gemini models and cause "invalid structure" errors.
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.5,
    },
  };

  const { text } = await callAIWithFallback(keys, body, prompt);
  if (!text) throw new Error('Keine Antwort erhalten');

  // Strip accidental markdown fences (```json … ```)
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error('KI hat kein gültiges JSON zurückgegeben');
  }

  const result = normalizeMCHint(raw);
  if (!result) {
    console.error('[MC hint] could not normalize:', JSON.stringify(raw).slice(0, 400));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben — bitte nochmal versuchen');
  }
  return result;
}

// AI-powered MC hint — generates a *bundle* of 3 multiple/single-choice
// questions from a flashcard's front+back to help the learner recall
// different aspects of the answer.
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
  /** Short label of the sub-aspect this question tests (e.g. "Definition", "Anwendung"). */
  topic: string;
}

export interface MCHintBundle {
  questions: MCHintResult[];
}

// ─── Normalizer (single question) ────────────────────────────────────────────
// Handles all field-name variants that different AI providers return:
//   - English (standard):  question / type / options / explanation / topic
//   - German (Groq/Llama): frage / typ / optionen / erklärung / antworten / thema
//   - Object-style options: { a: "text", b: "text", ... }  →  array
//   - Correct answers from antworten: ["b"]  array

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSingle(raw: any): MCHintResult | null {
  if (!raw || typeof raw !== 'object') return null;

  // Unwrap common wrapper keys
  const wrappers = ['mc_question', 'quiz', 'result', 'data', 'hint'];
  for (const w of wrappers) {
    if (raw[w] && typeof raw[w] === 'object' && !Array.isArray(raw[w])) {
      const inner = raw[w];
      if (inner.question || inner.frage || inner.options || inner.optionen) {
        raw = inner;
        break;
      }
    }
  }

  const question: string =
    raw.question ?? raw.frage ?? raw.Question ?? raw.Frage ?? '';
  if (!question) return null;

  const rawType = (raw.type ?? raw.typ ?? raw.Type ?? raw.Typ ?? 'single')
    .toString()
    .toLowerCase();
  const type: 'single' | 'multiple' = rawType === 'multiple' ? 'multiple' : 'single';

  const explanation: string =
    raw.explanation ??
    raw.erklärung ??
    raw.erklaerung ??
    raw.Erklärung ??
    raw.Explanation ??
    '';

  const topic: string =
    raw.topic ?? raw.thema ?? raw.Topic ?? raw.Thema ?? raw.aspect ?? raw.aspekt ?? 'Allgemein';

  const answerIds = new Set<string>();
  const answerSource =
    raw.antworten ?? raw.answers ?? raw.correct_answers ?? raw.correctAnswers ?? null;
  if (Array.isArray(answerSource)) {
    for (const a of answerSource) {
      if (typeof a === 'string') answerIds.add(a.toLowerCase().trim());
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawOptions: any = raw.options ?? raw.optionen ?? raw.Options ?? raw.Optionen ?? null;
  const options: MCOption[] = [];

  if (Array.isArray(rawOptions)) {
    for (const o of rawOptions) {
      if (!o || typeof o !== 'object') continue;
      const id = String(o.id ?? o.Id ?? '').toLowerCase().trim();
      const text = String(o.text ?? o.Text ?? o.label ?? o.Label ?? '');
      if (!id || !text) continue;
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
    for (const [k, v] of Object.entries(rawOptions)) {
      const id = k.toLowerCase().trim();
      const text = typeof v === 'string' ? v : String(v);
      if (!text) continue;
      const correct = answerIds.size > 0 ? answerIds.has(id) : false;
      options.push({ id, text, correct });
    }
    options.sort((a, b) => a.id.localeCompare(b.id));
  }

  if (options.length < 2) return null;

  // Guarantee at least one correct answer is marked
  if (!options.some(o => o.correct)) {
    if (answerIds.size > 0) {
      for (const o of options) if (answerIds.has(o.id)) o.correct = true;
    }
    if (!options.some(o => o.correct)) options[0].correct = true;
  }

  return { question, type, options, explanation, topic };
}

// ─── Normalizer (bundle) ─────────────────────────────────────────────────────
// Extracts an array of questions from whatever shape the AI returns.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeBundle(raw: any): MCHintBundle | null {
  if (!raw) return null;

  // Possible shapes:
  //   { questions: [...] }    ← target
  //   { fragen: [...] }       ← German
  //   [ ... ]                 ← bare array
  //   { ... }                 ← single question → wrap as bundle of 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let list: any[] | null = null;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'object') {
    const candidates = [
      raw.questions, raw.fragen, raw.Questions, raw.Fragen,
      raw.items, raw.quiz, raw.mc_questions,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) { list = c; break; }
    }
  }

  if (list) {
    const questions = list
      .map(q => normalizeSingle(q))
      .filter((q): q is MCHintResult => q !== null);
    if (questions.length === 0) return null;
    return { questions };
  }

  // Fallback: maybe it's a single question
  const single = normalizeSingle(raw);
  if (single) return { questions: [single] };
  return null;
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function generateMCHintBundle(
  keys: AIKeys,
  front: string,
  back: string,
  count: number = 3,
): Promise<MCHintBundle> {
  if (!keys.gemini?.trim() && !keys.anthropic?.trim() && !keys.groq?.trim()) {
    throw new Error('Kein AI-Schlüssel konfiguriert. Bitte Gemini, Claude oder Groq in den Einstellungen hinterlegen.');
  }

  const prompt = `You are a learning assistant. You MUST generate EXACTLY ${count} multiple-choice questions — not 1, not 2, exactly ${count}. Each tests a DIFFERENT aspect of the flashcard answer below.

### Card – Question:
${front}

### Card – Answer:
${back}

CRITICAL OUTPUT RULE:
Your response MUST be a JSON object with a top-level "questions" array containing ${count} entries. Returning fewer than ${count} questions is a failure. Returning a single question object (without the "questions" array) is a failure.

TASK: Create ${count} MC questions that together help the learner recall the full answer. Each question must focus on a DIFFERENT sub-aspect (e.g. definition, application, delimitation, examples, exceptions).

RULES:
1. Each question has a "topic" field — a short German label (1-3 words) naming the sub-aspect tested (e.g. "Definition", "Anwendung", "Abgrenzung", "Beispiel", "Ausnahme").
2. Mix question types: at least ${count >= 2 ? 'ONE question must be "multiple"' : '"single"'} (with 2–3 correct options) and the rest "single" (exactly 1 correct).
3. Always exactly 4 options per question, with ids "a", "b", "c", "d".
4. Mark each option with correct: true or correct: false.
5. Do NOT repeat the same question. Each of the ${count} questions must test something distinct.
6. Write question, options, topic and explanation in GERMAN.

REQUIRED JSON FORMAT (use EXACTLY these English field names):
{
  "questions": [
    {
      "topic": "Definition",
      "question": "Erste Frage (Aspekt 1) auf Deutsch",
      "type": "single",
      "options": [
        {"id": "a", "text": "Option A", "correct": true},
        {"id": "b", "text": "Option B", "correct": false},
        {"id": "c", "text": "Option C", "correct": false},
        {"id": "d", "text": "Option D", "correct": false}
      ],
      "explanation": "Kurze Erklärung auf Deutsch"
    },
    {
      "topic": "Anwendung",
      "question": "Zweite Frage (Aspekt 2) auf Deutsch",
      "type": "multiple",
      "options": [
        {"id": "a", "text": "Option A", "correct": true},
        {"id": "b", "text": "Option B", "correct": true},
        {"id": "c", "text": "Option C", "correct": false},
        {"id": "d", "text": "Option D", "correct": false}
      ],
      "explanation": "Kurze Erklärung auf Deutsch"
    },
    {
      "topic": "Abgrenzung",
      "question": "Dritte Frage (Aspekt 3) auf Deutsch",
      "type": "single",
      "options": [
        {"id": "a", "text": "Option A", "correct": false},
        {"id": "b", "text": "Option B", "correct": true},
        {"id": "c", "text": "Option C", "correct": false},
        {"id": "d", "text": "Option D", "correct": false}
      ],
      "explanation": "Kurze Erklärung auf Deutsch"
    }
  ]
}

Return ONLY the JSON object with ALL ${count} questions, no other text.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,  // a bit higher for variety across questions
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

  const bundle = normalizeBundle(raw);
  if (!bundle || bundle.questions.length === 0) {
    console.error('[MC hint] could not normalize bundle:', JSON.stringify(raw).slice(0, 800));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben — bitte nochmal versuchen');
  }
  console.log(`[MC hint] got ${bundle.questions.length}/${count} questions`,
    bundle.questions.map(q => `${q.topic}/${q.type}`));
  if (bundle.questions.length < count) {
    console.warn('[MC hint] AI returned fewer questions than requested — raw was:',
      JSON.stringify(raw).slice(0, 800));
  }
  return bundle;
}

// Convenience wrapper for callers that only need one question (legacy).
export async function generateMCHint(
  keys: AIKeys,
  front: string,
  back: string,
): Promise<MCHintResult> {
  const bundle = await generateMCHintBundle(keys, front, back, 1);
  return bundle.questions[0];
}

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
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('KI hat kein gültiges JSON zurückgegeben');
  }

  // Unwrap top-level wrapper keys some models use
  const wrapper = parsed.mc_question ?? parsed.quiz ?? parsed.mc ?? parsed.result ?? parsed.data;
  if (wrapper && typeof wrapper === 'object') parsed = wrapper;

  // Normalize German field names → English
  if (!parsed.question)     parsed.question     = parsed.frage      ?? parsed.fragestellung ?? parsed.titel ?? '';
  if (!parsed.type)         parsed.type         = parsed.typ        ?? parsed.fragetyp      ?? 'single';
  if (!parsed.explanation)  parsed.explanation  = parsed.erklaerung ?? parsed.erklärung     ?? parsed.begruendung ?? '';

  // Normalize options: object {a:"text",...} → array [{id,text,correct}]
  if (!Array.isArray(parsed.options)) {
    const raw = parsed.options ?? parsed.optionen ?? parsed.antworten ?? parsed.choices ?? {};
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      // Try to find which option is marked as correct
      const correctKey: string =
        parsed.correct_answer ?? parsed.richtige_antwort ?? parsed.correct ?? parsed.answer ?? '';
      parsed.options = Object.entries(raw).map(([id, text]) => ({
        id,
        text: String(text),
        correct: correctKey
          ? id.toLowerCase() === String(correctKey).toLowerCase().replace(/[^a-d]/g, '')
          : false,
      }));
    }
  }

  // Normalize each option's fields (some models use different names)
  if (Array.isArray(parsed.options)) {
    parsed.options = parsed.options.map((o: Record<string, unknown>, i: number) => ({
      id:      String(o.id      ?? o.buchstabe ?? String.fromCharCode(97 + i)),
      text:    String(o.text    ?? o.antwort   ?? o.content ?? o.value ?? ''),
      correct: Boolean(o.correct ?? o.korrekt  ?? o.richtig ?? false),
    }));
  }

  if (!parsed.question || !Array.isArray(parsed.options) || parsed.options.length < 2) {
    console.error('[MC hint] unexpected structure:', JSON.stringify(parsed).slice(0, 400));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben — bitte nochmal versuchen');
  }

  // Ensure type is valid
  if (parsed.type !== 'single' && parsed.type !== 'multiple') parsed.type = 'single';

  return parsed as MCHintResult;
}

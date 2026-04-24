// Gemini-powered MC hint — generates a scaffolded multiple/single-choice
// question from a flashcard's front+back to help the learner recall.
// This NEVER feeds into SRS — it's a pure learning aid.

import { resolveGeminiModel, invalidateGeminiModelCache } from './geminiModels';

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

async function callGemini(model: string, apiKey: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function generateMCHint(
  apiKey: string,
  front: string,
  back: string,
): Promise<MCHintResult> {
  if (!apiKey.trim()) throw new Error('Kein Gemini API-Schlüssel hinterlegt');

  const prompt = `Du bist ein Lernassistent. Du bekommst eine Karteikarte und sollst eine Lernhilfe als Multiple-Choice-Frage erstellen.

### Karte – Frage:
${front}

### Karte – Antwort:
${back}

AUFGABE:
Erstelle eine MC-Frage, die dem Lernenden hilft, auf die Antwort zu kommen — ohne sie direkt zu verraten.

REGELN:
1. Entscheide selbst ob "single" oder "multiple":
   - "single": wenn die Antwort auf genau EINEN zentralen Punkt hinausläuft
   - "multiple": wenn die Antwort mehrere gleichwertige Punkte/Aspekte enthält (dann 2–3 korrekte Optionen)
2. Immer genau 4 Optionen (id: "a", "b", "c", "d")
3. Alle Optionen kurz und prägnant — max. 1–2 Sätze
4. Die Ablenkoptionen (Distraktoren) sollen plausibel aber klar falsch sein
5. Die Erklärung (explanation) fasst kurz zusammen warum die richtigen Antworten korrekt sind — auf Deutsch

Gib NUR gültiges JSON zurück.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          type: { type: 'string', enum: ['single', 'multiple'] },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id:      { type: 'string' },
                text:    { type: 'string' },
                correct: { type: 'boolean' },
              },
              required: ['id', 'text', 'correct'],
            },
          },
          explanation: { type: 'string' },
        },
        required: ['question', 'type', 'options', 'explanation'],
      },
      temperature: 0.5,
    },
  };

  // Resolve a valid model dynamically — retry once if cache is stale
  for (let attempt = 0; attempt < 2; attempt++) {
    const model = await resolveGeminiModel(apiKey);
    const res = await callGemini(model, apiKey, body);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if ((res.status === 404 || res.status === 400) && attempt === 0) {
        // Cached model might be wrong — invalidate and try once more
        invalidateGeminiModelCache(apiKey);
        continue;
      }
      if (res.status === 503) throw new Error('Gemini ist gerade überlastet. Bitte kurz warten und nochmal versuchen.');
      if (res.status === 429) throw new Error('Gemini-Kontingent erschöpft. Bitte kurz warten.');
      throw new Error(`Gemini API Fehler ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Keine Antwort von Gemini erhalten');
    const parsed = JSON.parse(text) as MCHintResult;
    if (!parsed.question || !Array.isArray(parsed.options) || parsed.options.length < 2) {
      throw new Error('Ungültige MC-Struktur von Gemini');
    }
    return parsed;
  }
  throw new Error('MC-Tipp konnte nicht generiert werden');
}

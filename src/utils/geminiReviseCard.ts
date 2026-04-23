// Gemini-powered card revision — cheap/free alternative to Claude for
// "improve this card based on my feedback" style edits.
// Uses Google AI Studio's generateContent endpoint with structured JSON output.

export interface GeminiReviseInput {
  apiKey: string;
  front: string;
  back: string;
  feedback: string;
  /** If true, only revise the back (answer). Front stays locked. */
  backOnly?: boolean;
}

export interface GeminiReviseResult {
  front: string;
  back: string;
}

const SYSTEM_INSTRUCTION = `Du bist ein Assistent für Karteikarten zu österreichischen Berufsschul-/Bachelorprüfungen (BHS/FH). Du bekommst eine bestehende Karteikarte (Frage + Antwort) und einen Änderungswunsch vom Nutzer. Deine Aufgabe: Überarbeite die Karte entsprechend.

REGELN:
1. Ändere NUR das, was der Nutzer explizit bemängelt oder geändert haben will.
2. Behalte alle Inhalte bei, die der Nutzer NICHT bemängelt — nichts wegstreichen was relevant ist.
3. Markdown-Formatierung ist erlaubt und erwünscht: ## Überschriften, **fett**, *kursiv*, - Listen, 1. Aufzählungen, | Tabellen |, \`\`\`Code-Blöcke\`\`\`, --- Trennlinie.
4. Gib IMMER sowohl "front" als auch "back" zurück — auch wenn du nur eines geändert hast (dann gib das andere unverändert zurück).
5. Schreib auf Deutsch, außer die Karte ist explizit auf einer anderen Sprache.`;

const SYSTEM_INSTRUCTION_BACK_ONLY = `${SYSTEM_INSTRUCTION}

WICHTIG: Der Nutzer möchte NUR die Antwort (back) geändert haben. Die Frage (front) bleibt UNVERÄNDERT — gib sie wörtlich so zurück wie sie war.`;

/** Gemini models ordered by preference (newest/best first). */
const MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
];

async function callGemini(model: string, apiKey: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function reviseCardWithGemini(input: GeminiReviseInput): Promise<GeminiReviseResult> {
  if (!input.apiKey.trim()) throw new Error('Kein Gemini API-Schlüssel hinterlegt');
  if (!input.feedback.trim()) throw new Error('Bitte einen Änderungswunsch eingeben');

  const userMessage = `### Aktuelle Frage
${input.front || '(leer)'}

### Aktuelle Antwort
${input.back || '(leer)'}

### Änderungswunsch
${input.feedback}

Bitte überarbeite die Karte entsprechend und gib das Ergebnis als JSON mit den Feldern "front" und "back" zurück.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: {
      parts: [{ text: input.backOnly ? SYSTEM_INSTRUCTION_BACK_ONLY : SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
        },
        required: ['front', 'back'],
      },
      temperature: 0.4,
    },
  };

  // Try models in order until one works (some are only available on certain tiers).
  let lastError: string = '';
  for (const model of MODEL_CANDIDATES) {
    try {
      const res = await callGemini(model, input.apiKey, body);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastError = `${res.status} ${errText}`;
        // 404/400 → try next model; other errors (e.g. 401 bad key) → abort
        if (res.status === 404 || res.status === 400) continue;
        throw new Error(`Gemini API Fehler ${res.status}: ${errText}`);
      }

      const data = await res.json();
      console.log('[geminiRevise] using model:', model);
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!text) throw new Error('Gemini hat keine Antwort zurückgegeben');

      const parsed = JSON.parse(text);
      return {
        front: String(parsed.front ?? input.front),
        back: String(parsed.back ?? input.back),
      };
    } catch (err) {
      // Only retry on model-specific failures; rethrow auth/parse errors
      if (err instanceof Error && /Gemini API Fehler/.test(err.message)) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
  }
  throw new Error(`Kein Gemini-Modell erreichbar. Letzter Fehler: ${lastError}`);
}

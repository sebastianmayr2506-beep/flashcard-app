import type { Flashcard, Difficulty } from '../types/card';

export interface MergeResult {
  front: string;
  back: string;
  reasoning: string;
  difficulty: Difficulty;
}

const SYSTEM_PROMPT = `Du bist ein Experte für das Zusammenführen von Lernkarteikarten für österreichische Berufsschulprüfungen (BHS).

Deine Aufgabe: Führe mehrere ähnliche Karteikarten zu EINER optimalen Karte zusammen.

Regeln:
1. Erstelle eine präzise Frage (front), die alle wesentlichen Aspekte der Quellkarten abdeckt.
2. Erstelle eine vollständige, gut strukturierte Antwort (back) mit Markdown-Formatierung (## Überschriften, **fett**, - Listen, Tabellen).
3. Vermeide Redundanzen — jede Information soll nur einmal erscheinen.
4. Behalte alle wichtigen Details aus allen Quellkarten.
5. Wähle die höchste Schwierigkeit der Quellkarten.

Hinweis: Metadaten wie timesAsked, probabilityPercent, subjects, examiners, askedByExaminers, askedInCatalogs und customTags werden automatisch vom System berechnet — du musst sie NICHT zurückgeben.

Antworte AUSSCHLIESSLICH mit validem JSON in folgendem Format:
{
  "front": "Die zusammengeführte Frage",
  "back": "Die zusammengeführte Antwort (Markdown erlaubt)",
  "reasoning": "Kurze Erklärung warum und wie zusammengeführt wurde",
  "difficulty": "mittel"
}`;

/**
 * Repairs common Claude JSON quirks:
 * - Unescaped newlines/tabs inside string values (e.g. multi-line markdown in "back")
 * - Trailing commas before } or ]
 */
function repairJson(raw: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < raw.length) {
    const char = raw[i];
    // Handle escape sequences inside strings — skip both chars unchanged
    if (char === '\\' && inString) {
      result += char + (raw[i + 1] ?? '');
      i += 2;
      continue;
    }
    // Toggle string mode on unescaped quotes
    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }
    // Escape bare newlines/carriage-returns inside string values
    if (inString && (char === '\n' || char === '\r')) {
      result += '\\n';
      if (char === '\r' && raw[i + 1] === '\n') i++; // skip \r of \r\n pair
      i++;
      continue;
    }
    // Escape bare tabs inside string values
    if (inString && char === '\t') {
      result += '\\t';
      i++;
      continue;
    }
    result += char;
    i++;
  }
  // Strip trailing commas before closing braces/brackets
  return result.replace(/,(\s*[}\]])/g, '$1');
}

/** Fetches available models and returns the best Sonnet/Opus candidate. */
async function resolveBestModel(apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=50', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) throw new Error('models list failed');
    const data = await res.json();
    const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);

    // Prefer: sonnet-4.x > opus-4.x > any (newest version first via sort)
    const ranked = [
      ids.filter(id => /^claude-sonnet-4/i.test(id)).sort().reverse(),
      ids.filter(id => /^claude-opus-4/i.test(id)).sort().reverse(),
      ids.sort().reverse(), // fallback: any model
    ];
    for (const group of ranked) {
      if (group.length > 0) return group[0];
    }
  } catch {
    // ignore — fall through to hardcoded fallback
  }
  return 'claude-sonnet-4-6'; // last-resort default
}

export async function callClaudeMerge(
  apiKey: string,
  cards: Flashcard[]
): Promise<MergeResult> {
  const userMessage = `Führe folgende ${cards.length} Karteikarten zusammen:\n\n${cards
    .map((c, i) => `### Karte ${i + 1}\n**Frage:** ${c.front}\n**Antwort:** ${c.back}\n**Fach:** ${(c.subjects ?? []).join(', ') || '—'}\n**Prüfer:** ${(c.examiners ?? []).join(', ') || '—'}\n**Schwierigkeit:** ${c.difficulty}\n**Wahrscheinlichkeit:** ${c.probabilityPercent != null ? c.probabilityPercent + '%' : '—'}\n**timesAsked:** ${c.timesAsked ?? 0}\n**askedInCatalogs:** ${(c.askedInCatalogs ?? []).join(', ') || '—'}\n**Tags:** ${(c.customTags ?? []).join(', ') || '—'}`)
    .join('\n\n---\n\n')}`;

  const model = await resolveBestModel(apiKey);
  console.log('[claudeMerge] using model:', model);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API Fehler ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data?.content?.[0]?.text ?? '';

  // Extract JSON from the response (Claude sometimes wraps in ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error('Claude hat kein gültiges JSON zurückgegeben');

  const raw = jsonMatch[1] ?? jsonMatch[0];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Claude occasionally produces invalid JSON: literal newlines inside string values
    // (e.g. multi-line markdown in "back"), trailing commas, etc.
    // Repair: escape newlines/tabs ONLY inside string values using a char-by-char scan,
    // then strip trailing commas. Structural newlines between keys are left alone.
    try {
      parsed = JSON.parse(repairJson(raw));
    } catch (e2) {
      throw new Error(`Claude hat kein gültiges JSON zurückgegeben: ${(e2 as Error).message}\n\nRohantwort (Auszug): ${raw.slice(0, 300)}`);
    }
  }

  return {
    front: String(parsed.front ?? ''),
    back: String(parsed.back ?? ''),
    reasoning: String(parsed.reasoning ?? ''),
    difficulty: (['einfach', 'mittel', 'schwer'].includes(parsed.difficulty as string)
      ? parsed.difficulty
      : 'mittel') as Difficulty,
  };
}

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

export async function callClaudeMerge(
  apiKey: string,
  cards: Flashcard[]
): Promise<MergeResult> {
  const userMessage = `Führe folgende ${cards.length} Karteikarten zusammen:\n\n${cards
    .map((c, i) => `### Karte ${i + 1}\n**Frage:** ${c.front}\n**Antwort:** ${c.back}\n**Fach:** ${(c.subjects ?? []).join(', ') || '—'}\n**Prüfer:** ${(c.examiners ?? []).join(', ') || '—'}\n**Schwierigkeit:** ${c.difficulty}\n**Wahrscheinlichkeit:** ${c.probabilityPercent != null ? c.probabilityPercent + '%' : '—'}\n**timesAsked:** ${c.timesAsked ?? 0}\n**askedInCatalogs:** ${(c.askedInCatalogs ?? []).join(', ') || '—'}\n**Tags:** ${(c.customTags ?? []).join(', ') || '—'}`)
    .join('\n\n---\n\n')}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
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

  const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);

  return {
    front: String(parsed.front ?? ''),
    back: String(parsed.back ?? ''),
    reasoning: String(parsed.reasoning ?? ''),
    difficulty: (['einfach', 'mittel', 'schwer'].includes(parsed.difficulty)
      ? parsed.difficulty
      : 'mittel') as Difficulty,
  };
}

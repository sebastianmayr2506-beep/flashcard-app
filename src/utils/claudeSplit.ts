import type { Flashcard, Difficulty } from '../types/card';

export interface SplitCard {
  front: string;
  back: string;
  difficulty: Difficulty;
  customTags: string[];
}

export type SplitResult =
  | { split: true; cards: SplitCard[]; originalFront: string; reasoning: string }
  | { split: false; reasoning: string };

const SYSTEM_PROMPT = `Du bist ein Karteikarten-Trenn-Assistent für österreichische Berufsschulprüfungen (BHS). Der User hat eine Karteikarte ausgewählt, auf der MEHRERE unabhängige Fragen stehen. Trenne sie in einzelne, eigenständige Karten.

REGELN:
1. FRONT: Jede neue Karte bekommt EINE klare Frage. Formuliere sie so, dass sie alleine Sinn ergibt. Ändere den Stil nicht grundlegend.

2. BACK: Teile die Antwort auf — jede neue Karte bekommt NUR den Teil der Antwort, der zu IHRER Frage gehört. Ergänze nichts Neues, kürze nichts Relevantes. Markdown-Formatierung erlaubt (## Überschriften, **fett**, - Listen, Tabellen).

3. METADATA — jede neue Karte bekommt DIESELBEN Metadaten wie die Originalkarte:
   - difficulty: Übernimm den Wert der Originalkarte (außer ein Teil ist deutlich einfacher/schwerer).
   - customTags: Kopiere alle Tags, ENTFERNE aber Tags die nur zu einer der anderen Teilfragen gehören.
   - Alle anderen Metadaten (subject, examiner, probability_percent, times_asked, asked_by_examiners, asked_in_catalogs) werden automatisch vom System kopiert — du musst sie NICHT zurückgeben.

4. WENN die Fragen NICHT trennbar sind (sie gehören thematisch zusammen, sind eine zusammengesetzte Einzelfrage, oder es gibt nur EINE Frage), antworte mit:
   { "split": false, "reasoning": "Begründung warum nicht trennbar" }

Antworte AUSSCHLIESSLICH mit validem JSON in folgendem Format:
{
  "split": true,
  "cards": [
    { "front": "Teilfrage 1", "back": "Antwort dazu", "difficulty": "mittel", "customTags": ["tag1"] },
    { "front": "Teilfrage 2", "back": "Antwort dazu", "difficulty": "mittel", "customTags": ["tag2"] }
  ],
  "original_front": "Der Original-Front-Text",
  "reasoning": "Kurze Begründung wie du getrennt hast"
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
    if (char === '\\' && inString) {
      result += char + (raw[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }
    if (inString && (char === '\n' || char === '\r')) {
      result += '\\n';
      if (char === '\r' && raw[i + 1] === '\n') i++;
      i++;
      continue;
    }
    if (inString && char === '\t') {
      result += '\\t';
      i++;
      continue;
    }
    result += char;
    i++;
  }
  return result.replace(/,(\s*[}\]])/g, '$1');
}

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
    const ranked = [
      ids.filter(id => /^claude-sonnet-4/i.test(id)).sort().reverse(),
      ids.filter(id => /^claude-opus-4/i.test(id)).sort().reverse(),
      ids.sort().reverse(),
    ];
    for (const group of ranked) {
      if (group.length > 0) return group[0];
    }
  } catch {
    // ignore
  }
  return 'claude-sonnet-4-6';
}

function normalizeDifficulty(v: unknown): Difficulty {
  return (['einfach', 'mittel', 'schwer'].includes(v as string) ? v : 'mittel') as Difficulty;
}

export interface SplitForce {
  /** Optional hint from the user explaining how/where to split */
  hint?: string;
}

export async function callClaudeSplit(
  apiKey: string,
  card: Flashcard,
  force?: SplitForce
): Promise<SplitResult> {
  const cardJson = JSON.stringify(
    {
      front: card.front,
      back: card.back,
      difficulty: card.difficulty,
      subjects: card.subjects ?? [],
      examiners: card.examiners ?? [],
      customTags: card.customTags ?? [],
      askedInCatalogs: card.askedInCatalogs ?? [],
      askedByExaminers: card.askedByExaminers ?? [],
      timesAsked: card.timesAsked ?? 0,
      probabilityPercent: card.probabilityPercent ?? 0,
    },
    null,
    2
  );

  const userMessage = force
    ? `Der Nutzer besteht darauf, diese Karteikarte zu trennen. ${force.hint ? `Sein Hinweis: "${force.hint}". ` : ''}Bitte trenne sie TROTZDEM in mindestens zwei eigenständige Karten — auch wenn du normalerweise dagegen entschieden hättest. Antworte immer mit split=true.\n\n${cardJson}`
    : `Trenne diese Karteikarte:\n\n${cardJson}`;

  const model = await resolveBestModel(apiKey);
  console.log('[claudeSplit] using model:', model);

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
      // Force structured output via tool use — API validates JSON for us.
      tools: [
        {
          name: 'return_split_result',
          description: 'Gib das Trenn-Ergebnis zurück (entweder split=true mit cards oder split=false mit reasoning).',
          input_schema: {
            type: 'object',
            properties: {
              split: { type: 'boolean' },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    front: { type: 'string' },
                    back: { type: 'string' },
                    difficulty: { type: 'string', enum: ['einfach', 'mittel', 'schwer'] },
                    customTags: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['front', 'back', 'difficulty', 'customTags'],
                },
              },
              original_front: { type: 'string' },
              reasoning: { type: 'string' },
            },
            required: ['split', 'reasoning'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'return_split_result' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API Fehler ${response.status}: ${errText}`);
  }

  const data = await response.json();

  interface ContentBlock {
    type: string;
    input?: Record<string, unknown>;
    text?: string;
  }
  const contentBlocks: ContentBlock[] = data?.content ?? [];
  const toolUse = contentBlocks.find(b => b.type === 'tool_use');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  if (toolUse?.input && typeof toolUse.input === 'object') {
    parsed = toolUse.input;
  } else {
    // Fallback for edge cases.
    const text: string = contentBlocks.find(b => b.type === 'text')?.text ?? '';
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error('Claude hat kein gültiges JSON zurückgegeben');
    const raw = jsonMatch[1] ?? jsonMatch[0];
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        parsed = JSON.parse(repairJson(raw));
      } catch (e2) {
        throw new Error(`Claude hat kein gültiges JSON zurückgegeben: ${(e2 as Error).message}\n\nRohantwort (Auszug): ${raw.slice(0, 200)}`);
      }
    }
  }

  // When force=true, ignore split===false if Claude still provided cards.
  // Claude sometimes returns split:false even when instructed otherwise.
  const hasCards = Array.isArray(parsed?.cards) && parsed.cards.length >= 2;
  if (parsed?.split === false && !force) {
    return { split: false, reasoning: String(parsed.reasoning ?? 'Karte ist nicht trennbar.') };
  }
  if (parsed?.split === false && force && !hasCards) {
    return { split: false, reasoning: String(parsed.reasoning ?? 'Die KI konnte die Karte auch auf Anfrage nicht trennen.') };
  }

  if (!hasCards) {
    return {
      split: false,
      reasoning: String(parsed?.reasoning ?? 'Die KI konnte keine trennbaren Teilfragen erkennen.'),
    };
  }

  const cards: SplitCard[] = parsed.cards.map((c: Record<string, unknown>) => ({
    front: String(c.front ?? '').trim(),
    back: String(c.back ?? '').trim(),
    difficulty: normalizeDifficulty(c.difficulty ?? card.difficulty),
    customTags: Array.isArray(c.customTags)
      ? (c.customTags as unknown[]).map(t => String(t)).filter(Boolean)
      : card.customTags ?? [],
  })).filter((c: SplitCard) => c.front && c.back);

  if (cards.length < 2) {
    return {
      split: false,
      reasoning: 'Die KI hat weniger als zwei gültige Teilkarten zurückgegeben.',
    };
  }

  return {
    split: true,
    cards,
    originalFront: String(parsed.original_front ?? card.front),
    reasoning: String(parsed.reasoning ?? ''),
  };
}

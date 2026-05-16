// AI-Tiefenscan für Karten-Duplikate.
//
// Die Token-basierte Jaccard-Suche (siehe duplicateDetect.ts) findet
// offensichtliche Duplikate aber verpasst semantische Ähnlichkeiten
// (Synonyme, anderes Phrasing, Abkürzungen). Dieser Scan schickt alle
// Kartenfragen an die KI und lässt sie semantisch clustern.
//
// Token-Schätzung (1037 Karten × ~30 Tokens/Front ≈ 32K Input):
//   Gemini Flash gratis: praktisch 0 Cent
//   Claude Haiku paid:   ~4 Cent
//
// Provider-Fallback wie überall sonst in der App: Gemini → Groq → Claude.

import type { Flashcard } from '../types/card';
import type { DuplicateGroup } from './duplicateDetect';
import { callAIWithFallback } from './geminiModels';

export interface AIKeys {
  gemini?: string;
  anthropic?: string;
  groq?: string;
}

const MAX_FRONT_CHARS = 200;  // truncate sehr lange Fragen damit Prompt nicht explodiert

interface AIGroupResponse {
  cardIds: number[];      // 1-basierte Indizes in der Karten-Liste
  reasoning: string;      // 1 Satz warum diese Karten Duplikate sind
}

/**
 * Findet semantisch ähnliche Karten via KI. Returns Gruppen die NICHT von
 * der Jaccard-Suche gefunden wurden — Caller filtert anhand der card.id.
 *
 * Wirft Error wenn alle Provider failen. Caller fängt das und zeigt
 * inline-Fehler im Modal.
 */
export async function findDuplicatesViaAI(
  cards: Flashcard[],
  keys: AIKeys,
): Promise<DuplicateGroup[]> {
  if (cards.length < 2) return [];

  // Numbered list für den Prompt — 1-basierte IDs (für Menschen lesbar
  // falls Debug nötig). card.id-Mapping läuft über den Index.
  const numberedFronts = cards
    .map((c, i) => {
      const front = c.front.length > MAX_FRONT_CHARS
        ? c.front.slice(0, MAX_FRONT_CHARS) + '…'
        : c.front;
      // Replace newlines damit numbering klar bleibt
      return `${i + 1}. ${front.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n');

  const prompt = [
    'Du suchst **echte Duplikate** in einer Karteikarten-Sammlung.',
    '',
    'Ein Duplikat liegt NUR vor wenn die Antwort die GLEICHE wäre.',
    'Themen-Cluster sind KEINE Duplikate, auch wenn sie verwandt sind.',
    '',
    'BEISPIELE GUT (gruppieren):',
    '✓ "Was ist Taylorismus?" + "Definiere Taylorismus" — gleiche Antwort',
    '✓ "Erkläre PESTEL" + "Was ist die PESTEL-Analyse?" — gleiche Antwort',
    '✓ "Was ist X?" + "Was ist X und welche Vorteile gibt es?" — kurze subsummiert sich in lange',
    '',
    'BEISPIELE SCHLECHT (NICHT gruppieren — verschiedene Antworten erwartet):',
    '✗ "Was ist ein Start-up?" + "Wie finanziert man Start-ups?" — verschiedene Fragen',
    '✗ "Was ist KI?" + "Was ist IoT?" — verschiedene Technologien',
    '✗ "Definition Marketing" + "Marketing-Mix" — verwandt aber verschieden',
    '✗ "Phasen eines Start-ups" + "Erfolgsfaktoren eines Start-ups" — verschiedene Aspekte',
    '',
    'REGELN:',
    '1. Eine Gruppe enthält NIE mehr als 5 Karten. Wenn du mehr findest, gehören sie nicht alle zusammen.',
    '2. Eine Karte nur in EINER Gruppe.',
    '3. reasoning: 1 Satz, max 12 Wörter.',
    '4. Im Zweifel NICHT gruppieren — der User merged manuell.',
    '5. Wenn keine echten Duplikate → `{"groups": []}`',
    '',
    'Karten-Fragen (durchnummeriert):',
    '',
    numberedFronts,
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON:',
    '{"groups": [{"cardIds": [3, 7], "reasoning": "kurze Begründung"}]}',
  ].join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            cardIds: { type: 'array', items: { type: 'integer' } },
            reasoning: { type: 'string' },
          },
          required: ['cardIds', 'reasoning'],
        },
      },
    },
    required: ['groups'],
  };

  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,           // niedrig: deterministische Cluster
      maxOutputTokens: 16384,     // mehr Headroom für viele Gruppen bei großen Bibliotheken
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const { text } = await callAIWithFallback(keys, geminiBody, prompt);

  // Defensive JSON-Parse — KI kann verschiedenste Sachen zurückgeben:
  //  - Leeren String (Safety-Filter oder „nichts gefunden")
  //  - Plain prose ohne JSON
  //  - Markdown mit ```json …```
  //  - JSON mit Kommentaren / trailing commas
  // Wir tolerieren das und behandeln „nichts parsbar" als „keine Duplikate".
  const raw = (text ?? '').trim();
  if (!raw) {
    console.info('[aiDuplicateScan] leere Antwort — interpretiert als "keine Duplikate"');
    return [];
  }

  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    console.warn('[aiDuplicateScan] keine JSON-Struktur in der Antwort gefunden:');
    console.warn(raw.slice(0, 500));
    return []; // keine Gruppen — kein Error
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  let parsed: { groups?: AIGroupResponse[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn('[aiDuplicateScan] JSON parse failed:', err instanceof Error ? err.message : err);
    console.warn('[aiDuplicateScan] raw response (first 500 chars):');
    console.warn(raw.slice(0, 500));
    // Throw mit informativem Text — User sieht das im inline error.
    throw new Error(
      'KI-Antwort konnte nicht geparst werden. Schau in der Browser-Console nach [aiDuplicateScan] für Details und versuch es nochmal mit weniger Karten (z.B. Filter nach Fach).',
    );
  }
  if (!Array.isArray(parsed.groups)) {
    console.warn('[aiDuplicateScan] response hatte kein groups-array. Raw:', raw.slice(0, 300));
    return [];  // graceful: keine Gruppen statt Hard-Error
  }

  // Map AI 1-basierte indizes → Card-Objekte. Skip Gruppen mit < 2 Karten
  // oder ungültigen IDs.
  //
  // SAFETY NET: Gruppen mit > 5 Karten werden verworfen. Das sind fast immer
  // Themen-Cluster die die KI fälschlich als Duplikate sieht ("alle Karten
  // zum Thema KI" ist KEINE Duplikat-Gruppe). Bei echten Duplikaten gibt's
  // erfahrungsgemäß 2-3, selten mal 4 ähnliche Karten. Cutoff bei 5.
  const MAX_GROUP_SIZE = 5;
  const aiGroups: DuplicateGroup[] = [];
  const seenCardIds = new Set<string>();
  let oversizedGroupsSkipped = 0;
  for (const g of parsed.groups) {
    if (!Array.isArray(g.cardIds) || g.cardIds.length < 2) continue;
    if (g.cardIds.length > MAX_GROUP_SIZE) {
      console.warn(`[aiDuplicateScan] dropping oversized group of ${g.cardIds.length} cards (likely topic cluster, not duplicates):`, g.reasoning);
      oversizedGroupsSkipped++;
      continue;
    }
    const groupCards: Flashcard[] = [];
    for (const oneBased of g.cardIds) {
      const idx = oneBased - 1;
      if (idx < 0 || idx >= cards.length) continue;
      const card = cards[idx];
      if (seenCardIds.has(card.id)) continue; // KI hat Karte schon in anderer Gruppe genannt
      groupCards.push(card);
      seenCardIds.add(card.id);
    }
    if (groupCards.length < 2) continue;
    aiGroups.push({
      cards: groupCards,
      maxSimilarity: 0.85,        // KI-Funde kriegen einen virtuellen "85%"-Score
      hasExactMatch: false,
      label: typeof g.reasoning === 'string' ? g.reasoning.slice(0, 120) : '— (KI)',
    });
  }

  if (oversizedGroupsSkipped > 0) {
    console.info(`[aiDuplicateScan] ${oversizedGroupsSkipped} oversized group(s) silently dropped (>${MAX_GROUP_SIZE} cards)`);
  }

  return aiGroups;
}

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
    'Du analysierst eine Liste von Karteikarten-Fragen aus einer Lernapp.',
    'Aufgabe: Finde **echte inhaltliche Duplikate** — Fragen die im Kern dasselbe wollen,',
    'auch wenn sie unterschiedlich formuliert sind (z.B. "Was ist X?" und "Erkläre X").',
    '',
    'WICHTIG:',
    '- Nur als Duplikat gruppieren wenn der **Antwort-Inhalt** im Wesentlichen identisch wäre.',
    '- Verwandte Themen (z.B. "Was ist Industrie 4.0" und "Was ist Industrie 5.0") sind NICHT Duplikate.',
    '- Karten mit unterschiedlichem Detail-Grad zum gleichen Thema (z.B. "Was ist X?" vs',
    '  "Was ist X und welche Beispiele gibt es?") SIND Duplikate — die längere subsummiert die kürzere.',
    '- Gruppen müssen mindestens 2 Karten haben.',
    '- Eine Karte darf nur in EINER Gruppe sein.',
    '- Wenn du nichts findest, gib einfach `{"groups": []}` zurück.',
    '',
    'Karten-Fragen (durchnummeriert):',
    '',
    numberedFronts,
    '',
    'Antworte NUR mit gültigem JSON in genau diesem Format:',
    '{',
    '  "groups": [',
    '    { "cardIds": [3, 7, 21], "reasoning": "Alle fragen nach der Definition von X" },',
    '    { "cardIds": [12, 45], "reasoning": "..." }',
    '  ]',
    '}',
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
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const { text } = await callAIWithFallback(keys, geminiBody, prompt);

  // JSON-Parse mit Fallbacks (siehe cardChatAI.ts für die Logik)
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed: { groups?: AIGroupResponse[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn('[aiDuplicateScan] parse failed:', err);
    console.warn('[aiDuplicateScan] raw:', text);
    throw new Error('KI-Antwort war kein gültiges JSON.');
  }
  if (!Array.isArray(parsed.groups)) {
    throw new Error('KI-Antwort hat kein "groups"-Array.');
  }

  // Map AI 1-basierte indizes → Card-Objekte. Skip Gruppen mit < 2 Karten
  // oder ungültigen IDs.
  const aiGroups: DuplicateGroup[] = [];
  const seenCardIds = new Set<string>();
  for (const g of parsed.groups) {
    if (!Array.isArray(g.cardIds) || g.cardIds.length < 2) continue;
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

  return aiGroups;
}

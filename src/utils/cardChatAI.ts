// AI-Chat über eine Karteikarte. Verwendet die existierende Fallback-Kette
// (Gemini → Groq → Claude). Token-sparsam: schickt nur Karten-Inhalt +
// die letzten ~6 Messages mit, ältere werden als Summary-Hinweis abgekürzt.

import type { Flashcard, ChatMessage } from '../types/card';
import { callAIWithFallback } from './geminiModels';

export interface AIKeys {
  gemini?: string;
  anthropic?: string;
  groq?: string;
}

const CHAT_HISTORY_KEEP = 6;       // wieviele letzte Messages voll an die KI senden
// 4096 Output-Tokens ≈ 3000 Wörter — reicht für lange Steuerrecht-/BWL-
// Erklärungen ohne mid-Sentence-Cuts. Gemini Flash zählt nur tatsächlich
// generierte Tokens, nicht das Limit, daher kein Kostenrisiko.
const MAX_RESPONSE_TOKENS = 4096;

function buildSystemPrompt(card: Flashcard): string {
  return [
    'Du bist ein hilfreicher Lern-Tutor. Der User lernt mit Karteikarten für seine BWL-/Wirtschafts-Prüfung.',
    'Erkläre Konzepte präzise, mit Beispielen wenn das hilft. Halte dich kurz — der User will weiterlernen, nicht romanlesen.',
    'Wenn der User eine konkrete Frage hat: direkt antworten. Wenn er einfach Verständnis braucht: vereinfachen und mit Analogie erklären.',
    'Antworte auf Deutsch.',
    '',
    '─── Aktuelle Karteikarte ───',
    `Frage (Vorderseite): ${card.front}`,
    `Antwort (Rückseite): ${card.back}`,
    card.subjects?.length ? `Fach: ${card.subjects.join(', ')}` : '',
    '─────────────────────────',
  ].filter(Boolean).join('\n');
}

function buildPromptText(card: Flashcard, messages: ChatMessage[], userMessage: string): string {
  const system = buildSystemPrompt(card);
  const kept = messages.slice(-CHAT_HISTORY_KEEP);
  const skipped = messages.length - kept.length;
  const transcript = kept
    .map(m => `${m.role === 'user' ? 'User' : 'Tutor'}: ${m.text}`)
    .join('\n\n');

  return [
    system,
    skipped > 0 ? `[Hinweis: ${skipped} ältere Nachrichten ausgelassen — falls relevant, frag nach Kontext.]` : '',
    transcript ? `─── Bisherige Konversation ───\n${transcript}\n──────────────────────────────` : '',
    `User: ${userMessage}`,
    'Tutor:',
  ].filter(Boolean).join('\n\n');
}

/** Send a new chat message — returns the assistant's reply text. */
export async function askCardChat(
  card: Flashcard,
  history: ChatMessage[],
  userMessage: string,
  keys: AIKeys,
): Promise<string> {
  const promptText = buildPromptText(card, history, userMessage);

  // Gemini body shape: same as other AI calls in this app.
  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: MAX_RESPONSE_TOKENS,
    },
  };

  const { text } = await callAIWithFallback(keys, geminiBody, promptText);
  return text.trim();
}

/** Ask the AI to suggest a revised back-text based on the chat history. */
export interface BackSuggestion {
  back: string;
  rationale: string;        // 1-Satz why the change makes sense
  changeType: 'clarify' | 'simplify' | 'rephrase' | 'expand' | 'none';
}

export async function suggestBackImprovement(
  card: Flashcard,
  history: ChatMessage[],
  keys: AIKeys,
): Promise<BackSuggestion> {
  const transcript = history
    .map(m => `${m.role === 'user' ? 'User' : 'Tutor'}: ${m.text}`)
    .join('\n\n');

  const prompt = [
    'Du analysierst einen Lern-Chat über eine Karteikarte. Aufgabe: schlage eine **bessere Rückseiten-Antwort** vor — basierend auf dem was im Chat geklärt wurde.',
    '',
    'Drei Möglichkeiten je nach Chat-Inhalt:',
    '  - "clarify"  — Antwort war unklar formuliert, schärfen',
    '  - "simplify" — Antwort war zu kompliziert / zu lang, vereinfachen',
    '  - "rephrase" — Antwort war in Ordnung, nur anderer Aufbau hilft',
    '  - "expand"   — Antwort war zu knapp, fehlt Kontext',
    '  - "none"     — die alte Antwort ist gut, kein Update nötig',
    '',
    'Wichtig: wenn "none", ist `back` einfach der alte back-Text unverändert.',
    'Sonst: gib eine neue Rückseite die das Problem aus dem Chat löst. Behalte den Stil von Karteikarten — kompakt, präzise, lernbar.',
    '',
    '─── Aktuelle Karteikarte ───',
    `Frage: ${card.front}`,
    `Aktuelle Antwort: ${card.back}`,
    '─────────────────────────',
    '',
    '─── Chat-Verlauf ───',
    transcript || '(noch keine Nachrichten)',
    '────────────────────',
    '',
    'Antworte NUR mit gültigem JSON in genau diesem Format:',
    '{',
    '  "back": "neue Rückseiten-Antwort (oder unveränderte alte falls changeType=none)",',
    '  "rationale": "1-Satz-Begründung warum die Änderung hilft",',
    '  "changeType": "clarify" | "simplify" | "rephrase" | "expand" | "none"',
    '}',
  ].join('\n');

  // Gemini Response-Schema: erzwingt server-seitig die Felder. Verhindert
  // dass die KI bei langen Karten-Inhalten ins reine Markdown abdriftet.
  const responseSchema = {
    type: 'object',
    properties: {
      back: { type: 'string', description: 'Neue Rückseite der Karteikarte' },
      rationale: { type: 'string', description: '1-Satz Begründung' },
      changeType: {
        type: 'string',
        enum: ['clarify', 'simplify', 'rephrase', 'expand', 'none'],
      },
    },
    required: ['back', 'rationale', 'changeType'],
  };

  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  const { text } = await callAIWithFallback(keys, geminiBody, prompt);

  // Robustes JSON-Parsing in drei Stufen:
  //  1) Schema-konformes JSON parsen (Happy-Path mit Gemini responseSchema)
  //  2) JSON-Slice zwischen erstem '{' und letztem '}' (für Groq/Claude
  //     die ggf. Prosa drum rum schreiben)
  //  3) Graceful fallback: wenn gar kein JSON erkennbar, den gesamten Output
  //     als neue "back"-Antwort akzeptieren. Besser ein leichter Hack-Vorschlag
  //     als gar keiner.
  const tryParse = (raw: string): BackSuggestion | null => {
    try {
      const obj = JSON.parse(raw) as BackSuggestion;
      if (typeof obj.back === 'string' && typeof obj.rationale === 'string') {
        return obj;
      }
    } catch { /* fall through */ }
    return null;
  };

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed = tryParse(cleaned);
  if (!parsed) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
    }
  }
  if (!parsed) {
    // Letzte Rettung: der Output ist vermutlich der reine neue Back-Text.
    // Nur akzeptieren wenn er sich vom alten unterscheidet UND nicht trivial
    // kurz ist (verhindert dass eine "ok" oder ähnlich kurze Phrase als
    // back übernommen wird).
    if (cleaned.length > 30 && cleaned !== card.back) {
      console.warn('[suggestBackImprovement] non-JSON response, treating as raw back text');
      console.warn('[suggestBackImprovement] raw response:', text);
      parsed = {
        back: cleaned,
        rationale: 'KI hat einen neuen Antwort-Text vorgeschlagen (ohne explizite Begründung).',
        changeType: 'rephrase',
      };
    } else {
      console.warn('[suggestBackImprovement] response is neither JSON nor a useful back text');
      console.warn('[suggestBackImprovement] raw response:', text);
      throw new Error('KI hat keine verwendbare Antwort zurückgegeben — versuch es nochmal oder formuliere im Chat konkreter was unklar war.');
    }
  }

  // Normalize changeType
  const valid = ['clarify', 'simplify', 'rephrase', 'expand', 'none'] as const;
  if (!(valid as readonly string[]).includes(parsed.changeType)) {
    parsed.changeType = 'rephrase';
  }
  return parsed;
}

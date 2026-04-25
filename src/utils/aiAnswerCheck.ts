// AI-powered answer check — the learner explains the card answer in their
// own words (via mic or text). We send their explanation along with the
// actual card content to the AI and get back:
//   - what the learner captured correctly
//   - what they missed
//   - a suggested SM-2 rating (Nochmal/Schwer/Gut/Einfach)
//
// Like the MC hint, this NEVER feeds into SRS automatically — the user
// always taps the rating button themselves. The AI only suggests.

import { callAIWithFallback } from './geminiModels';
import type { AIKeys } from './geminiModels';

export interface AnswerCheckResult {
  /** 0–100 — how completely the learner covered the answer (rough estimate). */
  score: number;
  /** Concept-level points the learner got right. Short bullets in German. */
  captured: string[];
  /** Concept-level points the learner missed or got wrong. Short bullets in German. */
  missing: string[];
  /** 0=Nochmal, 1=Schwer, 2=Gut, 3=Einfach — the AI's recommendation. */
  suggestedRating: 0 | 1 | 2 | 3;
  /** Short German explanation of why this rating was suggested (1–2 sentences). */
  reasoning: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clampRating(v: any): 0 | 1 | 2 | 3 {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return 2; // safe default ("Gut")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x).trim()).filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(raw: any): AnswerCheckResult | null {
  if (!raw || typeof raw !== 'object') return null;

  // Unwrap common wrapper keys some models add
  for (const w of ['result', 'evaluation', 'data', 'check']) {
    if (raw[w] && typeof raw[w] === 'object' && !Array.isArray(raw[w])) {
      raw = raw[w];
      break;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(
    typeof raw.score === 'number' ? raw.score : parseFloat(String(raw.score ?? '0')) || 0
  )));

  const captured = asStringArray(raw.captured ?? raw.erfasst ?? raw.correct ?? raw.richtig);
  const missing  = asStringArray(raw.missing  ?? raw.gefehlt ?? raw.fehlend ?? raw.luecken ?? raw.lücken);

  const suggestedRating = clampRating(
    raw.suggestedRating ?? raw.empfehlung ?? raw.rating ?? raw.bewertung
  );

  const reasoning = String(
    raw.reasoning ?? raw.begründung ?? raw.begruendung ?? raw.erklärung ?? raw.erklaerung ?? ''
  );

  // Sanity check — at least *some* signal must be present
  if (captured.length === 0 && missing.length === 0 && !reasoning) return null;

  return { score, captured, missing, suggestedRating, reasoning };
}

export async function checkAnswerWithAI(
  keys: AIKeys,
  front: string,
  back: string,
  userExplanation: string,
): Promise<AnswerCheckResult> {
  if (!keys.gemini?.trim() && !keys.anthropic?.trim() && !keys.groq?.trim()) {
    throw new Error('Kein AI-Schlüssel konfiguriert. Bitte Gemini, Claude oder Groq in den Einstellungen hinterlegen.');
  }
  if (!userExplanation.trim()) {
    throw new Error('Keine Erklärung erhalten — bitte erst etwas eintippen oder einsprechen.');
  }

  const prompt = `Du bist ein wohlwollender Prüfer. Ein Lernender hat eine Karteikarten-Frage selbst erklärt. Bewerte fair und konzeptbasiert.

### Frage auf der Karte
${front}

### Vollständige Musterantwort
${back}

### Erklärung des Lernenden
${userExplanation.trim()}

### DEINE AUFGABE
Vergleiche die Erklärung des Lernenden mit der Musterantwort und gib eine faire Einschätzung.

### WICHTIGE REGELN
1. **Bewerte das KONZEPTUELLE Verständnis, nicht den exakten Wortlaut.** Synonyme, Umschreibungen und eigene Worte zählen voll. "Erste-Hilfe-Pflicht" und "arbeitsrechtliche Hilfeleistungspflicht" sind dasselbe.
2. **Sei wohlwollend.** Wenn der Kern stimmt, ist die Antwort richtig — auch wenn ein Detail fehlt.
3. **Bullets kurz halten.** 3–8 Wörter pro Punkt, klar und konkret.
4. **Schreibe alles auf Deutsch.**

### EMPFEHLUNGS-SKALA (suggestedRating)
- **0 = Nochmal**: Erklärung ist weitgehend falsch oder zeigt grundsätzliches Missverständnis.
- **1 = Schwer**: Wesentliche Teile fehlen, die Erklärung ist lückenhaft, der Kern wurde aber teilweise erfasst.
- **2 = Gut**: Kern und wichtigste Aspekte sind drin. Kleinere Lücken sind okay.
- **3 = Einfach**: Erklärung ist vollständig, präzise und zeigt souveränes Verständnis.

### AUSGABE
Antworte AUSSCHLIESSLICH mit gültigem JSON in genau diesem Format:
{
  "score": 0-100,
  "captured": ["Konzept das richtig erfasst wurde", "..."],
  "missing":  ["Was gefehlt hat oder falsch war", "..."],
  "suggestedRating": 0,
  "reasoning": "Kurze Begründung (1-2 Sätze) auf Deutsch"
}

Wenn der Lernende ALLES richtig hatte, lass "missing" als leeres Array []. Wenn er kaum was richtig hatte, lass "captured" als leeres Array [].`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3, // low — we want consistent, fair grading
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

  const result = normalize(raw);
  if (!result) {
    console.error('[answerCheck] could not normalize:', JSON.stringify(raw).slice(0, 800));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben — bitte nochmal versuchen');
  }
  return result;
}

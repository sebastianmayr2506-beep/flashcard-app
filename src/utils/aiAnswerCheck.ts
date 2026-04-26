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

// ─── Nachbohren-Modus (probing pipeline) ────────────────────────────────────
// Like a real oral examiner: instead of grading a single shot, the AI first
// decides whether the answer covers everything important. If yes → grade.
// If no → return 1–3 targeted follow-up questions ("Und wie verhält sich das,
// wenn …?"). The learner answers each follow-up, then a second AI call
// produces a final grade that takes ALL answers into account.
//
// This solves the frustration where the learner *would have known* a missing
// point if asked — but the strict one-shot mode penalised them for not
// volunteering it.

export interface ProbeAnswer {
  question: string;
  answer: string;
}

export type ProbeOrGradeResult =
  | { kind: 'graded'; result: AnswerCheckResult }
  | { kind: 'probe';  followUps: string[] };

export async function probeAnswerForGaps(
  keys: AIKeys,
  front: string,
  back: string,
  userExplanation: string,
): Promise<ProbeOrGradeResult> {
  if (!keys.gemini?.trim() && !keys.anthropic?.trim() && !keys.groq?.trim()) {
    throw new Error('Kein AI-Schlüssel konfiguriert.');
  }
  if (!userExplanation.trim()) {
    throw new Error('Keine Erklärung erhalten.');
  }

  const prompt = `Du bist ein gründlicher, aber wohlwollender mündlicher Prüfer. Ein Lernender hat eine Karteikarten-Frage selbst erklärt.

### Frage auf der Karte
${front}

### Vollständige Musterantwort
${back}

### Erklärung des Lernenden
${userExplanation.trim()}

### DEINE AUFGABE
Entscheide: Hat der Lernende den KERN UND alle WICHTIGEN Aspekte aus der Musterantwort erfasst?

- Wenn ja → modus "graded": Bewerte die Antwort wie ein wohlwollender Prüfer.
- Wenn nein → modus "probe": Stelle 1–3 prüferhafte Folgefragen, die das fehlende Wissen aus dem Lernenden herauskitzeln. Genau wie in einer echten mündlichen Prüfung, wo der Prüfer nachhakt.

### REGELN FÜR FOLGEFRAGEN
1. **Nur zu Aspekten, die in der Musterantwort explizit vorkommen**, aber vom Lernenden nicht (oder nur unklar) erfasst wurden.
2. **Konkret und themenspezifisch.** Beispiele guter Folgefragen:
   - "Und gibt es da eine Ausnahme bei minderjährigen Erben?"
   - "Wie wirkt sich das auf den Pflichtteilsanspruch aus?"
   - "Was passiert, wenn die Frist verstrichen ist?"
3. **Verrate niemals das Stichwort selbst.** Schlecht: "Was ist die Pflichtteilsergänzung?". Gut: "Was passiert, wenn der Erblasser noch zu Lebzeiten Vermögen verschenkt hat?"
4. **Maximal 3 Folgefragen** — fokussiert auf die wichtigsten Lücken. Lieber 1 gute als 3 mittelmäßige.
5. **Prüferhafter Tonfall, höflich, auf Deutsch.**
6. Wenn der Lernende bereits >80% abgedeckt hat und nur Kleinigkeiten fehlen → KEINE Folgefragen, sondern direkt graden.

### AUSGABE
Antworte AUSSCHLIESSLICH mit gültigem JSON in EINEM dieser zwei Formate:

Wenn ausreichend abgedeckt:
{
  "modus": "graded",
  "score": 0-100,
  "captured": ["..."],
  "missing": [],
  "suggestedRating": 0,
  "reasoning": "Kurze Begründung auf Deutsch"
}

Wenn nachgebohrt werden soll:
{
  "modus": "probe",
  "followUps": ["Erste Folgefrage?", "Zweite Folgefrage?"]
}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  };

  const { text } = await callAIWithFallback(keys, body, prompt);
  if (!text) throw new Error('Keine Antwort erhalten');

  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try { raw = JSON.parse(cleaned); }
  catch { throw new Error('KI hat kein gültiges JSON zurückgegeben'); }

  // Unwrap common wrappers
  for (const w of ['result', 'data', 'response']) {
    if (raw && typeof raw === 'object' && raw[w] && typeof raw[w] === 'object' && !Array.isArray(raw[w])) {
      raw = raw[w];
      break;
    }
  }

  const modus = String(raw?.modus ?? raw?.mode ?? '').toLowerCase();

  if (modus === 'probe') {
    const followUps = asStringArray(raw.followUps ?? raw.follow_ups ?? raw.folgefragen ?? raw.fragen)
      .slice(0, 3); // hard cap
    if (followUps.length === 0) {
      // Probe with no questions = nonsense. Fall through to graded path if possible.
      const graded = normalize(raw);
      if (graded) return { kind: 'graded', result: graded };
      throw new Error('KI wollte nachbohren, aber keine Folgefragen geliefert');
    }
    return { kind: 'probe', followUps };
  }

  // Default = graded path
  const graded = normalize(raw);
  if (!graded) {
    console.error('[probe] could not normalize:', JSON.stringify(raw).slice(0, 800));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben');
  }
  return { kind: 'graded', result: graded };
}

export async function finalGradeWithProbes(
  keys: AIKeys,
  front: string,
  back: string,
  originalExplanation: string,
  probes: ProbeAnswer[],
): Promise<AnswerCheckResult> {
  if (!keys.gemini?.trim() && !keys.anthropic?.trim() && !keys.groq?.trim()) {
    throw new Error('Kein AI-Schlüssel konfiguriert.');
  }

  const probeBlock = probes.length === 0
    ? '(Der Lernende hat alle Folgefragen übersprungen.)'
    : probes.map((p, i) =>
        `**Folgefrage ${i + 1}:** ${p.question}\n**Antwort:** ${p.answer.trim() || '(übersprungen / keine Antwort)'}`
      ).join('\n\n');

  const prompt = `Du bist ein wohlwollender Prüfer. Ein Lernender hat eine Karteikarten-Frage in zwei Phasen beantwortet:
1. Eine erste freie Erklärung
2. Antworten auf gezielte Folgefragen ("Nachbohren")

Bewerte das GESAMTBILD fair und konzeptbasiert.

### Frage auf der Karte
${front}

### Vollständige Musterantwort
${back}

### Erste freie Erklärung des Lernenden
${originalExplanation.trim()}

### Folgefragen-Phase
${probeBlock}

### DEINE AUFGABE
Bewerte die GESAMTLEISTUNG (erste Erklärung + Folgefrage-Antworten zusammen) wie ein fairer mündlicher Prüfer.

### WICHTIGE REGELN
1. **Wissen, das in den Folgefragen kam, zählt voll mit.** Nur weil der Lernende einen Aspekt erst auf Nachfrage genannt hat, ist er nicht "falsch" — in mündlichen Prüfungen ist das normal.
2. **ABER**: Wenn der Lernende bei den Folgefragen *trotz Nachhaken* die Lücke nicht schließen konnte (oder übersprungen hat), zählt der Punkt weiterhin als fehlend.
3. **Bewerte konzeptuell, nicht den Wortlaut.**
4. **Bullets kurz halten** (3–8 Wörter pro Punkt).
5. **Schreibe alles auf Deutsch.**

### EMPFEHLUNGS-SKALA (suggestedRating)
- **0 = Nochmal**: Auch nach Nachhaken grundlegende Missverständnisse.
- **1 = Schwer**: Wesentliche Teile blieben unklar — auch mit Hilfe.
- **2 = Gut**: Kern und wichtigste Aspekte sind drin (notfalls nach Nachfrage).
- **3 = Einfach**: Souveränes Verständnis, alles abgedeckt — entweder direkt oder mühelos auf Nachfrage.

### AUSGABE
Antworte AUSSCHLIESSLICH mit gültigem JSON:
{
  "score": 0-100,
  "captured": ["Konzept das (insgesamt) erfasst wurde", "..."],
  "missing":  ["Was auch nach Nachhaken fehlte", "..."],
  "suggestedRating": 0,
  "reasoning": "Kurze Begründung (1-2 Sätze) auf Deutsch — erwähne ggf. ob Punkte erst auf Nachfrage kamen"
}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  };

  const { text } = await callAIWithFallback(keys, body, prompt);
  if (!text) throw new Error('Keine Antwort erhalten');

  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try { raw = JSON.parse(cleaned); }
  catch { throw new Error('KI hat kein gültiges JSON zurückgegeben'); }

  const result = normalize(raw);
  if (!result) {
    console.error('[finalGrade] could not normalize:', JSON.stringify(raw).slice(0, 800));
    throw new Error('KI hat eine unerwartete Struktur zurückgegeben');
  }
  return result;
}

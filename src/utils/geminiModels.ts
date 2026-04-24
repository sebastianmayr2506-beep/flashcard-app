// Dynamic model resolution + multi-provider fallback chain:
// Gemini (primary) → Claude/Anthropic → Groq (free)
//
// Keys are optional — only providers with a key are tried.

export interface AIKeys {
  gemini?: string;
  anthropic?: string;
  groq?: string;
}

// ─── Gemini model resolver ──────────────────────────────────────────────────

interface GeminiModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

interface ListModelsResponse {
  models?: GeminiModelInfo[];
}

const geminiModelCache = new Map<string, string>();

function scoreModel(name: string): number {
  let score = 0;
  const n = name.toLowerCase();
  if (n.includes('flash')) score += 100;
  if (n.includes('2.5')) score += 40;
  else if (n.includes('2.0')) score += 30;
  else if (n.includes('1.5')) score += 20;
  if (n.includes('latest')) score += 5;
  if (n.includes('lite')) score -= 3;
  if (n.includes('exp') || n.includes('preview')) score -= 10;
  if (n.includes('thinking')) score -= 20;
  if (n.includes('pro')) score -= 5;
  return score;
}

export async function resolveGeminiModel(apiKey: string): Promise<string> {
  const key = apiKey.trim();
  if (!key) throw new Error('Kein Gemini API-Schlüssel hinterlegt');
  const cached = geminiModelCache.get(key);
  if (cached) return cached;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini API-Schlüssel ungültig oder Fehler ${res.status}: ${t}`);
  }
  const data = (await res.json()) as ListModelsResponse;
  const candidates = (data.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /gemini/i.test(n));
  if (candidates.length === 0) throw new Error('Keine kompatiblen Gemini-Modelle für diesen API-Schlüssel');
  candidates.sort((a, b) => scoreModel(b) - scoreModel(a));
  const best = candidates[0];
  geminiModelCache.set(key, best);
  console.log('[geminiModels] resolved:', best);
  return best;
}

export function invalidateGeminiModelCache(apiKey: string): void {
  geminiModelCache.delete(apiKey.trim());
}

// ─── Provider callers ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tryGemini(apiKey: string, body: unknown): Promise<string> {
  const key = apiKey.trim();
  let modelInvalidated = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const model = await resolveGeminiModel(key);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!text) throw new Error('Gemini hat leere Antwort zurückgegeben');
      return text;
    }

    const errText = await res.text().catch(() => '');
    if ((res.status === 404 || res.status === 400) && !modelInvalidated) {
      invalidateGeminiModelCache(key);
      modelInvalidated = true;
      continue;
    }
    if (res.status === 503 || res.status === 429) {
      if (attempt < 3) {
        const wait = Math.pow(2, attempt) * 1500;
        console.log(`[gemini] ${res.status} — retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw new Error(`gemini_overloaded`);
    }
    throw new Error(`Gemini ${res.status}: ${errText}`);
  }
  throw new Error('gemini_overloaded');
}

async function tryClaude(apiKey: string, promptText: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4096,
      messages: [{ role: 'user', content: promptText + '\n\nAntworte NUR mit gültigem JSON, kein weiterer Text.' }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Claude ${res.status}: ${t}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const text: string = data?.content?.[0]?.text ?? '';
  if (!text) throw new Error('Claude hat leere Antwort zurückgegeben');
  return text;
}

async function tryGroq(apiKey: string, promptText: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Du antwortest ausschließlich mit gültigem JSON. Kein erklärender Text, keine Markdown-Blöcke.' },
        { role: 'user', content: promptText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${t}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Groq hat leere Antwort zurückgegeben');
  return text;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Tries AI providers in order: Gemini → Claude → Groq.
 * Only providers with a non-empty key are attempted.
 * Returns the raw JSON text from whichever provider succeeds first.
 */
export async function callAIWithFallback(
  keys: AIKeys,
  geminiBody: unknown,
  promptText: string,
): Promise<{ text: string; provider: string }> {
  const tried: string[] = [];
  const errors: string[] = [];

  if (keys.gemini?.trim()) {
    tried.push('Gemini');
    try {
      const text = await tryGemini(keys.gemini, geminiBody);
      return { text, provider: 'gemini' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isOverloaded = msg === 'gemini_overloaded';
      errors.push(`Gemini: ${isOverloaded ? 'überlastet' : msg}`);
      if (!isOverloaded) throw new Error(errors.join(' | '));
      console.warn('[AI fallback] Gemini überlastet — versuche nächsten Anbieter');
    }
  }

  if (keys.groq?.trim()) {
    tried.push('Groq');
    try {
      const text = await tryGroq(keys.groq, promptText);
      console.log('[AI fallback] using Groq');
      return { text, provider: 'groq' };
    } catch (err) {
      errors.push(`Groq: ${err instanceof Error ? err.message : err}`);
      console.warn('[AI fallback] Groq fehlgeschlagen:', errors.at(-1));
    }
  }

  if (keys.anthropic?.trim()) {
    tried.push('Claude');
    try {
      const text = await tryClaude(keys.anthropic, promptText);
      console.log('[AI fallback] using Claude');
      return { text, provider: 'claude' };
    } catch (err) {
      errors.push(`Claude: ${err instanceof Error ? err.message : err}`);
      console.warn('[AI fallback] Claude fehlgeschlagen:', errors.at(-1));
    }
  }

  if (tried.length === 0) throw new Error('Kein AI-Schlüssel konfiguriert. Bitte in den Einstellungen hinterlegen.');
  throw new Error(`Alle KI-Anbieter nicht erreichbar (${tried.join(', ')}). Bitte später nochmal versuchen.`);
}

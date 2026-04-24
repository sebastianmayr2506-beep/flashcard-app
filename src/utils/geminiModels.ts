// Dynamic model resolution — queries Google's ListModels API to find a
// working flash model for the given API key, instead of guessing names.
// Different API keys / tiers have different models available, so hard-
// coded names often break. Result is cached per API key for the session.

interface GeminiModelInfo {
  name: string; // e.g. "models/gemini-2.0-flash"
  supportedGenerationMethods?: string[];
  displayName?: string;
}

interface ListModelsResponse {
  models?: GeminiModelInfo[];
}

const cache = new Map<string, string>();

/**
 * Score a model name — higher is better. We prefer:
 *   - "flash" variants (cheap/fast, perfect for these tasks)
 *   - newer versions (2.x > 1.5)
 *   - non-preview/experimental unless nothing else available
 */
function scoreModel(name: string): number {
  let score = 0;
  const n = name.toLowerCase();
  if (n.includes('flash')) score += 100;
  if (n.includes('2.5')) score += 40;
  else if (n.includes('2.0')) score += 30;
  else if (n.includes('1.5')) score += 20;
  if (n.includes('latest')) score += 5;
  if (n.includes('lite')) score -= 3;           // lite is fine but less capable
  if (n.includes('exp') || n.includes('preview')) score -= 10;
  if (n.includes('thinking')) score -= 20;      // thinking models are slower
  if (n.includes('pro')) score -= 5;            // prefer flash for our use case
  return score;
}

/**
 * Resolves a valid Gemini model name (without the "models/" prefix) that
 * supports generateContent for the provided API key. Caches the result.
 * Throws if no usable model is found.
 */
export async function resolveGeminiModel(apiKey: string): Promise<string> {
  const key = apiKey.trim();
  if (!key) throw new Error('Kein Gemini API-Schlüssel hinterlegt');

  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 400 || res.status === 403) {
      throw new Error(`Gemini API-Schlüssel ungültig: ${t}`);
    }
    throw new Error(`Gemini ListModels Fehler ${res.status}: ${t}`);
  }
  const data = (await res.json()) as ListModelsResponse;
  const candidates = (data.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /gemini/i.test(n));

  if (candidates.length === 0) {
    throw new Error('Keine kompatiblen Gemini-Modelle verfügbar für diesen API-Schlüssel');
  }

  candidates.sort((a, b) => scoreModel(b) - scoreModel(a));
  const best = candidates[0];
  cache.set(key, best);
  console.log('[geminiModels] resolved:', best, '(from', candidates.length, 'candidates)');
  return best;
}

/** Clears the cached model — call if a request fails with 404/400 so we re-resolve. */
export function invalidateGeminiModelCache(apiKey: string): void {
  cache.delete(apiKey.trim());
}

// Find candidate-duplicate cards by question (front) similarity.
//
// Two signals:
//   1. Exact match of the normalized front  → "exakte Dublette"-bucket (highest priority)
//   2. Jaccard token-similarity ≥ threshold → "ähnliche Frage"-bucket
//
// Stop-word filtering is aggressive on German question phrasing
// ("Was ist", "Wie funktioniert", articles, etc.) so that fronts like
// "Was ist eine PESTEL-Analyse?" and "Was ist die PESTEL-Analyse?"
// are recognised as duplicates despite the article variation.
//
// Groups are merged transitively via union-find: if A↔B and B↔C, all
// three end up in the same group.
//
// IMPORTANT: this never modifies cards. It returns candidate groups
// for the user to review and (manually) merge via the existing flow.

import type { Flashcard } from '../types/card';

const STOP_WORDS = new Set<string>([
  // German question words
  'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'wozu', 'woher', 'wohin',
  'welche', 'welcher', 'welches', 'welchen', 'welchem',
  // Aux verbs / common verbs in question form
  'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'kann', 'koennen', 'können',
  'soll', 'sollen', 'muss', 'muessen', 'müssen', 'wird', 'werden', 'wurde', 'wurden',
  'gibt', 'macht', 'tun', 'tut',
  // Articles
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'eines', 'einen',
  // Conjunctions
  'und', 'oder', 'aber', 'doch', 'denn', 'sowie', 'sondern',
  // Prepositions
  'mit', 'von', 'zu', 'in', 'im', 'auf', 'an', 'bei', 'für', 'fuer', 'nach',
  'aus', 'über', 'ueber', 'unter', 'vor', 'zur', 'zum', 'beim', 'ohne', 'gegen', 'durch',
  // Pronouns
  'sich', 'es', 'dass', 'sie', 'er', 'ich', 'wir', 'ihr', 'du', 'man',
  // Misc
  'nicht', 'nur', 'auch', 'schon', 'noch', 'mehr', 'sehr', 'nichts',
  'alle', 'alles', 'etwa', 'etwas', 'beim', 'als', 'wenn', 'damit', 'dabei',
  // Common topic-neutral words
  'beispiel', 'beispiele', 'allgemein', 'bitte', 'erklaere', 'erklären', 'erkläre',
  'nenne', 'beschreibe', 'definiere', 'unterschied', 'vergleich',
]);

function normalize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      // Replace umlauts with ASCII so "über" == "ueber" etc.
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      // Split on any non-alphanumeric (handles "PESTEL-Analyse" → ["pestel","analyse"])
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 4 && !STOP_WORDS.has(t)),
  );
}

/** A pre-computed signature per card so we don't tokenize repeatedly during O(n²) compare. */
interface CardSig {
  card: Flashcard;
  /** Lowercase, trimmed, single-spaced — used for exact-match detection. */
  normalizedRaw: string;
  /** Filtered token set — used for Jaccard. */
  tokens: Set<string>;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Union-Find for transitive grouping ────────────────────────────────────
class UnionFind {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path compression
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

export interface DuplicateGroup {
  /** Cards considered duplicates of each other (length ≥ 2). */
  cards: Flashcard[];
  /** Highest pairwise similarity inside the group (0..1). 1.0 means at least one exact pair. */
  maxSimilarity: number;
  /** True if at least one pair has identical normalized front. */
  hasExactMatch: boolean;
  /** A short label summarising the shared topic — derived from the most common token. */
  label: string;
}

export interface DuplicateFinderOptions {
  /** Jaccard threshold for the "similar" bucket. Default 0.6. Range: 0.4–0.9 useful. */
  threshold?: number;
  /** Optional subject filter — only scan cards whose subjects include this. */
  subject?: string;
  /** Optional examiner filter — only scan cards whose examiners include this. */
  examiner?: string;
}

export function findDuplicateGroups(
  cards: Flashcard[],
  opts: DuplicateFinderOptions = {},
): DuplicateGroup[] {
  const threshold = opts.threshold ?? 0.6;

  // Filter pool first (subject/examiner)
  const pool = cards.filter(c => {
    if (opts.subject && !(c.subjects ?? []).includes(opts.subject)) return false;
    if (opts.examiner && !(c.examiners ?? []).includes(opts.examiner)) return false;
    return true;
  });

  // Pre-compute signatures
  const sigs: CardSig[] = pool.map(card => ({
    card,
    normalizedRaw: card.front.trim().toLowerCase().replace(/\s+/g, ' '),
    tokens: normalize(card.front),
  }));

  const n = sigs.length;
  if (n < 2) return [];

  const uf = new UnionFind(n);
  // Track per-pair similarity for the union-found groups (max sim wins).
  const groupSimilarities: Map<number, number> = new Map();
  const exactGroups = new Set<number>();

  // First pass: exact-match bucket via the normalizedRaw string (cheap O(n))
  const byRaw = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = sigs[i].normalizedRaw;
    if (!k) continue;
    const arr = byRaw.get(k);
    if (arr) arr.push(i); else byRaw.set(k, [i]);
  }
  for (const idxs of byRaw.values()) {
    if (idxs.length < 2) continue;
    for (let j = 1; j < idxs.length; j++) uf.union(idxs[0], idxs[j]);
    const root = uf.find(idxs[0]);
    exactGroups.add(root);
    groupSimilarities.set(root, 1.0);
  }

  // Second pass: O(n²) Jaccard similarity. n=1000 → 500K iterations, ~200ms in JS.
  // Skip pairs already in the same component (already grouped via exact match).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (uf.find(i) === uf.find(j)) continue;
      const sim = jaccard(sigs[i].tokens, sigs[j].tokens);
      if (sim >= threshold) {
        uf.union(i, j);
        const root = uf.find(i);
        const prev = groupSimilarities.get(root) ?? 0;
        if (sim > prev) groupSimilarities.set(root, sim);
      }
    }
  }

  // Collect groups
  const buckets: Map<number, number[]> = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const arr = buckets.get(r);
    if (arr) arr.push(i); else buckets.set(r, [i]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, idxs] of buckets) {
    if (idxs.length < 2) continue;
    const groupCards = idxs.map(i => sigs[i].card);
    // Build label from most common non-stop token in the group
    const tokenFreq = new Map<string, number>();
    for (const i of idxs) for (const t of sigs[i].tokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    const sortedTokens = [...tokenFreq.entries()].sort((a, b) => b[1] - a[1]);
    const label = sortedTokens.slice(0, 3).map(([t]) => t).join(' · ') || '—';

    groups.push({
      cards: groupCards,
      maxSimilarity: groupSimilarities.get(root) ?? threshold,
      hasExactMatch: exactGroups.has(root),
      label,
    });
  }

  // Sort: exact matches first, then by group size desc, then by similarity desc
  groups.sort((a, b) => {
    if (a.hasExactMatch !== b.hasExactMatch) return a.hasExactMatch ? -1 : 1;
    if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
    return b.maxSimilarity - a.maxSimilarity;
  });

  return groups;
}

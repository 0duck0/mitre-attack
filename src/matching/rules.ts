import type { AttackTechnique } from "../store/attackStore.js";

export type RuleMatch = {
  id: string;
  score: number;
  matchedTokens: string[];
};

// Common English words and generic cybersecurity terms that appear across
// many ATT&CK technique descriptions and add noise without discriminating
// between specific techniques.
const STOP_WORDS = new Set([
  // Generic English
  "able", "about", "above", "across", "after", "against", "also", "been",
  "before", "being", "below", "between", "both", "become", "called", "came",
  "case", "come", "could", "daily", "does", "done", "down", "during", "each",
  "either", "else", "every", "find", "first", "following", "form", "forms",
  "found", "from", "gain", "given", "global", "goes", "going", "good", "have",
  "having", "help", "here", "high", "hold", "however", "https", "include",
  "including", "into", "itself", "just", "keep", "known", "large", "last",
  "late", "later", "lead", "least", "left", "less", "light", "like", "likely",
  "line", "link", "list", "long", "look", "made", "main", "make", "many",
  "mark", "marked", "matter", "means", "might", "more", "most", "much",
  "must", "name", "need", "note", "number", "often", "once", "only", "open",
  "order", "other", "others", "over", "part", "past", "place", "point",
  "possible", "previous", "provide", "quite", "rather", "reach", "really",
  "related", "report", "result", "right", "same", "several",
  "should", "show", "side", "since", "site", "sites", "small", "some",
  "state", "still", "structure", "such", "take", "taken", "tell", "than",
  "that", "their", "them", "then", "there", "therefore", "these", "they",
  "thing", "think", "this", "those", "through", "time", "together", "under",
  "upon", "used", "using", "various", "very", "want", "well", "were", "what",
  "when", "where", "which", "while", "wide", "will", "with", "within",
  "without", "word", "work", "would", "year", "your", "2019", "2020", "2021",
  "2022", "2023", "2024", "2025",
  // Cybersecurity terms too generic to discriminate between techniques
  "threat", "threats", "attack", "attacks", "attacker", "attackers",
  "actor", "actors", "campaign", "campaigns", "cyber", "data",
  "target", "targeted", "targeting", "targets",
  "group", "groups", "system", "systems", "service", "services",
  "operation", "operations", "operational",
  "infrastructure", "defense", "defensive",
  "sector", "sectors", "industry", "industries",
  "environment", "environments", "network", "networks",
  "security", "critical", "advanced", "persistent",
  "risk", "risks", "impact", "activity",
  "trend", "trends", "further", "detailed",
  "conducting", "leveraged", "imposed", "demonstrated",
  "significant", "organizations", "information",
  "techniques", "tactics", "tools", "based"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// IDF cache — recomputed only when the technique set changes.
let idfCache: { ref: AttackTechnique[]; values: Map<string, number> } | null = null;

function getIdf(techniques: AttackTechnique[]): Map<string, number> {
  if (idfCache && idfCache.ref === techniques) {
    return idfCache.values;
  }

  const N = techniques.length;
  const docFreq = new Map<string, number>();

  for (const technique of techniques) {
    const text = [
      technique.name,
      technique.description,
      ...(technique.aliases ?? []),
      ...(technique.examples ?? [])
    ].join(" ");

    // Count each token once per technique (document frequency).
    const unique = new Set(
      tokenize(text).filter((t) => t.length >= 4 && !STOP_WORDS.has(t))
    );
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const values = new Map<string, number>();
  for (const [token, df] of docFreq) {
    values.set(token, Math.log(N / df));
  }

  idfCache = { ref: techniques, values };
  return values;
}

export function rulePrefilter(text: string, techniques: AttackTechnique[], limit: number): RuleMatch[] {
  const tokens = new Set(tokenize(text).filter((t) => !STOP_WORDS.has(t)));
  const idf = getIdf(techniques);

  const scored = techniques.map((technique) => {
    const haystack = [
      technique.name,
      technique.description,
      ...(technique.aliases ?? []),
      ...(technique.examples ?? [])
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    const matchedTokens: string[] = [];

    for (const token of tokens) {
      if (token.length < 4) continue;
      if (haystack.includes(token)) {
        const weight = idf.get(token) ?? 1;
        score += weight;
        matchedTokens.push(token);
      }
    }

    return { id: technique.id, score, matchedTokens };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

import type { AttackTechnique } from "../store/attackStore.js";

export type RuleMatch = {
  id: string;
  score: number;
  matchedTokens: string[];
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function rulePrefilter(text: string, techniques: AttackTechnique[], limit: number): RuleMatch[] {
  const tokens = new Set(tokenize(text));

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
        score += 1;
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

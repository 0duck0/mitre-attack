import type { AttackTechnique } from "../store/attackStore.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { cosineSimilarity } from "./embeddings.js";
import { rulePrefilter } from "./rules.js";

export type HybridMatch = {
  id: string;
  score: number;
  ruleScore: number;
  embeddingScore: number;
  matchedTokens: string[];
};

export async function hybridMatch(options: {
  text: string;
  techniques: AttackTechnique[];
  embeddings: Map<string, number[]>;
  embeddingProvider?: EmbeddingProvider;
  limit: number;
  ruleWeight: number;
  embeddingWeight: number;
}): Promise<HybridMatch[]> {
  const { text, techniques, embeddings, embeddingProvider, limit, ruleWeight, embeddingWeight } = options;

  const prefilter = rulePrefilter(text, techniques, Math.max(limit * 10, 50));
  const queryEmbedding = embeddingProvider ? await embeddingProvider.embed(text) : null;

  const matches = prefilter.map((candidate) => {
    const vector = embeddings.get(candidate.id);
    const embeddingScore = queryEmbedding && vector ? cosineSimilarity(queryEmbedding, vector) : 0;
    const score = ruleWeight * candidate.score + embeddingWeight * embeddingScore;

    return {
      id: candidate.id,
      score,
      ruleScore: candidate.score,
      embeddingScore,
      matchedTokens: candidate.matchedTokens
    };
  });

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

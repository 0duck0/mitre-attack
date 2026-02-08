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
  let queryEmbedding: number[] | null = null;
  if (embeddingProvider) {
    try {
      queryEmbedding = await embeddingProvider.embed(text);
    } catch {
      // Embedding endpoint unavailable; fall back to rule-only matching.
    }
  }

  const useEmbeddings = queryEmbedding !== null;

  const matches = prefilter.map((candidate) => {
    const vector = embeddings.get(candidate.id);
    const embeddingScore = useEmbeddings && queryEmbedding && vector ? cosineSimilarity(queryEmbedding, vector) : 0;

    // When embeddings are unavailable, use rule score directly instead of
    // scaling it down by ruleWeight (which assumes embedding contribution).
    const score = useEmbeddings
      ? ruleWeight * candidate.score + embeddingWeight * embeddingScore
      : candidate.score;

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
